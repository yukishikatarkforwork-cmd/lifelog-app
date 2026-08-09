// =====================================================================
// 記録の取得と整形（Edge Function 共通）
//
// 集計は必ず lifelog_stats() RPC を使う。行を取り寄せて数えてはいけない。
// PostgREST は1リクエスト1000行で打ち切られるため、長期間だと件数が欠けて
// 平均が静かに狂う（気づけないタイプのバグになる）。
// =====================================================================
import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2.107.0';

export const MEAL_LABELS: Record<string, string> = {
  breakfast: '朝食', lunch: '昼食', dinner: '夕食', snack: '間食',
};
export const WEATHER_LABELS: Record<string, string> = {
  sunny: '晴れ', cloudy: '曇り', rainy: '雨', snowy: '雪', other: 'その他',
};

export interface MealRow {
  date: string; meal_type: string; food_name: string; amount: string | null;
  calories: number | null; protein: number | null; fat: number | null;
  carbohydrate: number | null; memo: string | null;
}
export interface ConditionRow {
  date: string; condition_score: number | null; mood_score: number | null;
  sleep_hours: number | null; headache: boolean; medication: boolean; memo: string | null;
}
export interface WeatherRow {
  date: string; weather: string | null; pressure_hpa: number | null;
  temperature: number | null; humidity: number | null;
}
export interface ExpenseRow {
  date: string; amount: number; category: string; payment_method: string | null; memo: string | null;
}
export interface DiaryRow {
  date: string; title: string | null; body: string; tags: string[] | null;
}

export interface Dataset {
  meals: MealRow[];
  conditions: ConditionRow[];
  weathers: WeatherRow[];
  expenses: ExpenseRow[];
  diaries: DiaryRow[];
}

/** PostgREST の1000行制限を越えるため、range で分割して全件取る */
const PAGE = 1000;
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** 期間内の生データを全件取得する（件数が多いときもページングで欠けない） */
export async function fetchRange(
  supabase: SupabaseClient,
  start: string,
  end: string,
  dates?: string[],
): Promise<Dataset> {
  // 日付を明示された場合はその日だけ引く（RAG で拾った日の詳細を出すときに使う）
  const page = (table: string, cols: string) => (from: number, to: number) => {
    const base = supabase.from(table).select(cols);
    const filtered = dates ? base.in('date', dates) : base.gte('date', start).lte('date', end);
    return filtered.order('date').range(from, to);
  };

  const [meals, conditions, weathers, expenses, diaries] = await Promise.all([
    fetchAll<MealRow>(page('meal_entries', 'date,meal_type,food_name,amount,calories,protein,fat,carbohydrate,memo')),
    fetchAll<ConditionRow>(page('daily_records', 'date,condition_score,mood_score,sleep_hours,headache,medication,memo')),
    fetchAll<WeatherRow>(page('weather_records', 'date,weather,pressure_hpa,temperature,humidity')),
    fetchAll<ExpenseRow>(page('expenses', 'date,amount,category,payment_method,memo')),
    fetchAll<DiaryRow>(page('diary_entries', 'date,title,body,tags')),
  ]);

  return { meals, conditions, weathers, expenses, diaries };
}

// ---------- 集計サマリー ----------

export interface Stats {
  period: { start: string; end: string };
  condition: {
    days: number; avg_condition: number | null; avg_mood: number | null;
    avg_sleep: number | null; headache_days: number; medication_days: number;
  };
  meals: { days: number; items: number; avg_kcal: number | null; avg_p: number | null; avg_f: number | null; avg_c: number | null };
  expenses: { total: number; count: number; days: number; by_category: Array<{ category: string; total: number; count: number }> };
  diary_count: number;
  correlation: {
    pressure_condition: { r: number | null; n: number };
    sleep_condition: { r: number | null; n: number };
  };
}

const r1 = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(1));
const r2 = (v: number | null | undefined) => (v == null ? '—' : Number(v).toFixed(2));
const yen = (v: number) => `¥${Math.round(v).toLocaleString()}`;

/**
 * 集計値を先に確定させて渡す。
 * 「平均は？」「一番多いカテゴリは？」を本文から数え直させると誤差が出るため。
 */
export function formatStats(s: Stats): string {
  const lines: string[] = ['## 集計サマリー（SQLで計算済み・この数値を正とする）', ''];
  lines.push(`対象期間: ${s.period.start} 〜 ${s.period.end}`);
  lines.push(
    `体調記録 ${s.condition.days} 日 / 平均体調 ${r1(s.condition.avg_condition)} (1〜5) / ` +
    `平均気分 ${r1(s.condition.avg_mood)} / 平均睡眠 ${r1(s.condition.avg_sleep)} h`,
  );
  lines.push(`頭痛のあった日 ${s.condition.headache_days} 日 / 服薬した日 ${s.condition.medication_days} 日`);
  lines.push(
    `食事記録 ${s.meals.days} 日 (${s.meals.items} 品) / 1日平均 ${r1(s.meals.avg_kcal)} kcal / ` +
    `P ${r1(s.meals.avg_p)} / F ${r1(s.meals.avg_f)} / C ${r1(s.meals.avg_c)} g`,
  );
  lines.push(`支出 合計 ${yen(s.expenses.total)} (${s.expenses.count} 件 / ${s.expenses.days} 日)`);
  if (s.expenses.by_category.length > 0) {
    lines.push(`カテゴリ別（多い順）: ${s.expenses.by_category.map((c) => `${c.category} ${yen(c.total)}`).join(' / ')}`);
  }
  lines.push(`日記 ${s.diary_count} 件`);
  lines.push('');
  lines.push('相関係数（ピアソン、-1〜1。2点未満や分散0のときは — ）:');
  lines.push(`- 気圧 × 体調: ${r2(s.correlation.pressure_condition.r)} (${s.correlation.pressure_condition.n} 点)`);
  lines.push(`- 睡眠時間 × 体調: ${r2(s.correlation.sleep_condition.r)} (${s.correlation.sleep_condition.n} 点)`);
  lines.push('');
  return lines.join('\n');
}

// ---------- 日別テキスト ----------

export function collectDates(d: Dataset): string[] {
  return [...new Set([
    ...d.meals.map((r) => r.date),
    ...d.conditions.map((r) => r.date),
    ...d.weathers.map((r) => r.date),
    ...d.expenses.map((r) => r.date),
    ...d.diaries.map((r) => r.date),
  ])].sort();
}

export interface DayIndex {
  cond: Map<string, ConditionRow>;
  wth: Map<string, WeatherRow>;
  meals: Map<string, MealRow[]>;
  exps: Map<string, ExpenseRow[]>;
  diary: Map<string, DiaryRow>;
}

export function indexByDate(d: Dataset): DayIndex {
  const meals = new Map<string, MealRow[]>();
  for (const m of d.meals) { const a = meals.get(m.date) ?? []; a.push(m); meals.set(m.date, a); }
  const exps = new Map<string, ExpenseRow[]>();
  for (const e of d.expenses) { const a = exps.get(e.date) ?? []; a.push(e); exps.set(e.date, a); }
  return {
    cond: new Map(d.conditions.map((c) => [c.date, c])),
    wth: new Map(d.weathers.map((w) => [w.date, w])),
    meals, exps,
    diary: new Map(d.diaries.map((e) => [e.date, e])),
  };
}

/** 1日1行に圧縮した表（長期間を扱うとき用） */
export function formatCompactDaily(idx: DayIndex, dates: string[]): string {
  const lines: string[] = [
    '## 日別サマリー', '',
    '| 日付 | 体調 | 気分 | 睡眠h | 頭痛 | 天気 | 気圧 | kcal | 支出 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const date of dates) {
    const c = idx.cond.get(date);
    const w = idx.wth.get(date);
    const kcal = (idx.meals.get(date) ?? []).reduce((s, m) => s + (m.calories ?? 0), 0);
    const exp = (idx.exps.get(date) ?? []).reduce((s, e) => s + e.amount, 0);
    lines.push(
      `| ${date} | ${c?.condition_score ?? ''} | ${c?.mood_score ?? ''} | ${c?.sleep_hours ?? ''} | ` +
      `${c?.headache ? '有' : ''} | ${w?.weather ? (WEATHER_LABELS[w.weather] ?? w.weather) : ''} | ` +
      `${w?.pressure_hpa ?? ''} | ${Math.round(kcal) || ''} | ${Math.round(exp) || ''} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** 日ごとの詳細（食事の品目・支出の明細まで） */
export function formatFullDaily(idx: DayIndex, dates: string[], heading = '## 日別の記録'): string {
  const lines: string[] = [heading, ''];
  for (const date of dates) {
    lines.push(`### ${date}`);

    const c = idx.cond.get(date);
    if (c) {
      const parts: string[] = [];
      if (c.condition_score != null) parts.push(`体調 ${c.condition_score}/5`);
      if (c.mood_score != null) parts.push(`気分 ${c.mood_score}/5`);
      if (c.sleep_hours != null) parts.push(`睡眠 ${c.sleep_hours}h`);
      if (c.headache) parts.push('頭痛あり');
      if (c.medication) parts.push('服薬あり');
      if (parts.length > 0) lines.push(`体調: ${parts.join(' / ')}`);
      if (c.memo) lines.push(`体調メモ: ${c.memo.replace(/\n/g, ' ')}`);
    }

    const w = idx.wth.get(date);
    if (w) {
      const parts: string[] = [];
      if (w.weather) parts.push(WEATHER_LABELS[w.weather] ?? w.weather);
      if (w.pressure_hpa != null) parts.push(`${w.pressure_hpa}hPa`);
      if (w.temperature != null) parts.push(`${w.temperature}℃`);
      if (w.humidity != null) parts.push(`湿度${w.humidity}%`);
      if (parts.length > 0) lines.push(`天気・気圧: ${parts.join(' / ')}`);
    }

    const meals = idx.meals.get(date);
    if (meals && meals.length > 0) {
      const kcal = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
      lines.push(`食事: 合計 ${Math.round(kcal)} kcal`);
      for (const m of meals) {
        lines.push(
          `- ${MEAL_LABELS[m.meal_type] ?? m.meal_type} ${m.food_name}` +
          `${m.amount ? ` ${m.amount}` : ''}${m.calories != null ? ` ${m.calories}kcal` : ''}` +
          `${m.memo ? ` (${m.memo.replace(/\n/g, ' ')})` : ''}`,
        );
      }
    }

    const exps = idx.exps.get(date);
    if (exps && exps.length > 0) {
      const sum = exps.reduce((s, e) => s + e.amount, 0);
      lines.push(`支出: 合計 ${yen(sum)}`);
      for (const e of exps) {
        lines.push(`- ${e.category} ${yen(e.amount)}${e.memo ? ` ${e.memo.replace(/\n/g, ' ')}` : ''}`);
      }
    }

    const d = idx.diary.get(date);
    if (d && (d.body.trim() || d.title)) {
      lines.push(`日記${d.title ? `: ${d.title}` : ''}`);
      if (d.tags && d.tags.length > 0) lines.push(`タグ: ${d.tags.join(', ')}`);
      for (const line of d.body.split('\n')) lines.push(`> ${line}`);
    }

    lines.push('');
  }
  return lines.join('\n');
}

/** 日記だけを全文で出す（意味検索の対象になるのはここ） */
export function formatDiaries(diaries: DiaryRow[], heading = '## 日記（全文）'): string {
  if (diaries.length === 0) return '';
  const lines: string[] = [heading, ''];
  for (const e of [...diaries].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(`### ${e.date}${e.title ? ` ${e.title}` : ''}`);
    if (e.tags && e.tags.length > 0) lines.push(`タグ: ${e.tags.join(', ')}`);
    lines.push(e.body);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 「似た日」検索のために、1日ぶんの記録を1本のテキストにまとめる。
 * 日記の全文ではなく特徴量を並べるのは、日と日を比較したいため
 * （日記本文の検索は kind='diary' 側のチャンクが担当する）。
 */
export function buildDaySummaryText(date: string, idx: DayIndex): string {
  const parts: string[] = [date];

  const c = idx.cond.get(date);
  if (c) {
    if (c.condition_score != null) parts.push(`体調${c.condition_score}`);
    if (c.mood_score != null) parts.push(`気分${c.mood_score}`);
    if (c.sleep_hours != null) parts.push(`睡眠${c.sleep_hours}時間`);
    if (c.headache) parts.push('頭痛あり');
    if (c.medication) parts.push('服薬あり');
    if (c.memo) parts.push(c.memo.replace(/\n/g, ' '));
  }

  const w = idx.wth.get(date);
  if (w) {
    if (w.weather) parts.push(WEATHER_LABELS[w.weather] ?? w.weather);
    if (w.pressure_hpa != null) parts.push(`気圧${w.pressure_hpa}hPa`);
    if (w.temperature != null) parts.push(`気温${w.temperature}度`);
  }

  const meals = idx.meals.get(date) ?? [];
  if (meals.length > 0) {
    const kcal = Math.round(meals.reduce((s, m) => s + (m.calories ?? 0), 0));
    parts.push(`摂取${kcal}kcal`);
    parts.push(`食事: ${meals.map((m) => m.food_name).slice(0, 12).join('、')}`);
  }

  const exps = idx.exps.get(date) ?? [];
  if (exps.length > 0) {
    const sum = Math.round(exps.reduce((s, e) => s + e.amount, 0));
    parts.push(`支出${sum}円`);
    parts.push(`内訳: ${[...new Set(exps.map((e) => e.category))].join('、')}`);
  }

  const d = idx.diary.get(date);
  if (d) {
    if (d.title) parts.push(`日記: ${d.title}`);
    if (d.tags && d.tags.length > 0) parts.push(d.tags.join('、'));
    if (d.body) parts.push(d.body.replace(/\n/g, ' ').slice(0, 200));
  }

  return parts.join(' / ');
}
