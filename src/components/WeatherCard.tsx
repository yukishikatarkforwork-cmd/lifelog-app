import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { WeatherKey, WeatherRecord } from '../lib/types';
import { WEATHER_OPTIONS } from '../lib/types';
import { parseNum } from '../lib/nutrition';
import { useReload } from '../lib/useReload';
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

  useReload(async () => {
    const { data } = await supabase.from('weather_records').select('*').eq('date', date).maybeSingle();
    const r = data as WeatherRecord | null;
    setWeather(r?.weather ?? null);
    setPressure(r?.pressure_hpa?.toString() ?? '');
    setTemp(r?.temperature?.toString() ?? '');
    setHumidity(r?.humidity?.toString() ?? '');
    setMemo(r?.memo ?? '');
    setSaved(false);
  }, [date]);

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
      <div className="section-title"><h2><IconWeather /> 天気・気圧</h2></div>
      {err && <div className="error-box">{err}</div>}

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
    </div>
  );
}
