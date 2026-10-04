import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '../lib/supabase';
import type { BodyRecord, DailyRecord, Expense, MealEntry, WeatherRecord } from '../lib/types';
import { addDays, formatShort, todayStr } from '../lib/date';
import { pfcKcal, sumNutrition } from '../lib/nutrition';
import { correlationLabel, mean, pearson } from '../lib/analysis';
import { fetchAllRows } from '../lib/fetchAll';
import { useAuth } from '../context/AuthContext';

const RANGES = [
  { days: 7, label: '7日' },
  { days: 14, label: '14日' },
  { days: 30, label: '30日' },
  { days: 90, label: '3か月' },
  { days: 180, label: '半年' },
  { days: 365, label: '1年' },
];
const COLORS = { protein: '#e07070', fat: '#c4954a', carb: '#6baac0', kcal: '#e9a94d', condition: '#2f8f6b', pressure: '#6baac0', weight: '#2f8f6b', bodyFat: '#e9a94d' };
/**
 * 体重・体脂肪率以外の体組成。Health Planet が返す項目で、データがあるものだけグラフを出す
 * （機種によって送ってくる項目が違う。体重と体脂肪率しか無い機種も多い）。
 */
const BODY_METRICS: Array<{ key: keyof Pick<BodyRecord, 'muscle_kg' | 'visceral_fat_level' | 'basal_metabolism_kcal' | 'body_age' | 'bone_kg'>; label: string; unit: string; digits: number }> = [
  { key: 'muscle_kg', label: '筋肉量', unit: 'kg', digits: 1 },
  { key: 'visceral_fat_level', label: '内臓脂肪レベル', unit: '', digits: 1 },
  { key: 'basal_metabolism_kcal', label: '基礎代謝', unit: 'kcal', digits: 0 },
  { key: 'body_age', label: '体内年齢', unit: '歳', digits: 0 },
  { key: 'bone_kg', label: '推定骨量', unit: 'kg', digits: 1 },
];
const CAT_PALETTE = ['#2f8f6b', '#6baac0', '#e9a94d', '#e07070', '#7ab5a0', '#c4954a', '#8fa8b8', '#a3a3a3'];

/** 記録のある点の数。少なければ点を打ち、多ければ線だけにする（365点に丸を打つと塗りつぶしになる） */
const DOT_LIMIT = 45;
const NICE_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];

/**
 * 体重などの単一系列の推移。
 * - 1軸だけ（体重と体脂肪率を1枚に重ねると、2本の軸で交差して読めなくなる）
 * - 線は直線でつなぐ。曲線補間は無い日の値をでっち上げて見せてしまう
 * - 縦軸は値の幅に少し余白を足した範囲にして、変化が見える倍率にする
 */
function TrendChart({ data, dataKey, name, unit, digits, color, height }: {
  data: Array<Record<string, number | string | null>>;
  dataKey: string; name: string; unit: string; digits: number; color: string; height: number;
}) {
  const values = data.map((d) => d[dataKey]).filter((v): v is number => typeof v === 'number');
  const points = values.length;
  const [lo, hi] = values.length > 0 ? [Math.min(...values), Math.max(...values)] : [0, 1];
  // 目盛りは 0.1 / 0.2 / 0.5 / 1 / 2 / 5 … のきりのいい刻みにし、値の幅に少し余白を足した範囲を 4〜5 本で割る
  const pad = Math.max((hi - lo) * 0.15, digits > 0 ? 0.2 : 1);
  const step = NICE_STEPS.find((st) => (hi - lo + pad * 2) / st <= 5) ?? NICE_STEPS[NICE_STEPS.length - 1];
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  const fmt = (v: unknown) => Number(v).toFixed(digits);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={28} />
        <YAxis
          domain={[min, max]} ticks={ticks}
          tick={{ fontSize: 10, fill: 'var(--muted)' }} tickLine={false} axisLine={false}
          width={46} tickFormatter={fmt}
        />
        <Tooltip
          formatter={(v) => [`${fmt(v)} ${unit}`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }}
          cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
        />
        <Line
          type="linear" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} connectNulls isAnimationActive={false}
          dot={points <= DOT_LIMIT ? { r: 3.5, fill: color, stroke: 'var(--card)', strokeWidth: 1.5 } : false}
          activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function GraphPage() {
  const { user } = useAuth();
  const [days, setDays] = useState(7);
  const [meals, setMeals] = useState<MealEntry[]>([]);
  const [conditions, setConditions] = useState<DailyRecord[]>([]);
  const [weathers, setWeathers] = useState<WeatherRecord[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [bodies, setBodies] = useState<BodyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const start = useMemo(() => addDays(todayStr(), -(days - 1)), [days]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      const today = todayStr();
      // 1年分の食事・支出は 1000 行を超えるので、全テーブルをページングで取る
      const page = (table: string) => (from: number, to: number) =>
        supabase.from(table).select('*').eq('user_id', user?.id ?? '').gte('date', start).lte('date', today)
          .order('date').order('created_at').range(from, to);
      try {
        const [m, c, w, e, b] = await Promise.all([
          fetchAllRows<MealEntry>(page('meal_entries')),
          fetchAllRows<DailyRecord>(page('daily_records')),
          fetchAllRows<WeatherRecord>(page('weather_records')),
          fetchAllRows<Expense>(page('expenses')),
          fetchAllRows<BodyRecord>(page('body_records')),
        ]);
        setMeals(m);
        setConditions(c);
        setWeathers(w);
        setExpenses(e);
        setBodies(b);
      } catch (err) {
        setError(err instanceof Error ? err.message : '記録の取得に失敗しました');
      }
      setLoading(false);
    })();
  }, [start, user?.id]);

  // 3か月以上は棒グラフが潰れるので、食事は週ごと（記録のあった日の平均）にまとめる
  const bucketDays = days > 60 ? 7 : 1;

  // 食事: 日別（長期間は週別平均）集計
  const daily = useMemo(() => {
    const map = new Map<string, MealEntry[]>();
    for (const x of meals) { const a = map.get(x.date) ?? []; a.push(x); map.set(x.date, a); }
    const out = [];
    for (let i = 0; i < days; i += bucketDays) {
      let recorded = 0;
      const sum = { calories: 0, protein: 0, fat: 0, carbohydrate: 0 };
      for (let j = i; j < Math.min(i + bucketDays, days); j++) {
        const list = map.get(addDays(start, j)) ?? [];
        if (list.length === 0) continue;
        const t = sumNutrition(list);
        sum.calories += t.calories; sum.protein += t.protein; sum.fat += t.fat; sum.carbohydrate += t.carbohydrate;
        recorded++;
      }
      const n = Math.max(recorded, 1);
      out.push({
        date: formatShort(addDays(start, i)),
        calories: Math.round(sum.calories / n), protein: Math.round(sum.protein / n),
        fat: Math.round(sum.fat / n), carbohydrate: Math.round(sum.carbohydrate / n),
      });
    }
    return out;
  }, [meals, start, days, bucketDays]);

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

  // 体重・体脂肪率: 日別（記録のない日は欠損にして線をつなぐ）
  const bodyTrend = useMemo(() => {
    const map = new Map(bodies.map((r) => [r.date, r]));
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(start, i);
      const r = map.get(d);
      out.push({
        date: formatShort(d), weight: r?.weight_kg ?? null, bodyFat: r?.body_fat_pct ?? null,
        muscle_kg: r?.muscle_kg ?? null, visceral_fat_level: r?.visceral_fat_level ?? null,
        basal_metabolism_kcal: r?.basal_metabolism_kcal ?? null, body_age: r?.body_age ?? null, bone_kg: r?.bone_kg ?? null,
      });
    }
    return out;
  }, [bodies, start, days]);
  // データのある体組成項目だけ。最新値と期間最初からの増減を添える
  const bodyMetrics = useMemo(() => BODY_METRICS.flatMap((m) => {
    const rows = bodies.filter((r) => r[m.key] != null);
    if (rows.length === 0) return [];
    const first = rows[0][m.key]!;
    const last = rows[rows.length - 1][m.key]!;
    return [{ ...m, latest: last, delta: Math.round((last - first) * 10) / 10, days: rows.length }];
  }), [bodies]);
  const bodySummary = useMemo(() => {
    const ws = bodies.filter((r) => r.weight_kg != null);
    if (ws.length === 0) return null;
    const first = ws[0].weight_kg!;
    const last = ws[ws.length - 1].weight_kg!;
    return { latest: last, delta: Math.round((last - first) * 10) / 10, days: ws.length };
  }, [bodies]);
  const hasBodyFat = bodies.some((r) => r.body_fat_pct != null);

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
    const bodyDates = new Set(bodies.filter((r) => r.weight_kg != null).map((r) => r.date));
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
      if (c || (k && k > 0) || (e && e > 0) || w || bodyDates.has(d)) recorded++;
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
  }, [conditions, weathers, meals, expenses, bodies, start, days]);

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
                {
                  label: '体重（期間の増減）',
                  value: bodySummary
                    ? `${bodySummary.latest.toFixed(1)} kg（${bodySummary.delta > 0 ? '+' : ''}${bodySummary.delta.toFixed(1)}）`
                    : '—',
                },
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

          {/* 体重・体脂肪率（軸が違うので同じ図に重ねず、縦に並べる） */}
          <div className="card">
            <h2>体重 {bodySummary && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{bodySummary.days} 日分</span>}</h2>
            {bodies.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>体重の記録がありません。「今日」画面で入力するか、設定で Health Planet と連携してください。</div>
            ) : (
              <>
                <TrendChart data={bodyTrend} dataKey="weight" name="体重" unit="kg" digits={1} color={COLORS.weight} height={190} />
                {hasBodyFat && (
                  <>
                    <div className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 2 }}>体脂肪率 (%)</div>
                    <TrendChart data={bodyTrend} dataKey="bodyFat" name="体脂肪率" unit="%" digits={1} color={COLORS.bodyFat} height={130} />
                  </>
                )}
              </>
            )}
          </div>

          {/* 体組成（データのある項目だけ） */}
          {bodyMetrics.map((m) => (
            <div className="card" key={m.key}>
              <h2>
                {m.label}
                <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  {' '}最新 {m.latest.toFixed(m.digits)}{m.unit}（{m.delta > 0 ? '+' : ''}{m.delta.toFixed(m.digits)}）・{m.days} 日分
                </span>
              </h2>
              <TrendChart data={bodyTrend} dataKey={m.key} name={m.label} unit={m.unit} digits={m.digits} color={COLORS.weight} height={170} />
            </div>
          ))}

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
                <h2>カロリー推移{bucketDays > 1 && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> 週別平均</span>}</h2>
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
                <h2>PFC 推移 (g){bucketDays > 1 && <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> 週別平均</span>}</h2>
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
