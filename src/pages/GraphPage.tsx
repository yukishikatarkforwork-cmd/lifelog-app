import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import type { DailyRecord, Expense, MealEntry, WeatherRecord } from '../lib/types';
import { addDays, formatShort, todayStr } from '../lib/date';
import { pfcKcal, sumNutrition } from '../lib/nutrition';
import { correlationLabel, mean, pearson } from '../lib/analysis';

const RANGES = [
  { days: 7, label: '7日' },
  { days: 14, label: '14日' },
  { days: 30, label: '30日' },
];
const COLORS = { protein: '#e07070', fat: '#c4954a', carb: '#6baac0', kcal: '#e9a94d', condition: '#2f8f6b', pressure: '#6baac0' };
const CAT_PALETTE = ['#2f8f6b', '#6baac0', '#e9a94d', '#e07070', '#7ab5a0', '#c4954a', '#8fa8b8', '#a3a3a3'];

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

  // 分析: KPI・相関・条件別平均体調
  const analysis = useMemo(() => {
    const condMap = new Map(conditions.map((r) => [r.date, r]));
    const wMap = new Map(weathers.map((r) => [r.date, r]));
    const kcalMap = new Map<string, number>();
    for (const m of meals) kcalMap.set(m.date, (kcalMap.get(m.date) ?? 0) + (m.calories ?? 0));
    const expMap = new Map<string, number>();
    for (const e of expenses) expMap.set(e.date, (expMap.get(e.date) ?? 0) + (e.amount ?? 0));

    const dates: string[] = [];
    for (let i = 0; i < days; i++) dates.push(addDays(start, i));

    // 気圧の前日差（記録のある気圧日同士）
    const deltaMap = new Map<string, number>();
    let prevP: number | null = null;
    for (const d of dates) {
      const p = wMap.get(d)?.pressure_hpa ?? null;
      if (p != null) { if (prevP != null) deltaMap.set(d, p - prevP); prevP = p; }
    }

    const condScores: number[] = [], sleeps: number[] = [];
    let totalKcal = 0, daysMeal = 0, totalExp = 0, daysExp = 0, recorded = 0;
    const prPress: Array<[number, number]> = [], prDelta: Array<[number, number]> = [], prSleep: Array<[number, number]> = [];
    const headNo: number[] = [], headYes: number[] = [], sleepGood: number[] = [], sleepShort: number[] = [], wSunny: number[] = [], wBad: number[] = [];

    for (const d of dates) {
      const c = condMap.get(d);
      const k = kcalMap.get(d); const e = expMap.get(d); const w = wMap.get(d);
      if (c || (k && k > 0) || (e && e > 0) || w) recorded++;
      if (k != null && k > 0) { totalKcal += k; daysMeal++; }
      if (e != null && e > 0) { totalExp += e; daysExp++; }
      if (c?.sleep_hours != null) sleeps.push(c.sleep_hours);
      if (c?.condition_score == null) continue;
      const cs = c.condition_score;
      condScores.push(cs);
      const p = w?.pressure_hpa ?? null; if (p != null) prPress.push([cs, p]);
      const dp = deltaMap.get(d); if (dp != null) prDelta.push([cs, dp]);
      if (c.sleep_hours != null) prSleep.push([cs, c.sleep_hours]);
      if (c.headache) headYes.push(cs); else headNo.push(cs);
      if (c.sleep_hours != null) { if (c.sleep_hours >= 7) sleepGood.push(cs); else sleepShort.push(cs); }
      if (w?.weather === 'sunny') wSunny.push(cs);
      else if (w?.weather === 'rainy' || w?.weather === 'cloudy' || w?.weather === 'snowy') wBad.push(cs);
    }

    const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
    const groups = [
      { label: '頭痛なし', value: mean(headNo) }, { label: '頭痛あり', value: mean(headYes) },
      { label: '睡眠7h以上', value: mean(sleepGood) }, { label: '睡眠7h未満', value: mean(sleepShort) },
      { label: '晴れ', value: mean(wSunny) }, { label: '雨・曇り', value: mean(wBad) },
    ].filter((g) => g.value != null).map((g) => ({ label: g.label, value: r1(g.value)! }));

    const correlations = [
      { label: '体調 × 気圧', r: pearson(prPress) },
      { label: '体調 × 気圧の前日差(Δ)', r: pearson(prDelta) },
      { label: '体調 × 睡眠時間', r: pearson(prSleep) },
    ];

    return {
      avgCondition: r1(mean(condScores)), avgSleep: r1(mean(sleeps)),
      avgKcal: daysMeal ? Math.round(totalKcal / daysMeal) : null,
      avgExpense: daysExp ? Math.round(totalExp / daysExp) : null,
      continuity: Math.round((recorded / days) * 100), recorded, totalDays: days,
      groups, correlations,
    };
  }, [conditions, weathers, meals, expenses, start, days]);

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
          {/* 期間サマリー */}
          <div className="card">
            <h2>期間サマリー</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {[
                { label: '平均体調', value: analysis.avgCondition != null ? `${analysis.avgCondition} / 5` : '—' },
                { label: '平均睡眠', value: analysis.avgSleep != null ? `${analysis.avgSleep} h` : '—' },
                { label: '平均摂取カロリー', value: analysis.avgKcal != null ? `${analysis.avgKcal} kcal` : '—' },
                { label: '平均支出/日', value: analysis.avgExpense != null ? `¥${analysis.avgExpense.toLocaleString()}` : '—' },
              ].map((s) => (
                <div key={s.label} style={{ background: 'var(--fill-2)', borderRadius: 10, padding: '10px 12px' }}>
                  <div className="muted" style={{ fontSize: 11 }}>{s.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{s.value}</div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', background: 'var(--fill-2)', borderRadius: 10, padding: '10px 12px' }}>
                <div className="muted" style={{ fontSize: 11 }}>記録継続率</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {analysis.continuity}% <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>({analysis.recorded}/{analysis.totalDays}日)</span>
                </div>
              </div>
            </div>
          </div>

          {/* 相関分析 */}
          <div className="card">
            <h2>相関分析（体調との関係）</h2>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>相関係数 r（−1〜+1）。記録が3日以上ある項目のみ。気圧は急な低下（Δが負）ほど体調が下がりやすい傾向を見ます。</p>
            {analysis.correlations.map((c) => (
              <div className="row-between" key={c.label} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13 }}>{c.label}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  {c.r == null ? <span className="muted" style={{ fontWeight: 400 }}>データ不足</span> : `${c.r > 0 ? '+' : ''}${c.r.toFixed(2)}（${correlationLabel(c.r)}）`}
                </span>
              </div>
            ))}
          </div>

          <div className="graph-grid">

          {/* 条件別の平均体調 */}
          {analysis.groups.length > 0 && (
            <div className="card">
              <h2>条件別の平均体調</h2>
              <ResponsiveContainer width="100%" height={Math.max(150, analysis.groups.length * 36)}>
                <BarChart data={analysis.groups} layout="vertical" margin={{ top: 0, right: 28, left: 28, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={84} />
                  <Tooltip />
                  <Bar dataKey="value" name="平均体調" fill="#2f8f6b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

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
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={byCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                      {byCategory.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => `¥${Number(v).toLocaleString()}`} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {byCategory.map((d) => {
                    const pct = expenseTotal > 0 ? Math.round(d.value / expenseTotal * 100) : 0;
                    return (
                      <div key={d.name} className="row-between" style={{ fontSize: 13 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0, display: 'inline-block' }} />
                          {d.name}
                        </span>
                        <span>
                          <span className="muted" style={{ marginRight: 10 }}>{pct}%</span>
                          <span style={{ fontWeight: 600 }}>¥{d.value.toLocaleString()}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 栄養（既存） */}
          {meals.length === 0 ? (
            <div className="card graph-grid-full"><div className="muted" style={{ fontSize: 13 }}>この期間の食事記録がありません。</div></div>
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
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}>
                        {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v) => `${v} kcal`} />
                    </PieChart>
                  </ResponsiveContainer>
                  {(() => {
                    const total = pieData.reduce((s, d) => s + d.value, 0);
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                        {pieData.map((d) => {
                          const pct = total > 0 ? Math.round(d.value / total * 100) : 0;
                          return (
                            <div key={d.name} className="row-between" style={{ fontSize: 13 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0, display: 'inline-block' }} />
                                {d.name}
                              </span>
                              <span>
                                <span className="muted" style={{ marginRight: 10 }}>{pct}%</span>
                                <span style={{ fontWeight: 600 }}>{d.value} kcal</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
            </>
          )}
          </div>{/* /graph-grid */}
        </>
      )}
    </div>
  );
}
