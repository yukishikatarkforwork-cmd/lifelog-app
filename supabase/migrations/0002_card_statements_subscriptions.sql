-- =====================================================================
-- Phase 18: カード明細の取り込みとサブスク管理
--  - expenses に店名・取込元・取込キー・カード名・サブスク紐付けを追加
--  - subscriptions（サブスク台帳）/ merchant_rules（店名→カテゴリの学習）
--  - lifelog_stats() に店名別トップとサブスクの月額合計を追加
-- 冪等。何度流しても安全。
-- =====================================================================

-- ---------- サブスク台帳 ----------
create table if not exists public.subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  -- 明細の店名にこの文字列が含まれていればこのサブスクの請求とみなす（正規化後の部分一致）
  merchant_pattern text not null,
  amount           numeric,
  cycle            text not null default 'monthly',
  status           text not null default 'active',
  category         text,
  started_on       date,
  cancelled_on     date,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint subscriptions_cycle_check  check (cycle in ('monthly', 'yearly', 'other')),
  constraint subscriptions_status_check check (status in ('active', 'review', 'cancelled', 'ignored')),
  constraint subscriptions_amount_nonneg check (amount is null or amount >= 0)
);
create index if not exists subscriptions_user_idx on public.subscriptions (user_id);

drop trigger if exists trg_subscriptions_updated on public.subscriptions;
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.subscriptions;
create policy "own subscriptions" on public.subscriptions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.subscriptions to authenticated;

-- ---------- 店名 → カテゴリ の学習ルール ----------
create table if not exists public.merchant_rules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  pattern    text not null,
  category   text not null,
  created_at timestamptz not null default now()
);
create index if not exists merchant_rules_user_idx on public.merchant_rules (user_id);

alter table public.merchant_rules enable row level security;
drop policy if exists "own merchant_rules" on public.merchant_rules;
create policy "own merchant_rules" on public.merchant_rules
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.merchant_rules to authenticated;

-- ---------- expenses の拡張 ----------
alter table public.expenses add column if not exists merchant        text;
alter table public.expenses add column if not exists source          text not null default 'manual';
alter table public.expenses add column if not exists card_name       text;
alter table public.expenses add column if not exists import_key      text;
alter table public.expenses add column if not exists subscription_id uuid references public.subscriptions (id) on delete set null;

alter table public.expenses drop constraint if exists expenses_source_check;
alter table public.expenses add constraint expenses_source_check check (source in ('manual', 'receipt', 'card'));

-- 同じ明細行を二度取り込まない（取込キーは カード名+日付+店名+金額+同日内の連番）
create unique index if not exists expenses_import_key_uidx
  on public.expenses (user_id, import_key);
create index if not exists expenses_subscription_idx on public.expenses (subscription_id) where subscription_id is not null;

-- ---------- 集計関数に店名別・サブスクを追加 ----------
create or replace function public.lifelog_stats(p_start date, p_end date)
returns json
language sql
stable
as $$
  with
  cond as (
    select * from public.daily_records
    where user_id = auth.uid() and date between p_start and p_end
  ),
  wth as (
    select * from public.weather_records
    where user_id = auth.uid() and date between p_start and p_end
  ),
  meal_day as (
    select date,
           sum(coalesce(calories, 0))     as kcal,
           sum(coalesce(protein, 0))      as p,
           sum(coalesce(fat, 0))          as f,
           sum(coalesce(carbohydrate, 0)) as c
    from public.meal_entries
    where user_id = auth.uid() and date between p_start and p_end
    group by date
  ),
  meal_count as (
    select count(*) as n from public.meal_entries
    where user_id = auth.uid() and date between p_start and p_end
  ),
  exp as (
    select * from public.expenses
    where user_id = auth.uid() and date between p_start and p_end
  ),
  exp_cat as (
    select category, sum(amount) as total, count(*) as n
    from exp group by category order by sum(amount) desc
  ),
  -- 店名別（店名が無い手入力はメモで代用）。上位10件
  exp_merchant as (
    select coalesce(nullif(merchant, ''), nullif(memo, ''), '(店名なし)') as merchant,
           sum(amount) as total, count(*) as n
    from exp group by 1 order by sum(amount) desc limit 10
  ),
  subs as (
    select name, amount, cycle, status
    from public.subscriptions
    where user_id = auth.uid() and status in ('active', 'review')
  ),
  diary as (
    select count(*) as n from public.diary_entries
    where user_id = auth.uid() and date between p_start and p_end
  ),
  body as (
    select * from public.body_records
    where user_id = auth.uid() and date between p_start and p_end and weight_kg is not null
  ),
  corr_pressure as (
    select corr(c.condition_score, w.pressure_hpa) as r, count(*) as n
    from cond c join wth w on w.date = c.date
    where c.condition_score is not null and w.pressure_hpa is not null
  ),
  corr_sleep as (
    select corr(condition_score, sleep_hours) as r, count(*) as n
    from cond where condition_score is not null and sleep_hours is not null
  )
  select json_build_object(
    'period', json_build_object('start', p_start, 'end', p_end),
    'condition', (select json_build_object(
        'days',           count(*) filter (where condition_score is not null),
        'avg_condition',  avg(condition_score),
        'avg_mood',       avg(mood_score),
        'avg_sleep',      avg(sleep_hours),
        'headache_days',  count(*) filter (where headache),
        'medication_days',count(*) filter (where medication)
      ) from cond),
    'meals', (select json_build_object(
        'days',      (select count(*) from meal_day),
        'items',     (select n from meal_count),
        'avg_kcal',  avg(kcal), 'avg_p', avg(p), 'avg_f', avg(f), 'avg_c', avg(c)
      ) from meal_day),
    'expenses', json_build_object(
        'total',      (select coalesce(sum(amount), 0) from exp),
        'count',      (select count(*) from exp),
        'days',       (select count(distinct date) from exp),
        'card_total', (select coalesce(sum(amount), 0) from exp where source = 'card'),
        'by_category',(select coalesce(json_agg(json_build_object(
                          'category', category, 'total', total, 'count', n)), '[]'::json) from exp_cat),
        'by_merchant',(select coalesce(json_agg(json_build_object(
                          'merchant', merchant, 'total', total, 'count', n)), '[]'::json) from exp_merchant)
      ),
    'subscriptions', json_build_object(
        'count',         (select count(*) from subs),
        'monthly_total', (select coalesce(sum(case cycle when 'monthly' then amount when 'yearly' then amount / 12 else 0 end), 0) from subs),
        'items',         (select coalesce(json_agg(json_build_object(
                            'name', name, 'amount', amount, 'cycle', cycle, 'status', status)), '[]'::json) from subs)
      ),
    'diary_count', (select n from diary),
    'body', json_build_object(
        'days',         (select count(*) from body),
        'avg_weight',   (select avg(weight_kg) from body),
        'first_weight', (select weight_kg from body order by date asc  limit 1),
        'last_weight',  (select weight_kg from body order by date desc limit 1),
        'avg_body_fat', (select avg(body_fat_pct) from body)
      ),
    'correlation', json_build_object(
        'pressure_condition', json_build_object('r', (select r from corr_pressure), 'n', (select n from corr_pressure)),
        'sleep_condition',    json_build_object('r', (select r from corr_sleep),    'n', (select n from corr_sleep))
      )
  );
$$;

grant execute on function public.lifelog_stats(date, date) to authenticated;
