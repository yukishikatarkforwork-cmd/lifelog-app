import type { MealEntry, MealType } from './types';
import { MEAL_LABELS } from './types';
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
