import { describe, it, expect } from 'vitest';
import { toCSV, toMarkdown } from './export';
import type { MealEntry, MealType } from './types';

function entry(p: Partial<MealEntry>): MealEntry {
  return {
    id: p.id ?? 'id',
    user_id: 'u',
    date: p.date ?? '2026-06-08',
    meal_type: (p.meal_type ?? 'breakfast') as MealType,
    food_name: p.food_name ?? '納豆',
    amount: p.amount ?? null,
    calories: p.calories ?? null,
    protein: p.protein ?? null,
    fat: p.fat ?? null,
    carbohydrate: p.carbohydrate ?? null,
    memo: p.memo ?? null,
    tags: p.tags ?? [],
    created_at: '',
    updated_at: '',
  };
}

describe('toCSV', () => {
  it('ヘッダー行を含む', () => {
    expect(toCSV([]).split('\r\n')[0]).toBe(
      'date,meal_type,food_name,amount,calories,protein,fat,carbohydrate,memo,tags',
    );
  });

  it('値を出力し、null は空、tags は | 連結', () => {
    const csv = toCSV([entry({ food_name: '卵', calories: 78, protein: 6.7, tags: ['自炊', '高たんぱく'] })]);
    const line = csv.split('\r\n')[1];
    expect(line).toBe('2026-06-08,breakfast,卵,,78,6.7,,,,自炊|高たんぱく');
  });

  it('カンマ・引用符・改行を含む値はエスケープする', () => {
    const csv = toCSV([entry({ food_name: 'りんご, 半分', memo: '美味しい"よ"\n満足' })]);
    const line = csv.split('\r\n')[1];
    expect(line).toContain('"りんご, 半分"');
    expect(line).toContain('"美味しい""よ""\n満足"');
  });
});

describe('toMarkdown', () => {
  it('記録なしは見出しと（記録なし）', () => {
    const md = toMarkdown([]);
    expect(md).toContain('# 食事記録');
    expect(md).toContain('（記録なし）');
  });

  it('日付見出し・合計・表行を出力する', () => {
    const md = toMarkdown([
      entry({ meal_type: 'breakfast', food_name: '納豆', calories: 95, protein: 7, fat: 5, carbohydrate: 12 }),
      entry({ meal_type: 'lunch', food_name: 'ご飯', calories: 281, protein: 4, fat: 0, carbohydrate: 60 }),
    ]);
    expect(md).toContain('## 6/8(月) (2026-06-08)');
    expect(md).toContain('合計: 376 kcal / P 11 / F 5 / C 72 g');
    expect(md).toContain('| 朝食 | 納豆 |');
    expect(md).toContain('| 昼食 | ご飯 |');
  });

  it('複数日は日付昇順で並ぶ', () => {
    const md = toMarkdown([
      entry({ date: '2026-06-09', food_name: 'B' }),
      entry({ date: '2026-06-07', food_name: 'A' }),
    ]);
    expect(md.indexOf('2026-06-07')).toBeLessThan(md.indexOf('2026-06-09'));
  });
});
