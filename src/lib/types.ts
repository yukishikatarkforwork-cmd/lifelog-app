export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
};

/** 栄養素の数値だけを持つ共通型 */
export interface Nutrition {
  calories: number;
  protein: number;
  fat: number;
  carbohydrate: number;
}

export interface MealEntry {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  meal_type: MealType;
  food_name: string;
  amount: string | null;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbohydrate: number | null;
  memo: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** 食事記録の新規作成 / 更新で使う入力フォーム値 */
export interface MealEntryInput {
  meal_type: MealType;
  food_name: string;
  amount: string;
  calories: string;
  protein: string;
  fat: string;
  carbohydrate: string;
  memo: string;
  tags: string[];
}

export interface FoodTemplate {
  id: string;
  user_id: string;
  name: string;
  amount: string | null;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbohydrate: number | null;
  created_at: string;
  updated_at: string;
}

export interface MealTemplateItem {
  food_name: string;
  amount: string | null;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbohydrate: number | null;
}

export interface MealTemplate {
  id: string;
  user_id: string;
  name: string;
  meal_type: MealType | null;
  auto_apply: boolean;
  items: MealTemplateItem[];
  created_at: string;
  updated_at: string;
}
