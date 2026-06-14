import type { DailyRecord, Expense, MealEntry, MealType, WeatherRecord } from './types';
import { MEAL_LABELS, WEATHER_LABELS } from './types';
import { fmt, sumNutrition } from './nutrition';
import { formatShort } from './date';

const CSV_HEADER = [
  'date', 'meal_type', 'food_name', 'amount',
  'calories', 'protein', 'fat', 'carbohydrate', 'memo', 'tags',
];

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  // カンマ・ダブルクォート・改行を含む場合は "" で囲み、内部の " を "" にエスケープ
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 食事記録を CSV 文字列にする（表計算ソフト向け） */
export function toCSV(entries: MealEntry[]): string {
  const rows = entries.map((e) => [
    e.date, e.meal_type, e.food_name, e.amount ?? '',
    e.calories ?? '', e.protein ?? '', e.fat ?? '', e.carbohydrate ?? '',
    e.memo ?? '', (e.tags ?? []).join('|'),
  ]);
  return [CSV_HEADER, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');
}

/** 食事記録を日付ごとにまとめる（日付昇順、区分は朝→昼→夕→間食順） */
function groupByDate(entries: MealEntry[]): Array<{ date: string; items: MealEntry[] }> {
  const map = new Map<string, MealEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.date) ?? [];
    arr.push(e);
    map.set(e.date, arr);
  }
  const order: Record<MealType, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  return [...map.keys()].sort().map((date) => ({
    date,
    items: map.get(date)!.slice().sort((a, b) => order[a.meal_type] - order[b.meal_type]),
  }));
}

/** AI に渡しやすい Markdown 形式にする（日別の表＋合計） */
export function toMarkdown(entries: MealEntry[], title = '食事記録'): string {
  const groups = groupByDate(entries);
  const lines: string[] = [`# ${title}`, ''];

  if (groups.length === 0) {
    lines.push('（記録なし）');
    return lines.join('\n');
  }

  for (const g of groups) {
    const total = sumNutrition(g.items);
    lines.push(`## ${formatShort(g.date)} (${g.date})`);
    lines.push(
      `合計: ${fmt(total.calories)} kcal / P ${fmt(total.protein)} / F ${fmt(total.fat)} / C ${fmt(total.carbohydrate)} g`,
    );
    lines.push('');
    lines.push('| 区分 | 食品 | 量 | kcal | P | F | C | メモ |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const e of g.items) {
      lines.push(
        `| ${MEAL_LABELS[e.meal_type]} | ${e.food_name} | ${e.amount ?? ''} | ${e.calories ?? ''} | ${e.protein ?? ''} | ${e.fat ?? ''} | ${e.carbohydrate ?? ''} | ${(e.memo ?? '').replace(/\n/g, ' ')} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 家計簿の CSV */
const EXPENSE_HEADER = ['date', 'amount', 'category', 'payment_method', 'memo'];
export function toExpensesCSV(expenses: Expense[]): string {
  const rows = expenses.map((e) => [e.date, e.amount, e.category, e.payment_method ?? '', e.memo ?? '']);
  return [EXPENSE_HEADER, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export interface DailyExportData {
  meals: MealEntry[];
  conditions: DailyRecord[];
  weathers: WeatherRecord[];
  expenses: Expense[];
}

/** 全ドメインを日別にまとめた統合 Markdown（AI 分析向け） */
export function toDailyMarkdown(data: DailyExportData, title = '生活記録'): string {
  const mealsBy = new Map<string, MealEntry[]>();
  for (const m of data.meals) { const a = mealsBy.get(m.date) ?? []; a.push(m); mealsBy.set(m.date, a); }
  const condBy = new Map(data.conditions.map((r) => [r.date, r]));
  const wthBy = new Map(data.weathers.map((r) => [r.date, r]));
  const expBy = new Map<string, Expense[]>();
  for (const e of data.expenses) { const a = expBy.get(e.date) ?? []; a.push(e); expBy.set(e.date, a); }

  const dates = new Set<string>([...mealsBy.keys(), ...condBy.keys(), ...wthBy.keys(), ...expBy.keys()]);
  const sorted = [...dates].sort();

  const lines: string[] = [`# ${title}`, ''];
  if (sorted.length === 0) { lines.push('（記録なし）'); return lines.join('\n'); }

  for (const date of sorted) {
    lines.push(`## ${formatShort(date)} (${date})`, '');

    const c = condBy.get(date);
    if (c && (c.condition_score != null || c.mood_score != null || c.sleep_hours != null || c.headache || c.medication || c.memo)) {
      const parts: string[] = [];
      if (c.condition_score != null) parts.push(`体調 ${c.condition_score}/5`);
      if (c.mood_score != null) parts.push(`気分 ${c.mood_score}/5`);
      if (c.sleep_hours != null) parts.push(`睡眠 ${fmt(c.sleep_hours)}h`);
      if (c.headache) parts.push('頭痛あり');
      if (c.medication) parts.push('服薬あり');
      lines.push(`**体調**: ${parts.join(' / ') || '—'}`);
      if (c.memo) lines.push(`メモ: ${c.memo.replace(/\n/g, ' ')}`);
      lines.push('');
    }

    const w = wthBy.get(date);
    if (w && (w.weather || w.pressure_hpa != null || w.temperature != null || w.humidity != null)) {
      const parts: string[] = [];
      if (w.weather) parts.push(WEATHER_LABELS[w.weather] ?? w.weather);
      if (w.pressure_hpa != null) parts.push(`${fmt(w.pressure_hpa)}hPa`);
      if (w.temperature != null) parts.push(`${fmt(w.temperature)}℃`);
      if (w.humidity != null) parts.push(`湿度${fmt(w.humidity)}%`);
      lines.push(`**天気・気圧**: ${parts.join(' / ')}`, '');
    }

    const meals = mealsBy.get(date);
    if (meals && meals.length > 0) {
      const order: Record<MealType, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
      const sortedMeals = meals.slice().sort((a, b) => order[a.meal_type] - order[b.meal_type]);
      const total = sumNutrition(sortedMeals);
      lines.push(`**食事**: 合計 ${fmt(total.calories)} kcal / P ${fmt(total.protein)} / F ${fmt(total.fat)} / C ${fmt(total.carbohydrate)} g`);
      lines.push('| 区分 | 食品 | 量 | kcal | P | F | C |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const e of sortedMeals) {
        lines.push(`| ${MEAL_LABELS[e.meal_type]} | ${e.food_name} | ${e.amount ?? ''} | ${e.calories ?? ''} | ${e.protein ?? ''} | ${e.fat ?? ''} | ${e.carbohydrate ?? ''} |`);
      }
      lines.push('');
    }

    const exps = expBy.get(date);
    if (exps && exps.length > 0) {
      const sum = exps.reduce((s, e) => s + (e.amount ?? 0), 0);
      lines.push(`**家計簿**: 合計 ¥${sum.toLocaleString()}`);
      for (const e of exps) {
        lines.push(`- ${e.category} ¥${e.amount.toLocaleString()}${e.payment_method ? `（${e.payment_method}）` : ''}${e.memo ? ` ${e.memo.replace(/\n/g, ' ')}` : ''}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
