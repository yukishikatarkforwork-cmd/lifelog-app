import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { UserSettings, WeatherKey, WeatherRecord } from '../lib/types';
import { WEATHER_OPTIONS } from '../lib/types';
import { parseNum } from '../lib/nutrition';
import { useReload } from '../lib/useReload';
import { fetchWeatherDay, WeatherError } from '../lib/weather';
import { IconWeather } from './icons';

export default function WeatherCard({ date }: { date: string }) {
  const { user } = useAuth();
  const [weather, setWeather] = useState<WeatherKey | null>(null);
  const [pressure, setPressure] = useState('');
  const [temp, setTemp] = useState('');
  const [humidity, setHumidity] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [fetching, setFetching] = useState(false);
  const [home, setHome] = useState<{ lat: number; lon: number } | null>(null);

  useReload(async () => {
    const [rec, settings] = await Promise.all([
      supabase.from('weather_records').select('*').eq('date', date).maybeSingle(),
      supabase.from('user_settings').select('home_latitude,home_longitude').maybeSingle(),
    ]);
    const st = settings.data as Pick<UserSettings, 'home_latitude' | 'home_longitude'> | null;
    setHome(
      st?.home_latitude != null && st?.home_longitude != null
        ? { lat: Number(st.home_latitude), lon: Number(st.home_longitude) }
        : null,
    );
    const { data } = rec;
    const r = data as WeatherRecord | null;
    setWeather(r?.weather ?? null);
    setPressure(r?.pressure_hpa?.toString() ?? '');
    setTemp(r?.temperature?.toString() ?? '');
    setHumidity(r?.humidity?.toString() ?? '');
    setMemo(r?.memo ?? '');
    setSaved(false);
  }, [date]);

  /** Open-Meteo から取り込む。保存はしないので、値を見てから保存ボタンを押してもらう */
  const autoFill = async () => {
    if (!home) return;
    setFetching(true);
    setErr('');
    try {
      const obs = await fetchWeatherDay(home.lat, home.lon, date);
      if (!obs) { setErr('この日の天気データが見つかりませんでした。'); return; }
      setWeather(obs.weather);
      setPressure(obs.pressure_hpa?.toString() ?? '');
      setTemp(obs.temperature?.toString() ?? '');
      setHumidity(obs.humidity?.toString() ?? '');
    } catch (e) {
      setErr(e instanceof WeatherError || e instanceof Error ? e.message : '天気の取得に失敗しました');
    } finally {
      setFetching(false);
    }
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('weather_records').upsert(
      {
        user_id: user.id, date, weather,
        pressure_hpa: parseNum(pressure), temperature: parseNum(temp),
        humidity: parseNum(humidity), memo: memo.trim() || null,
      },
      { onConflict: 'user_id,date' },
    );
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="card">
      <div className="section-title">
        <h2><IconWeather /> 天気・気圧</h2>
        {home && (
          <button data-testid="weather-auto" className="btn small outline" onClick={autoFill} disabled={fetching}>
            {fetching ? '取得中…' : '自動取得'}
          </button>
        )}
      </div>
      {err && <div className="error-box">{err}</div>}
      {!home && (
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          設定画面で位置を登録すると、天気・気圧・気温・湿度を自動で取得できます。
        </p>
      )}

      <div className="field">
        <label>天気</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {WEATHER_OPTIONS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWeather(weather === w.key ? null : w.key)}
              title={w.label}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 18,
                border: '1px solid var(--border)',
                background: weather === w.key ? 'var(--primary)' : 'var(--input-bg)',
              }}
            >
              {w.icon}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>気圧 (hPa)</label>
          <input type="number" inputMode="decimal" value={pressure} onChange={(e) => setPressure(e.target.value)} placeholder="例: 1013" />
        </div>
        <div className="field">
          <label>気温 (℃)</label>
          <input type="number" inputMode="decimal" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="例: 22" />
        </div>
        <div className="field">
          <label>湿度 (%)</label>
          <input type="number" inputMode="decimal" value={humidity} onChange={(e) => setHumidity(e.target.value)} placeholder="例: 60" />
        </div>
      </div>
      <div className="field">
        <label>メモ</label>
        <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="低気圧でだるい、など" />
      </div>
      <button data-testid="weather-save" className="btn full" onClick={save} disabled={saving}>
        {saving ? '保存中…' : saved ? '保存しました ✓' : '天気・気圧を保存'}
      </button>
      {home && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}>
          「自動取得」は値を入れるだけです。内容を確認してから保存してください。
        </p>
      )}
    </div>
  );
}
