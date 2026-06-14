import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { DailyRecord, Expense, MealEntry } from '../lib/types';
import { toDateStr, todayStr } from '../lib/date';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
// 体調スコア 1..5 の色（悪い→良い）
const SCORE_BG: Record<number, string> = {
  1: '#fde2e1', 2: '#fdebd0', 3: '#fdf3c8', 4: '#e6f4d7', 5: '#d6f0dd',
};

const pad = (n: number) => String(n).padStart(2, '0');

export default function CalendarView() {
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-based

  const [cond, setCond] = useState<Map<string, number | null>>(new Map());
  const [kcal, setKcal] = useState<Map<string, number>>(new Map());
  const [exp, setExp] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const monthStart = toDateStr(new Date(year, month, 1));
  const monthEnd = toDateStr(new Date(year, month + 1, 0));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const load = useCallback(async () => {
    setLoading(true);
    const [c, m, e] = await Promise.all([
      supabase.from('daily_records').select('date,condition_score').gte('date', monthStart).lte('date', monthEnd),
      supabase.from('meal_entries').select('date,calories').gte('date', monthStart).lte('date', monthEnd),
      supabase.from('expenses').select('date').gte('date', monthStart).lte('date', monthEnd),
    ]);
    const cMap = new Map<string, number | null>();
    for (const r of (c.data as DailyRecord[]) ?? []) cMap.set(r.date, r.condition_score);
    const kMap = new Map<string, number>();
    for (const r of (m.data as Pick<MealEntry, 'date' | 'calories'>[]) ?? []) {
      kMap.set(r.date, (kMap.get(r.date) ?? 0) + (r.calories ?? 0));
    }
    const eSet = new Set<string>();
    for (const r of (e.data as Pick<Expense, 'date'>[]) ?? []) eSet.add(r.date);
    setCond(cMap); setKcal(kMap); setExp(eSet);
    setLoading(false);
  }, [monthStart, monthEnd]);

  useEffect(() => { void load(); }, [load]);

  const prevMonth = () => {
    const d = new Date(year, month - 1, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth());
  };
  const nextMonth = () => {
    const d = new Date(year, month + 1, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth());
  };

  const cells = useMemo(() => {
    const arr: (string | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(`${year}-${pad(month + 1)}-${pad(d)}`);
    return arr;
  }, [firstWeekday, daysInMonth, year, month]);

  const today = todayStr();

  return (
    <div className="card">
      <div className="date-nav" style={{ marginBottom: 10 }}>
        <button onClick={prevMonth} aria-label="前の月">‹</button>
        <div className="label">{year}年{month + 1}月</div>
        <button onClick={nextMonth} aria-label="次の月">›</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3, textAlign: 'center' }}>
        {WEEKDAYS.map((w, i) => (
          <div key={w} style={{ fontSize: 11, color: i === 0 ? 'var(--danger)' : i === 6 ? 'var(--carb)' : 'var(--muted)', padding: '2px 0' }}>{w}</div>
        ))}
        {cells.map((ds, i) => {
          if (!ds) return <div key={`b${i}`} />;
          const day = Number(ds.slice(8));
          const score = cond.get(ds);
          const hasMeal = (kcal.get(ds) ?? 0) > 0;
          const hasExp = exp.has(ds);
          const isToday = ds === today;
          return (
            <button
              key={ds}
              onClick={() => navigate(`/day/${ds}`)}
              style={{
                aspectRatio: '1 / 1', border: isToday ? '2px solid var(--primary)' : '1px solid var(--border)',
                borderRadius: 8, background: score ? SCORE_BG[score] : '#fff',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 2px', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: isToday ? 700 : 400 }}>{day}</span>
              <span style={{ fontSize: 9, lineHeight: 1 }}>
                {score ? <span style={{ fontWeight: 700 }}>{score}</span> : ''}
              </span>
              <span style={{ display: 'flex', gap: 2, height: 6 }}>
                {hasMeal && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--kcal)' }} />}
                {hasExp && <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--carb)' }} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="pfc-legend" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        <span>セル色＝体調(1〜5)</span>
        <span><span className="dot" style={{ background: 'var(--kcal)', borderRadius: 999 }} />食事あり</span>
        <span><span className="dot" style={{ background: 'var(--carb)', borderRadius: 999 }} />支出あり</span>
        {loading && <span className="muted">読み込み中…</span>}
      </div>
    </div>
  );
}
