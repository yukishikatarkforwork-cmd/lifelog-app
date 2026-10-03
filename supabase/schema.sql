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
  updated_at   timestamptz not null default now(),
  constraint meal_entries_nutrition_nonneg check (
    (calories is null or calories >= 0) and (protein is null or protein >= 0)
    and (fat is null or fat >= 0) and (carbohydrate is null or carbohydrate >= 0)
  )
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
  updated_at   timestamptz not null default now(),
  constraint food_templates_nutrition_nonneg check (
    (calories is null or calories >= 0) and (protein is null or protein >= 0)
    and (fat is null or fat >= 0) and (carbohydrate is null or carbohydrate >= 0)
  )
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
  primary key (user_id, date),
  constraint daily_records_score_range check (
    (condition_score is null or condition_score between 1 and 5)
    and (mood_score is null or mood_score between 1 and 5)
    and (sleep_hours is null or (sleep_hours >= 0 and sleep_hours <= 24))
  )
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
  primary key (user_id, date),
  constraint weather_records_range check (
    (pressure_hpa is null or pressure_hpa > 0)
    and (humidity is null or (humidity >= 0 and humidity <= 100))
  )
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
  updated_at     timestamptz not null default now(),
  constraint expenses_amount_nonneg check (amount >= 0)
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

-- =====================================================================
-- Phase 11: ベクトル検索（RAG）の土台
--
-- 「江ノ島に行ったのはいつ？」のように、期間を指定せず意味で探すための仕組み。
-- 集計（平均・合計・相関）は下の lifelog_stats() が担当し、こちらはテキスト検索専用。
-- 役割を分けているのは、ベクトル検索が「平均」を計算できないため。
-- =====================================================================
create extension if not exists vector;

-- 埋め込みの保管庫。kind で2種類を同居させる。
--   diary : 日記本文のチャンク       → 「あのカフェの日はいつ？」に答える
--   day   : 1日ぶんの記録の要約1行   → 「今日と似た日は？」に答える
-- 埋め込む単位が違うので1本のベクトルでは兼用できない。
create table if not exists public.embeddings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('diary', 'day')),
  date         date not null,
  chunk_index  integer not null default 0,
  content      text not null,          -- 埋め込んだ元テキスト（回答の根拠として提示する）
  content_hash text not null,          -- 元テキストのハッシュ。再インデックス時の差分判定に使う
  embedding    vector(512),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, kind, date, chunk_index)
);

create index if not exists embeddings_user_kind_idx on public.embeddings (user_id, kind, date);
-- 近傍検索用。コサイン距離（<=>）で引く
create index if not exists embeddings_vec_idx
  on public.embeddings using hnsw (embedding vector_cosine_ops);

drop trigger if exists trg_embeddings_updated on public.embeddings;
create trigger trg_embeddings_updated before update on public.embeddings
  for each row execute function public.set_updated_at();

alter table public.embeddings enable row level security;

drop policy if exists "own embeddings" on public.embeddings;
create policy "own embeddings" on public.embeddings
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.embeddings to authenticated;

-- 近傍検索。supabase-js からは <=> 演算子を書けないので関数にする。
-- security invoker（既定）なので RLS がかかり、他人の埋め込みは引けない。
create or replace function public.match_embeddings(
  query_embedding vector(512),
  match_kind      text,
  match_count     integer default 20,
  exclude_date    date default null
)
returns table (date date, chunk_index integer, content text, similarity double precision)
language sql
stable
as $$
  select e.date, e.chunk_index, e.content,
         1 - (e.embedding <=> query_embedding) as similarity
  from public.embeddings e
  where e.user_id = auth.uid()
    and e.kind = match_kind
    and e.embedding is not null
    and (exclude_date is null or e.date <> exclude_date)
  order by e.embedding <=> query_embedding
  limit greatest(1, least(match_count, 100));
$$;

grant execute on function public.match_embeddings(vector, text, integer, date) to authenticated;

-- =====================================================================
-- 集計は SQL 側で確定させる。
-- PostgREST は1リクエスト1000行で打ち切られるため、行を取り寄せて数えると
-- 長期間で件数が欠けて平均が狂う。集計は必ずこの関数を通す。
-- =====================================================================
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
  diary as (
    select count(*) as n from public.diary_entries
    where user_id = auth.uid() and date between p_start and p_end
  ),
  -- corr(Y, X) がピアソン相関係数。2点未満や分散0なら null が返る
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
        'by_category',(select coalesce(json_agg(json_build_object(
                          'category', category, 'total', total, 'count', n)), '[]'::json) from exp_cat)
      ),
    'diary_count', (select n from diary),
    'correlation', json_build_object(
        'pressure_condition', json_build_object('r', (select r from corr_pressure), 'n', (select n from corr_pressure)),
        'sleep_condition',    json_build_object('r', (select r from corr_sleep),    'n', (select n from corr_sleep))
      )
  );
$$;

grant execute on function public.lifelog_stats(date, date) to authenticated;

-- 記録のある日付を新しい順に返す（埋め込みの対象日を列挙するため。1000行制限を避ける）
create or replace function public.lifelog_dates(p_limit integer default 2000)
returns table (date date)
language sql
stable
as $$
  select d from (
    select date as d from public.daily_records  where user_id = auth.uid()
    union select date from public.weather_records where user_id = auth.uid()
    union select date from public.meal_entries   where user_id = auth.uid()
    union select date from public.expenses       where user_id = auth.uid()
    union select date from public.diary_entries  where user_id = auth.uid()
  ) t
  order by d desc
  limit greatest(1, least(p_limit, 5000));
$$;

grant execute on function public.lifelog_dates(integer) to authenticated;

-- 「この日と似た日」を返す。
-- 基準日の要約ベクトルをDB内で引いてそのまま近傍検索するので、
-- 埋め込みAPIの呼び出しもベクトルの往復も不要（クライアントから直接呼べる）。
create or replace function public.similar_days(p_date date, match_count integer default 10)
returns table (date date, content text, similarity double precision)
language sql
stable
as $$
  with src as (
    select e.embedding
    from public.embeddings e
    where e.user_id = auth.uid() and e.kind = 'day' and e.date = p_date and e.embedding is not null
    limit 1
  )
  select e.date, e.content, 1 - (e.embedding <=> src.embedding) as similarity
  from public.embeddings e, src
  where e.user_id = auth.uid()
    and e.kind = 'day'
    and e.date <> p_date
    and e.embedding is not null
  order by e.embedding <=> src.embedding
  limit greatest(1, least(match_count, 50));
$$;

grant execute on function public.similar_days(date, integer) to authenticated;

-- =====================================================================
-- Phase 8: 写真
--
-- バケットは必ず private にする。public にすると URL を知っている全員が見られる。
-- 表示は署名付きURL（有効期限つき）を都度発行する。
-- 保存パスは {user_id}/{date}/{uuid}.webp。先頭を user_id にしているのは
-- Storage のポリシーがフォルダ名で本人判定できるようにするため。
--
-- 画像はアップロード前にブラウザ側で長辺1600px/WebP に再エンコードする。
-- 無料枠1GBに対しスマホ写真は1枚3〜5MBあり、そのままだと250枚で埋まるため。
-- 再エンコードの副作用で EXIF（位置情報を含む）が落ちるのでプライバシー面でも都合がよい。
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "own photo objects read" on storage.objects;
create policy "own photo objects read" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own photo objects write" on storage.objects;
create policy "own photo objects write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own photo objects delete" on storage.objects;
create policy "own photo objects delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        date not null,
  storage_path text not null unique,
  caption     text,
  width       integer,
  height      integer,
  size_bytes  integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists photos_user_date_idx on public.photos (user_id, date);

drop trigger if exists trg_photos_updated on public.photos;
create trigger trg_photos_updated before update on public.photos
  for each row execute function public.set_updated_at();

alter table public.photos enable row level security;

drop policy if exists "own photos" on public.photos;
create policy "own photos" on public.photos
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.photos to authenticated;

-- =====================================================================
-- Phase 9: カレンダー共有（ユーザー間・読み取り専用）
--
-- このアプリの中身は体調・服薬・睡眠・支出というセンシティブ情報の塊なので、
-- 「カレンダーを共有」を素朴に作ると全部見えてしまう。
-- そこで共有は必ず次の3つで絞る:
--   scopes     … 何を共有するか（日記だけ、食事だけ、体調は除外 など）
--   期間        … いつからいつまで（null は無制限）
--   読み取り専用 … 相手に書き込み権は一切与えない（SELECT ポリシーしか追加しない）
--
-- 公開リンク方式ではなくユーザー間招待にしているのは、URL が漏れた時点で
-- 漏洩になる方式を避けるため。解除も確実にできる。
-- =====================================================================
create table if not exists public.shares (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users (id) on delete cascade,
  owner_email   text not null,                    -- 相手に表示する用（auth.users は参照できないため持たせる）
  invitee_email text not null,                    -- 招待先。承諾時にログイン中のメールと突き合わせる
  viewer_id     uuid references auth.users (id) on delete cascade,  -- 承諾後に埋まる
  scopes        text[] not null default '{diary}',
  start_date    date,
  end_date      date,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  updated_at    timestamptz not null default now(),
  -- 同じ相手への重複招待を防ぐ
  unique (owner_id, invitee_email)
);

create index if not exists shares_viewer_idx on public.shares (viewer_id, status);
create index if not exists shares_invitee_idx on public.shares (lower(invitee_email), status);

drop trigger if exists trg_shares_updated on public.shares;
create trigger trg_shares_updated before update on public.shares
  for each row execute function public.set_updated_at();

alter table public.shares enable row level security;

-- 共有元は自分の作った共有を自由に操作できる
drop policy if exists "owner manages shares" on public.shares;
create policy "owner manages shares" on public.shares
  for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- 招待された側は、自分宛の招待と自分が承諾済みの共有を読めるだけ（書き換えは不可）
drop policy if exists "invitee reads shares" on public.shares;
create policy "invitee reads shares" on public.shares
  for select to authenticated
  using (
    auth.uid() = viewer_id
    or lower(invitee_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

grant select, insert, update, delete on public.shares to authenticated;

-- 「この日のこのカテゴリを、今ログインしている人が見てよいか」を判定する。
-- security definer にしているのは、閲覧側が shares を直接読めない経路でも
-- 判定できるようにするため。auth.uid() を関数内で固定しているので、
-- 引数を細工しても他人になりすますことはできない。
create or replace function public.can_view(p_owner uuid, p_scope text, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shares s
    where s.owner_id = p_owner
      and s.viewer_id = auth.uid()
      and s.status = 'accepted'
      and p_scope = any (s.scopes)
      and (s.start_date is null or p_date >= s.start_date)
      and (s.end_date   is null or p_date <= s.end_date)
  );
$$;

-- 未ログイン（anon）には実行させない。auth.uid() が null なら常に false を返すので
-- 実害はないが、他の security definer 関数（consume_ai_quota / accept_share）と扱いを揃える。
revoke execute on function public.can_view(uuid, text, date) from public, anon;
grant execute on function public.can_view(uuid, text, date) to authenticated;

-- 閲覧用のポリシーを各テーブルに足す。
-- 既存の「own X」（FOR ALL）とは別の SELECT ポリシーなので OR で効き、
-- 相手に書き込み権は増えない。
drop policy if exists "shared diary read" on public.diary_entries;
create policy "shared diary read" on public.diary_entries
  for select to authenticated using (public.can_view(user_id, 'diary', date));

drop policy if exists "shared condition read" on public.daily_records;
create policy "shared condition read" on public.daily_records
  for select to authenticated using (public.can_view(user_id, 'condition', date));

drop policy if exists "shared weather read" on public.weather_records;
create policy "shared weather read" on public.weather_records
  for select to authenticated using (public.can_view(user_id, 'weather', date));

drop policy if exists "shared meal read" on public.meal_entries;
create policy "shared meal read" on public.meal_entries
  for select to authenticated using (public.can_view(user_id, 'meal', date));

drop policy if exists "shared expense read" on public.expenses;
create policy "shared expense read" on public.expenses
  for select to authenticated using (public.can_view(user_id, 'expense', date));

drop policy if exists "shared photo read" on public.photos;
create policy "shared photo read" on public.photos
  for select to authenticated using (public.can_view(user_id, 'photo', date));

-- 共有された写真の実体も読めるようにする。
-- パスの先頭が所有者の user_id なので、そこから所有者を割り出して判定する。
drop policy if exists "shared photo objects read" on storage.objects;
create policy "shared photo objects read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and public.can_view(
      ((storage.foldername(name))[1])::uuid,
      'photo',
      ((storage.foldername(name))[2])::date
    )
  );

-- 招待を承諾する。
-- 招待側が shares を直接 UPDATE できてしまうと scopes や期間を書き換えられるため、
-- 承諾はこの関数だけに絞り、viewer_id と status 以外は触らせない。
create or replace function public.accept_share(p_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_rows  integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if v_email = '' then
    raise exception 'メールアドレスを確認できませんでした';
  end if;

  update public.shares
     set viewer_id = auth.uid(), status = 'accepted', accepted_at = now()
   where id = p_share_id
     and status = 'pending'
     and lower(invitee_email) = v_email;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception '承諾できる招待が見つかりませんでした';
  end if;
end;
$$;

revoke execute on function public.accept_share(uuid) from public, anon;
grant execute on function public.accept_share(uuid) to authenticated;

-- 対象日の列挙に写真を含める（photos は上で作られるので、ここで定義し直す）
create or replace function public.lifelog_dates(p_limit integer default 2000)
returns table (date date)
language sql
stable
as $$
  select d from (
    select date as d from public.daily_records  where user_id = auth.uid()
    union select date from public.weather_records where user_id = auth.uid()
    union select date from public.meal_entries   where user_id = auth.uid()
    union select date from public.expenses       where user_id = auth.uid()
    union select date from public.diary_entries  where user_id = auth.uid()
    union select date from public.photos         where user_id = auth.uid()
  ) t
  order by d desc
  limit greatest(1, least(p_limit, 5000));
$$;

grant execute on function public.lifelog_dates(integer) to authenticated;

-- =====================================================================
-- Phase 12: 天気の自動取得に使う位置情報
-- 天気サービス（Open-Meteo）は API キー不要なのでブラウザから直接叩く。
-- ここに置くのは「どこの天気を取るか」だけ。
-- =====================================================================
alter table public.user_settings add column if not exists home_latitude  numeric;
alter table public.user_settings add column if not exists home_longitude numeric;
alter table public.user_settings add column if not exists home_label     text;

-- =====================================================================
-- Phase 14: リンク
-- 日付にURLを紐づける。タイトルは AI 検索の対象になるので保存しておく。
-- =====================================================================
create table if not exists public.links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  date       date not null,
  url        text not null,
  title      text,
  memo       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists links_user_date_idx on public.links (user_id, date);

drop trigger if exists trg_links_updated on public.links;
create trigger trg_links_updated before update on public.links
  for each row execute function public.set_updated_at();

alter table public.links enable row level security;

drop policy if exists "own links" on public.links;
create policy "own links" on public.links
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "shared link read" on public.links;
create policy "shared link read" on public.links
  for select to authenticated using (public.can_view(user_id, 'link', date));

grant select, insert, update, delete on public.links to authenticated;

-- 対象日の列挙にリンクを含める（links は上で作られるので、ここで定義し直す）
create or replace function public.lifelog_dates(p_limit integer default 2000)
returns table (date date)
language sql
stable
as $$
  select d from (
    select date as d from public.daily_records  where user_id = auth.uid()
    union select date from public.weather_records where user_id = auth.uid()
    union select date from public.meal_entries   where user_id = auth.uid()
    union select date from public.expenses       where user_id = auth.uid()
    union select date from public.diary_entries  where user_id = auth.uid()
    union select date from public.photos         where user_id = auth.uid()
    union select date from public.links          where user_id = auth.uid()
  ) t
  order by d desc
  limit greatest(1, least(p_limit, 5000));
$$;

grant execute on function public.lifelog_dates(integer) to authenticated;

-- =====================================================================
-- Phase 15: 旅のしおり
--
-- ここまでの機能はすべて「過去の記録」で、user × date が単位だった。
-- しおりは性質が違う:
--   - 未来が主役（予定を立てる）
--   - 1日ではなく期間がひとまとまり（2泊3日を1つとして扱う）
--   - 時刻がある（10:00 出発、12:30 昼食）
-- 日単位のテーブルに混ぜると歪むので、独立した概念として持たせる。
--
-- このアプリで作る価値は、旅行が終わったあと。
-- 日記・写真・支出・体調が同じ期間に既に貯まっているので、
-- しおりがそのまま「旅の記録」に変わる（他のしおりアプリは旅行後に死ぬ）。
-- =====================================================================
create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  destination text,
  start_date  date not null,
  end_date    date not null,
  memo        text,
  budget      numeric,                        -- 予算。実績は expenses 側から集計する
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists trips_user_date_idx on public.trips (user_id, start_date);

-- しおりの項目（予定）。時刻は任意（「この日のどこか」も表現したいため）
create table if not exists public.trip_items (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  date       date not null,
  start_time time,
  kind       text not null default 'other'
               check (kind in ('move', 'stay', 'eat', 'see', 'other')),
  title      text not null,
  place      text,
  url        text,
  memo       text,
  cost       numeric,                          -- 見積もり
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_items_trip_idx on public.trip_items (trip_id, date, start_time, sort_order);

-- 持ち物チェックリスト
create table if not exists public.trip_checklist (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  text       text not null,
  checked    boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_checklist_trip_idx on public.trip_checklist (trip_id, sort_order);

drop trigger if exists trg_trips_updated on public.trips;
create trigger trg_trips_updated before update on public.trips
  for each row execute function public.set_updated_at();
drop trigger if exists trg_trip_items_updated on public.trip_items;
create trigger trg_trip_items_updated before update on public.trip_items
  for each row execute function public.set_updated_at();
drop trigger if exists trg_trip_checklist_updated on public.trip_checklist;
create trigger trg_trip_checklist_updated before update on public.trip_checklist
  for each row execute function public.set_updated_at();

alter table public.trips          enable row level security;
alter table public.trip_items     enable row level security;
alter table public.trip_checklist enable row level security;

drop policy if exists "own trips" on public.trips;
create policy "own trips" on public.trips
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own trip_items" on public.trip_items;
create policy "own trip_items" on public.trip_items
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own trip_checklist" on public.trip_checklist;
create policy "own trip_checklist" on public.trip_checklist
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 共有: 旅行期間のどこか1日でも共有範囲に入っていれば、しおり全体を見せる。
-- しおりは期間でひとまとまりなので、日単位で切ると意味をなさないため。
drop policy if exists "shared trips read" on public.trips;
create policy "shared trips read" on public.trips
  for select to authenticated
  using (public.can_view(user_id, 'trip', start_date) or public.can_view(user_id, 'trip', end_date));

drop policy if exists "shared trip_items read" on public.trip_items;
create policy "shared trip_items read" on public.trip_items
  for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id));

drop policy if exists "shared trip_checklist read" on public.trip_checklist;
create policy "shared trip_checklist read" on public.trip_checklist
  for select to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id));

grant select, insert, update, delete on public.trips          to authenticated;
grant select, insert, update, delete on public.trip_items     to authenticated;
grant select, insert, update, delete on public.trip_checklist to authenticated;

-- 旅行の実績支出（期間内の expenses を合計する）。
-- 予算と並べて出すために使う。
create or replace function public.trip_actual_cost(p_trip_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(sum(e.amount), 0)
  from public.trips t
  join public.expenses e
    on e.user_id = t.user_id and e.date between t.start_date and t.end_date
  where t.id = p_trip_id;
$$;

grant execute on function public.trip_actual_cost(uuid) to authenticated;
