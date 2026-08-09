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

-- ---------- テーブル権限（RLS とは別に role への GRANT が必要） ----------
-- ログインユーザー(authenticated)のみ操作可。anon には付与しない（未ログインは一切アクセス不可）。
grant select, insert, update, delete on public.meal_entries   to authenticated;
grant select, insert, update, delete on public.food_templates to authenticated;
grant select, insert, update, delete on public.meal_templates to authenticated;

-- =====================================================================
-- Phase 2: 栄養目標設定（ユーザーごとに1行）
-- =====================================================================
create table if not exists public.user_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  target_calories    numeric,
  target_protein     numeric,
  target_fat         numeric,
  target_carbohydrate numeric,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

drop trigger if exists trg_user_settings_updated on public.user_settings;
create trigger trg_user_settings_updated before update on public.user_settings
  for each row execute function public.set_updated_at();

alter table public.user_settings enable row level security;

drop policy if exists "own user_settings" on public.user_settings;
create policy "own user_settings" on public.user_settings
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_settings to authenticated;

-- =====================================================================
-- Phase 3: 体調の日次記録（user × date で1行。upsert）
-- =====================================================================
create table if not exists public.daily_records (
  user_id         uuid not null references auth.users (id) on delete cascade,
  date            date not null,
  condition_score smallint,  -- 体調 1..5
  mood_score      smallint,  -- 気分 1..5
  sleep_hours     numeric,
  headache        boolean not null default false,
  medication      boolean not null default false,
  memo            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, date)
);

-- =====================================================================
-- Phase 4: 天気・気圧の日次記録（user × date で1行。upsert）
-- =====================================================================
create table if not exists public.weather_records (
  user_id      uuid not null references auth.users (id) on delete cascade,
  date         date not null,
  weather      text,          -- sunny / cloudy / rainy / snowy / other
  pressure_hpa numeric,
  temperature  numeric,
  humidity     numeric,
  memo         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, date)
);

-- =====================================================================
-- Phase 5: 家計簿（1日に複数）と支出カテゴリ（ユーザー追加分）
-- =====================================================================
create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  date           date not null,
  amount         numeric not null,
  category       text not null,
  payment_method text,
  memo           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists expenses_user_date_idx on public.expenses (user_id, date);

create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists expense_categories_user_idx on public.expense_categories (user_id);

-- ---------- updated_at トリガ ----------
drop trigger if exists trg_daily_records_updated on public.daily_records;
create trigger trg_daily_records_updated before update on public.daily_records
  for each row execute function public.set_updated_at();

drop trigger if exists trg_weather_records_updated on public.weather_records;
create trigger trg_weather_records_updated before update on public.weather_records
  for each row execute function public.set_updated_at();

drop trigger if exists trg_expenses_updated on public.expenses;
create trigger trg_expenses_updated before update on public.expenses
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.daily_records      enable row level security;
alter table public.weather_records    enable row level security;
alter table public.expenses           enable row level security;
alter table public.expense_categories enable row level security;

drop policy if exists "own daily_records" on public.daily_records;
create policy "own daily_records" on public.daily_records
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own weather_records" on public.weather_records;
create policy "own weather_records" on public.weather_records
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own expense_categories" on public.expense_categories;
create policy "own expense_categories" on public.expense_categories
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- GRANT ----------
grant select, insert, update, delete on public.daily_records      to authenticated;
grant select, insert, update, delete on public.weather_records    to authenticated;
grant select, insert, update, delete on public.expenses           to authenticated;
grant select, insert, update, delete on public.expense_categories to authenticated;

-- =====================================================================
-- Phase 7: 日記（user × date で1行。upsert）
-- 体調メモ（daily_records.memo）とは別テーブルにする。
-- 「日記だけ共有する／体調・家計簿は共有しない」を将来 RLS で表現できるようにするため、
-- 共有の粒度になりうる単位でテーブルを分けておく。
-- =====================================================================
create table if not exists public.diary_entries (
  user_id    uuid not null references auth.users (id) on delete cascade,
  date       date not null,
  title      text,
  body       text not null default '',
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

drop trigger if exists trg_diary_entries_updated on public.diary_entries;
create trigger trg_diary_entries_updated before update on public.diary_entries
  for each row execute function public.set_updated_at();

alter table public.diary_entries enable row level security;

drop policy if exists "own diary_entries" on public.diary_entries;
create policy "own diary_entries" on public.diary_entries
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.diary_entries to authenticated;

-- =====================================================================
-- Phase 10: 「AI に聞く」の利用回数制限
-- Edge Function から呼ぶ。API コストが青天井にならないよう1日あたりの上限を設ける。
-- =====================================================================
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  date    date not null,
  count   integer not null default 0,
  primary key (user_id, date)
);

alter table public.ai_usage enable row level security;

-- 残り回数の表示用に自分の分の参照だけ許可する。加算は下の関数経由のみ。
drop policy if exists "own ai_usage read" on public.ai_usage;
create policy "own ai_usage read" on public.ai_usage
  for select to authenticated using (auth.uid() = user_id);

grant select on public.ai_usage to authenticated;

-- 利用回数を1つ進めて、その日の累計を返す。
-- security definer だが user_id は auth.uid() から取るため、他人の枠は消費できない。
create or replace function public.consume_ai_quota()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.ai_usage as u (user_id, date, count)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, date) do update set count = u.count + 1
  returning u.count into v_count;

  return v_count;
end;
$$;

revoke execute on function public.consume_ai_quota() from public, anon;
grant execute on function public.consume_ai_quota() to authenticated;
