import type { Nutrition } from './types';

export const EMPTY_NUTRITION: Nutrition = { calories: 0, protein: 0, fat: 0, carbohydrate: 0 };

/** 各栄養素が null/undefined を取りうる入力（DB 行やフォーム） */
type PartialNutrition = {
  calories?: number | null;
  protein?: number | null;
  fat?: number | null;
  carbohydrate?: number | null;
};

/** null/未入力を 0 として合算する */
export function sumNutrition(
  items: Array<PartialNutrition | null | undefined>,
): Nutrition {
  return items.reduce<Nutrition>((acc, it) => {
    if (!it) return acc;
    return {
      calories: acc.calories + (it.calories ?? 0),
      protein: acc.protein + (it.protein ?? 0),
      fat: acc.fat + (it.fat ?? 0),
      carbohydrate: acc.carbohydrate + (it.carbohydrate ?? 0),
    };
  }, { ...EMPTY_NUTRITION });
}

/** PFC をカロリー換算（たんぱく4 / 脂質9 / 炭水化物4 kcal/g） */
export function pfcKcal(n: Nutrition): { protein: number; fat: number; carbohydrate: number } {
  return {
    protein: n.protein * 4,
    fat: n.fat * 9,
    carbohydrate: n.carbohydrate * 4,
  };
}

/** 数値を見やすく丸める（小数1桁まで、整数なら整数表示） */
export function fmt(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** フォームの文字列を number|null に変換（空文字や不正値は null） */
export function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}
