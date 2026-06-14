import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { DailyRecord } from '../lib/types';
import { parseNum } from '../lib/nutrition';

function ScoreSelector({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? null : n)}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, fontWeight: 700,
            border: '1px solid var(--border)',
            background: value === n ? 'var(--primary)' : '#fff',
            color: value === n ? '#fff' : 'var(--text)',
          }}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export default function ConditionCard({ date }: { date: string }) {
  const { user } = useAuth();
  const [condition, setCondition] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [sleep, setSleep] = useState('');
  const [headache, setHeadache] = useState(false);
  const [medication, setMedication] = useState(false);
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('daily_records').select('*').eq('date', date).maybeSingle();
    const r = data as DailyRecord | null;
    setCondition(r?.condition_score ?? null);
    setMood(r?.mood_score ?? null);
    setSleep(r?.sleep_hours?.toString() ?? '');
    setHeadache(r?.headache ?? false);
    setMedication(r?.medication ?? false);
    setMemo(r?.memo ?? '');
    setSaved(false);
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('daily_records').upsert(
      {
        user_id: user.id, date,
        condition_score: condition, mood_score: mood,
        sleep_hours: parseNum(sleep), headache, medication,
        memo: memo.trim() || null,
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
      <div className="section-title"><h2>🩺 体調</h2></div>
      {err && <div className="error-box">{err}</div>}

      <div className="field">
        <label>体調スコア（1=悪い 〜 5=良い）</label>
        <ScoreSelector value={condition} onChange={setCondition} />
      </div>
      <div className="field">
        <label>気分スコア（1〜5）</label>
        <ScoreSelector value={mood} onChange={setMood} />
      </div>
      <div className="grid-2">
        <div className="field">
          <label>睡眠時間 (h)</label>
          <input type="number" inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="例: 7" />
        </div>
        <div className="field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6 }}>
          <label className="row-between" style={{ cursor: 'pointer', margin: 0 }}>
            <span>頭痛</span>
            <input type="checkbox" style={{ width: 'auto' }} checked={headache} onChange={(e) => setHeadache(e.target.checked)} />
          </label>
          <label className="row-between" style={{ cursor: 'pointer', margin: 0 }}>
            <span>服薬</span>
            <input type="checkbox" style={{ width: 'auto' }} checked={medication} onChange={(e) => setMedication(e.target.checked)} />
          </label>
        </div>
      </div>
      <div className="field">
        <label>体調・1日のメモ</label>
        <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="気づいたこと、特筆事項など" />
      </div>
      <button data-testid="condition-save" className="btn full" onClick={save} disabled={saving}>
        {saving ? '保存中…' : saved ? '保存しました ✓' : '体調を保存'}
      </button>
    </div>
  );
}
