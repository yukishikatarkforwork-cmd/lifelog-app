import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { UserSettings } from '../lib/types';
import { addDays, todayStr } from '../lib/date';
import { useReload } from '../lib/useReload';
import {
  fetchWeatherRange, getCurrentPosition, MAX_FETCH_DAYS, WeatherError,
} from '../lib/weather';
import { IconWeather } from './icons';

/** 埋め戻しの選択肢。Open-Meteo が同一エンドポイントで返せるのは過去92日まで */
const BACKFILL_OPTIONS = [7, 30, 92];

/**
 * 天気の自動取得の設定。
 *
 * 「体調 × 気圧」がこのアプリの目玉なのに気圧が手入力だと、
 * ほぼ誰も入力せず分析機能が死ぬ。位置を一度登録すれば以降は自動で埋まる。
 * 既存の記録にも効くよう、過去分をまとめて取り込む導線も置いている。
 */
export default function WeatherSettingsCard() {
  const { user } = useAuth();
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useReload(async () => {
    const { data } = await supabase
      .from('user_settings').select('home_latitude,home_longitude,home_label').maybeSingle();
    const s = data as Pick<UserSettings, 'home_latitude' | 'home_longitude' | 'home_label'> | null;
    setLat(s?.home_latitude?.toString() ?? '');
    setLon(s?.home_longitude?.toString() ?? '');
    setLabel(s?.home_label ?? '');
  }, [user?.id]);

  const locate = async () => {
    setLocating(true);
    setErr('');
    try {
      const pos = await getCurrentPosition();
      setLat(String(pos.latitude));
      setLon(String(pos.longitude));
      setMsg('現在地を取得しました。保存してください。');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '位置情報の取得に失敗しました');
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!user) return;
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
      setErr('緯度は -90〜90 の数値で入力してください。');
      return;
    }
    if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
      setErr('経度は -180〜180 の数値で入力してください。');
      return;
    }
    setSaving(true);
    setErr('');
    setMsg('');
    const { error } = await supabase.from('user_settings').upsert(
      {
        user_id: user.id,
        home_latitude: latNum, home_longitude: lonNum,
        home_label: label.trim() || null,
      },
      { onConflict: 'user_id' },
    );
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setMsg('位置を保存しました。「今日」画面の天気カードに「自動取得」が出ます。');
  };

  /**
   * 過去分をまとめて取り込む。
   * 既に天気が入っている日は上書きしない（手で直した値を潰さないため）。
   */
  const backfill = async (days: number) => {
    if (!user) return;
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      setErr('先に位置を保存してください。');
      return;
    }

    setBackfilling(true);
    setErr('');
    setMsg('');
    try {
      const end = todayStr();
      const start = addDays(end, -(Math.min(days, MAX_FETCH_DAYS) - 1));

      const [obs, existing] = await Promise.all([
        fetchWeatherRange(latNum, lonNum, start, end),
        supabase.from('weather_records').select('date,pressure_hpa,weather').gte('date', start).lte('date', end),
      ]);
      if (existing.error) throw new Error(existing.error.message);

      // 既に値が入っている日は触らない
      const filled = new Set(
        ((existing.data as Array<{ date: string; pressure_hpa: number | null; weather: string | null }>) ?? [])
          .filter((r) => r.pressure_hpa != null || r.weather != null)
          .map((r) => r.date),
      );

      const rows = obs
        .filter((o) => !filled.has(o.date))
        .map((o) => ({
          user_id: user.id, date: o.date,
          weather: o.weather, pressure_hpa: o.pressure_hpa,
          temperature: o.temperature, humidity: o.humidity, memo: null,
        }));

      if (rows.length === 0) {
        setMsg('この期間の天気はすでに入力済みでした。');
        return;
      }

      const { error } = await supabase
        .from('weather_records').upsert(rows, { onConflict: 'user_id,date' });
      if (error) throw new Error(error.message);

      setMsg(`${rows.length} 日分の天気・気圧を取り込みました（入力済みの ${obs.length - rows.length} 日はそのままです）。`);
    } catch (e) {
      setErr(e instanceof WeatherError || e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setBackfilling(false);
    }
  };

  const hasLocation = lat !== '' && lon !== '';

  return (
    <div className="card">
      <h2><IconWeather /> 天気の自動取得</h2>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        位置を登録すると、天気・気圧・気温・湿度を自動で入力できます（Open-Meteo・無料・APIキー不要）。
      </p>

      {msg && <div className="info-box">{msg}</div>}
      {err && <div className="error-box">{err}</div>}

      <button className="btn outline full" onClick={locate} disabled={locating}>
        {locating ? '取得中…' : '現在地から設定'}
      </button>

      <div className="grid-2" style={{ marginTop: 10 }}>
        <div className="field">
          <label>緯度</label>
          <input data-testid="home-lat" type="number" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="例: 35.681" />
        </div>
        <div className="field">
          <label>経度</label>
          <input data-testid="home-lon" type="number" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="例: 139.767" />
        </div>
      </div>
      <div className="field">
        <label>地点名（任意）</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: 自宅" />
      </div>

      <button data-testid="home-save" className="btn full" onClick={save} disabled={saving || !hasLocation}>
        {saving ? '保存中…' : '位置を保存'}
      </button>

      {hasLocation && (
        <>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12 }}>
            <strong style={{ fontSize: 14 }}>過去の天気をまとめて取り込む</strong>
            <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              すでに入力済みの日は上書きしません。取り込むと「分析」画面の体調×気圧が使えるようになります。
            </p>
            <div className="stack-sm">
              {BACKFILL_OPTIONS.map((d) => (
                <button
                  key={d}
                  className="btn outline full"
                  onClick={() => void backfill(d)}
                  disabled={backfilling}
                >
                  {backfilling ? '取り込み中…' : `直近 ${d} 日分を取り込む`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
