-- =====================================================================
-- 既存DB向けマイグレーション: データ整合性の CHECK 制約を追加
-- Supabase ダッシュボード > SQL Editor で実行してください（冪等・再実行可）。
-- 新規セットアップは schema.sql に同等の制約が含まれます。
-- drop if exists → add の順で何度でも安全に流せます。
-- =====================================================================

-- 栄養素は負値を許可しない（NULL=未入力は許可）
alter table public.meal_entries drop constraint if exists meal_entries_nutrition_nonneg;
alter table public.meal_entries add constraint meal_entries_nutrition_nonneg check (
  (calories is null or calories >= 0)
  and (protein is null or protein >= 0)
  and (fat is null or fat >= 0)
  and (carbohydrate is null or carbohydrate >= 0)
);

alter table public.food_templates drop constraint if exists food_templates_nutrition_nonneg;
alter table public.food_templates add constraint food_templates_nutrition_nonneg check (
  (calories is null or calories >= 0)
  and (protein is null or protein >= 0)
  and (fat is null or fat >= 0)
  and (carbohydrate is null or carbohydrate >= 0)
);

-- 体調・気分は 1..5、睡眠は 0..24h
alter table public.daily_records drop constraint if exists daily_records_score_range;
alter table public.daily_records add constraint daily_records_score_range check (
  (condition_score is null or condition_score between 1 and 5)
  and (mood_score is null or mood_score between 1 and 5)
  and (sleep_hours is null or (sleep_hours >= 0 and sleep_hours <= 24))
);

-- 気圧は正、湿度は 0..100%
alter table public.weather_records drop constraint if exists weather_records_range;
alter table public.weather_records add constraint weather_records_range check (
  (pressure_hpa is null or pressure_hpa > 0)
  and (humidity is null or (humidity >= 0 and humidity <= 100))
);

-- 支出は負値を許可しない
alter table public.expenses drop constraint if exists expenses_amount_nonneg;
alter table public.expenses add constraint expenses_amount_nonneg check (amount >= 0);
