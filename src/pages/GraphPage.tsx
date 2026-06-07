import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import type { MealEntry } from '../lib/types';
import { addDays, formatShort, todayStr } from '../lib/date';
import { fmt, pfcKcal, sumNutrition } from '../lib/nutrition';

const RANGES = [
  { days: 7, label: '7日' },
  { days: 14, label: '14日' },
  { days: 30, label: '30日' },
];

const COLORS = { protein: '#ef4444', fat: '#8b5cf6', carb: '#3b82f6' };

export default function GraphPage() {
  const [days, setDays] = useState(7);
  const [entries, setEntries] = useState<MealEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const start = useMemo(() => addDays(todayStr(), -(days - 1)), [days]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('meal_entries')
        .select('*')
        .gte('date', start)
        .lte('date', todayStr());
      if (error) { setError(error.message); setLoading(false); return; }
      setEntries((data as MealEntry[]) ?? []);
      setLoading(false);
    })();
  }, [start]);

  // 日別集計（記録のない日も 0 で埋める）
  const daily = useMemo(() => {
    const map = new Map<string, MealEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.date) ?? [];
      arr.push(e);
      map.set(e.date, arr);
    }
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const t = sumNutrition(map.get(d) ?? []);
      out.push({
        date: formatShort(d),
        calories: Math.round(t.calories),
        protein: Math.round(t.protein),
        fat: Math.round(t.fat),
        carbohydrate: Math.round(t.carbohydrate),
      });
    }
    return out;
  }, [entries, start, days]);

  const rangeTotal = useMemo(() => sumNutrition(entries), [entries]);
  const k = pfcKcal(rangeTotal);
  const pieData = [
    { name: 'たんぱく質', value: Math.round(k.protein), color: COLORS.protein },
    { name: '脂質', value: Math.round(k.fat), color: COLORS.fat },
    { name: '炭水化物', value: Math.round(k.carbohydrate), color: COLORS.carb },
  ].filter((d) => d.value > 0);

  const recordedDays = new Set(entries.map((e) => e.date)).size;
  const avgKcal = recordedDays > 0 ? rangeTotal.calories / recordedDays : 0;

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>栄養グラフ</h2>

      <div className="tabs">
        {RANGES.map((r) => (
          <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>
            {r.label}
          </button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}

      {loading ? (
        <div className="empty">読み込み中…</div>
      ) : entries.length === 0 ? (
        <div className="empty">この期間の記録がありません。</div>
      ) : (
        <>
          <div className="card">
            <h2>カロリー推移</h2>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              記録日数 {recordedDays} 日 ・ 平均 {fmt(avgKcal)} kcal/日
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={daily} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="calories" name="kcal" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h2>PFC 推移 (g)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="protein" name="P" stackId="a" fill={COLORS.protein} />
                <Bar dataKey="fat" name="F" stackId="a" fill={COLORS.fat} />
                <Bar dataKey="carbohydrate" name="C" stackId="a" fill={COLORS.carb} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {pieData.length > 0 && (
            <div className="card">
              <h2>PFC バランス（期間合計・カロリー比）</h2>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e) => e.name}>
                    {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `${v} kcal`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
