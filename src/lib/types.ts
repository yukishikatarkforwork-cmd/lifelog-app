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

/** 1日の栄養目標（未設定は null） */
export interface NutritionGoals {
  target_calories: number | null;
  target_protein: number | null;
  target_fat: number | null;
  target_carbohydrate: number | null;
}

export interface UserSettings extends NutritionGoals {
  user_id: string;
  created_at: string;
  updated_at: string;
}

export const EMPTY_GOALS: NutritionGoals = {
  target_calories: null,
  target_protein: null,
  target_fat: null,
  target_carbohydrate: null,
};

// ---------- Phase 3: 体調 ----------
export interface DailyRecord {
  user_id: string;
  date: string;
  condition_score: number | null; // 1..5
  mood_score: number | null;      // 1..5
  sleep_hours: number | null;
  headache: boolean;
  medication: boolean;
  memo: string | null;
  created_at?: string;
  updated_at?: string;
}

// ---------- Phase 4: 天気・気圧 ----------
export type WeatherKey = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'other';

export const WEATHER_OPTIONS: { key: WeatherKey; label: string; icon: string }[] = [
  { key: 'sunny', label: '晴れ', icon: '☀️' },
  { key: 'cloudy', label: '曇り', icon: '☁️' },
  { key: 'rainy', label: '雨', icon: '🌧️' },
  { key: 'snowy', label: '雪', icon: '❄️' },
  { key: 'other', label: 'その他', icon: '🌫️' },
];

export const WEATHER_LABELS: Record<string, string> = Object.fromEntries(
  WEATHER_OPTIONS.map((w) => [w.key, w.label]),
);

export interface WeatherRecord {
  user_id: string;
  date: string;
  weather: WeatherKey | null;
  pressure_hpa: number | null;
  temperature: number | null;
  humidity: number | null;
  memo: string | null;
  created_at?: string;
  updated_at?: string;
}

// ---------- Phase 5: 家計簿 ----------
export interface Expense {
  id: string;
  user_id: string;
  date: string;
  amount: number;
  category: string;
  payment_method: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategory {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  '食費', '日用品', '交通費', '医療費', '娯楽費', '固定費', 'その他',
];

export const PAYMENT_METHODS = ['現金', 'クレジット', '電子マネー', '口座引落', 'その他'];
