import type { WeatherKey } from './types';

/**
 * Open-Meteo から天気・気圧・気温・湿度を取得する。
 *
 * このアプリの目玉は「体調 × 気圧」だが、気圧を毎日手で調べて入力する人はまずいない。
 * 手入力のままだと分析機能が使われないまま終わるので、自動取得を用意する。
 *
 * Open-Meteo を選んだ理由:
 *  - API キー不要（Edge Function を挟まずブラウザから直接叩ける）
 *  - 非商用は無料、CORS 許可済み
 *  - 過去92日〜先16日を同じエンドポイントで引ける（過去分の埋め戻しに使える）
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/** 一度に取得できる日数の上限（URL 長と応答サイズを抑えるため） */
export const MAX_FETCH_DAYS = 92;

export interface WeatherObservation {
  date: string;
  weather: WeatherKey;
  pressure_hpa: number | null;
  temperature: number | null;
  humidity: number | null;
}

export class WeatherError extends Error {}

/**
 * WMO weather code をアプリの5分類に落とす。
 * https://open-meteo.com/en/docs （WMO Weather interpretation codes）
 */
export function weatherCodeToKey(code: number): WeatherKey {
  if (code <= 1) return 'sunny';                      // 0 快晴 / 1 晴れ
  if (code <= 3) return 'cloudy';                     // 2 一部曇 / 3 曇り
  if (code === 45 || code === 48) return 'other';     // 霧
  if (code >= 71 && code <= 77) return 'snowy';       // 雪
  if (code === 85 || code === 86) return 'snowy';     // にわか雪
  if (code >= 51 && code <= 67) return 'rainy';       // 霧雨・雨・着氷性の雨
  if (code >= 80 && code <= 82) return 'rainy';       // にわか雨
  if (code >= 95) return 'rainy';                     // 雷雨
  return 'other';
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

interface OpenMeteoResponse {
  daily?: { time: string[]; weather_code: number[]; temperature_2m_mean: (number | null)[] };
  hourly?: { time: string[]; pressure_msl: (number | null)[]; relative_humidity_2m: (number | null)[] };
  error?: boolean;
  reason?: string;
}

/**
 * 期間の天気を取得する。
 * 気圧と湿度は1時間ごとの値しか返らないので、日ごとに平均して1日の代表値にする。
 */
export async function fetchWeatherRange(
  latitude: number,
  longitude: number,
  start: string,
  end: string,
  signal?: AbortSignal,
): Promise<WeatherObservation[]> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    start_date: start,
    end_date: end,
    daily: 'weather_code,temperature_2m_mean',
    hourly: 'pressure_msl,relative_humidity_2m',
    // 日付の区切りを端末のタイムゾーンに合わせる（日単位で記録するアプリなので重要）
    timezone: 'auto',
  });

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${params}`, { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new WeatherError('天気サービスに接続できませんでした。通信環境を確認してください。');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null) as OpenMeteoResponse | null;
    throw new WeatherError(body?.reason ?? `天気の取得に失敗しました (${res.status})`);
  }

  const body = await res.json() as OpenMeteoResponse;
  if (!body.daily) throw new WeatherError('天気の応答を解釈できませんでした。');

  // 1時間ごとの値を日付ごとにまとめる（time は "2026-06-08T13:00" 形式）
  const pressureByDate = new Map<string, number[]>();
  const humidityByDate = new Map<string, number[]>();
  const h = body.hourly;
  if (h) {
    for (let i = 0; i < h.time.length; i++) {
      const day = h.time[i].slice(0, 10);
      const p = h.pressure_msl?.[i];
      const rh = h.relative_humidity_2m?.[i];
      if (typeof p === 'number') {
        const a = pressureByDate.get(day) ?? []; a.push(p); pressureByDate.set(day, a);
      }
      if (typeof rh === 'number') {
        const a = humidityByDate.get(day) ?? []; a.push(rh); humidityByDate.set(day, a);
      }
    }
  }

  return body.daily.time.map((date, i) => ({
    date,
    weather: weatherCodeToKey(body.daily!.weather_code[i] ?? -1),
    pressure_hpa: mean(pressureByDate.get(date) ?? []),
    temperature: body.daily!.temperature_2m_mean?.[i] ?? null,
    humidity: humidityByDate.get(date) ? Math.round(mean(humidityByDate.get(date)!) ?? 0) : null,
  }));
}

/** 1日分だけ取得する */
export async function fetchWeatherDay(
  latitude: number, longitude: number, date: string, signal?: AbortSignal,
): Promise<WeatherObservation | null> {
  const rows = await fetchWeatherRange(latitude, longitude, date, date, signal);
  return rows.find((r) => r.date === date) ?? rows[0] ?? null;
}

/** 端末の位置情報を取得する（設定画面で1回だけ使う） */
export function getCurrentPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new WeatherError('この端末では位置情報を取得できません。緯度・経度を手入力してください。'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        // 小数第3位（約100m）まで。これ以上の精度は天気には不要で、保存する情報も減らせる
        latitude: Math.round(pos.coords.latitude * 1000) / 1000,
        longitude: Math.round(pos.coords.longitude * 1000) / 1000,
      }),
      () => reject(new WeatherError('位置情報を取得できませんでした。ブラウザの許可設定を確認するか、手入力してください。')),
      { timeout: 10_000, maximumAge: 60 * 60 * 1000 },
    );
  });
}
