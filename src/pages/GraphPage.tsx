import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import type { DailyRecord, Expense, MealEntry, WeatherRecord } from '../lib/types';
import { addDays, formatShort, todayStr } from '../lib/date';
import { pfcKcal, sumNutrition } from '../lib/nutrition';

const RANGES = [
  { days: 7, label: '7日' },
  { days: 14, label: '14日' },
  { days: 30, label: '30日' },
];
const COLORS = { protein: '#ef4444', fat: '#8b5cf6', carb: '#3b82f6', kcal: '#f59e0b', condition: '#2f8f6b', pressure: '#3b82f6' };
const CAT_PALETTE = ['#2f8f6b', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#a3a3a3'];

export default function GraphPage() {
  const [days, setDays] = useState(7);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [conditions, setConditions] = useState<DailyRecord[]>([]);
  const [weathers, setWeathers] = useState<WeatherRecord[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const start = useMemo(() => addDays(todayStr(), -(days - 1)), [days]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      const today = todayStr();
      const [m, c, w, e] = await Promise.all([
        supabase.from('meal_entries').select('*').gte('date', start).lte('date', today),
        supabase.from('daily_records').select('*').gte('date', start).lte('date', today),
        supabase.from('weather_records').select('*').gte('date', start).lte('date', today),
        supabase.from('expenses').select('*').gte('date', start).lte('date', today),
      ]);
      const err = m.error || c.error || w.error || e.error;
      if (err) setError(err.message);
      setMeals((m.data as MealEntry[]) ?? []);
      setConditions((c.data as DailyRecord[]) ?? []);
      setWeathers((w.data as WeatherRecord[]) ?? []);
      setExpenses((e.data as Expense[]) ?? []);
      setLoading(false);
    })();
  }, [start]);

  // 食事: 日別集計
  const daily = useMemo(() => {
    const map = new Map<string, MealEntry[]>();
    for (const x of meals) { const a = map.get(x.date) ?? []; a.push(x); map.set(x.date, a); }
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const t = sumNutrition(map.get(d) ?? []);
      out.push({
        date: formatShort(d),
        calories: Math.round(t.calories), protein: Math.round(t.protein),
        fat: Math.round(t.fat), carbohydrate: Math.round(t.carbohydrate),
      });
    }
    return out;
  }, [meals, start, days]);

  // 体調×気圧: 日別
  const condPress = useMemo(() => {
    const cMap = new Map(conditions.map((r) => [r.date, r.condition_score]));
    const wMap = new Map(weathers.map((r) => [r.date, r.pressure_hpa]));
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      out.push({ date: formatShort(d), condition: cMap.get(d) ?? null, pressure: wMap.get(d) ?? null });
    }
    return out;
  }, [conditions, weathers, start, days]);
  const hasCondPress = conditions.length > 0 || weathers.length > 0;

  // 支出: カテゴリ別集計
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const x of expenses) map.set(x.category, (map.get(x.category) ?? 0) + (x.amount ?? 0));
    return [...map.entries()].map(([name, value], i) => ({ name, value, color: CAT_PALETTE[i % CAT_PALETTE.length] }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);
  const expenseTotal = expenses.reduce((s, x) => s + (x.amount ?? 0), 0);

  const rangeTotal = useMemo(() => sumNutrition(meals), [meals]);
  const k = pfcKcal(rangeTotal);
  const pieData = [
    { name: 'たんぱく質', value: Math.round(k.protein), color: COLORS.protein },
    { name: '脂質', value: Math.round(k.fat), color: COLORS.fat },
    { name: '炭水化物', value: Math.round(k.carbohydrate), color: COLORS.carb },
  ].filter((d) => d.value > 0);

  return (
    <div className="page">
      <h2 style={{ marginTop: 0 }}>分析ダッシュボード</h2>

      <div className="tabs">
        {RANGES.map((r) => (
          <button key={r.days} className={days === r.days ? 'active' : ''} onClick={() => setDays(r.days)}>{r.label}</button>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
      {loading && <div className="empty">読み込み中…</div>}

      {!loading && (
        <>
          {/* 体調×気圧 */}
          <div className="card">
            <h2>体調 × 気圧</h2>
            {!hasCondPress ? (
              <div className="muted" style={{ fontSize: 13 }}>体調・気圧の記録がありません。</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={condPress} margin={{ top: 5, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" domain={[0, 5]} tick={{ fontSize: 10 }} width={28} />
                  <YAxis yAxisId="right" orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 10 }} width={40} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left" type="monotone" dataKey="condition" name="体調(1-5)" stroke={COLORS.condition} strokeWidth={2} connectNulls dot={{ r: 2 }} />
                  <Line yAxisId="right" type="monotone" dataKey="pressure" name="気圧(hPa)" stroke={COLORS.pressure} strokeWidth={2} connectNulls dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 支出カテゴリ別 */}
          <div className="card">
            <h2>支出カテゴリ別 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>合計 ¥{expenseTotal.toLocaleString()}</span></h2>
            {byCategory.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>支出の記録がありません。</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(d) => d.name}>
                    {byCategory.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v) => `¥${Number(v).toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* 栄養（既存） */}
          {meals.length === 0 ? (
            <div className="card"><div className="muted" style={{ fontSize: 13 }}>この期間の食事記録がありません。</div></div>
          ) : (
            <>
              <div className="card">
                <h2>カロリー推移</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={daily} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="calories" name="kcal" stroke={COLORS.kcal} strokeWidth={2} dot={{ r: 2 }} />
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
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(d) => d.name}>
                        {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${v} kcal`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
