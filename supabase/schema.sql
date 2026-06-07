-- =====================================================================
-- Lifelog 食事管理 MVP — Supabase スキーマ
-- Supabase ダッシュボード > SQL Editor に貼り付けて実行してください。
-- データはすべて user_id に紐づき、RLS により本人のみ閲覧・編集可能。
-- 将来の体調 / 天気気圧 / 家計簿テーブル追加に備え、すべて date 単位で設計。
-- =====================================================================

-- ---------- 食事記録（1行 = 1食品） ----------
create table if not exists public.meal_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  date         date not null,
  meal_type    text not null check (meal_type in ('breakfast','lunch','dinner','snack')),
  food_name    text not null,
  amount       text,                          -- 量（"1膳" "150g" など自由入力）
  calories     numeric,
  protein      numeric,                       -- たんぱく質(g)
  fat          numeric,                       -- 脂質(g)
  carbohydrate numeric,                       -- 炭水化物(g)
  memo         text,
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists meal_entries_user_date_idx on public.meal_entries (user_id, date);

-- ---------- 食品テンプレート（よく食べる単品） ----------
create table if not exists public.food_templates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  amount       text,
  calories     numeric,
  protein      numeric,
  fat          numeric,
  carbohydrate numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists food_templates_user_idx on public.food_templates (user_id);

-- ---------- 食事テンプレート（朝食セット等。複数食品をまとめて保存） ----------
create table if not exists public.meal_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  meal_type   text check (meal_type in ('breakfast','lunch','dinner','snack')),
  auto_apply  boolean not null default false, -- 毎日「今日の記録」へ自動セット
  items       jsonb not null default '[]',    -- [{food_name, amount, calories, protein, fat, carbohydrate}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists meal_templates_user_idx on public.meal_templates (user_id);

-- ---------- updated_at 自動更新トリガ ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_meal_entries_updated on public.meal_entries;
create trigger trg_meal_entries_updated before update on public.meal_entries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_food_templates_updated on public.food_templates;
create trigger trg_food_templates_updated before update on public.food_templates
  for each row execute function public.set_updated_at();

drop trigger if exists trg_meal_templates_updated on public.meal_templates;
create trigger trg_meal_templates_updated before update on public.meal_templates
  for each row execute function public.set_updated_at();

-- ---------- Row Level Security（ユーザーごとのデータ分離） ----------
alter table public.meal_entries   enable row level security;
alter table public.food_templates enable row level security;
alter table public.meal_templates enable row level security;

drop policy if exists "own meal_entries" on public.meal_entries;
create policy "own meal_entries" on public.meal_entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own food_templates" on public.food_templates;
create policy "own food_templates" on public.food_templates
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own meal_templates" on public.meal_templates;
create policy "own meal_templates" on public.meal_templates
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
