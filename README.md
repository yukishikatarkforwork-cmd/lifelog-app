# Lifelog 🥗 — 自己管理統合アプリ

体調・食事・栄養・家計簿・天気・気圧・日記を日付単位で横断管理する自己管理アプリ。
「今日」画面で体調・天気気圧・食事・家計簿を**1日単位でまとめて入力**でき、
**分析ダッシュボード**で「体調×気圧」「支出カテゴリ別」「栄養推移」を可視化、
**CSV / Markdown** で書き出せるほか、**アプリ内で自分の記録について AI に質問**できる。スマホでの毎日利用を前提に設計。

---

## 🔑 動作確認用テストアカウント

チームでの動作チェック用に、共有のテストアカウントを用意しています。
個別にアカウントを発行しなくても、以下でログインして全機能を確認できます。

| 項目 | 値 |
|---|---|
| メールアドレス | `test@example.com` |
| パスワード | `Test1234!` |
| 本番URL | <https://lifelog-app-theta.vercel.app/> |

> ⚠️ **共有アカウントのため、テストデータの追加・削除はメンバー間で見えます。** 個人の本番利用には使わないでください。
> 本格利用する場合はログイン画面から各自で新規登録してください。

---

## 主な機能

**Phase 1（食事管理 MVP）**
- **ユーザー登録・ログイン**（Supabase Auth / メールアドレス）
- **クラウド保存・データ分離**（PostgreSQL + Row Level Security。本人のみ閲覧・編集可）
- **食事記録**：朝食・昼食・夕食・間食、食品名・量・カロリー・P/F/C・メモ・タグ
- **日別一覧と 1 日合計**（カロリー・PFC、PFC バランスバー）
- **食品テンプレート**：よく食べる単品を登録 → 記録時に呼び出し
- **食事セットテンプレート**：複数食品をまとめて登録。「自動セット」で当日に一括反映
- **栄養グラフ**：カロリー推移 / PFC 推移 / PFC バランス（7・14・30 日）
- **履歴**：日付ごとの記録一覧 → タップで当日へ
- **設定**：アカウント情報・ログアウト・全データ削除

**Phase 2（食事管理の強化）**
- **栄養目標設定**：1日の目標 kcal/PFC を設定し、「今日の記録」に達成率バーを表示
- **検索・タグ絞り込み**：履歴画面で食品名・メモ検索＋タグで絞り込み
- **CSV / Markdown 出力**：期間指定でダウンロード（Markdown は AI 分析に渡しやすい整形）

**Phase 3〜6（統合）**
- **体調記録**：体調スコア・気分・睡眠時間・頭痛・服薬・メモ（日付単位、`/` 今日画面）
- **天気・気圧記録**：天気・気圧(hPa)・気温・湿度・メモ（手入力。将来 API 連携を想定した設計）
- **家計簿**：金額・カテゴリ・支払い方法・メモ。支出カテゴリはユーザー追加可
- **分析ダッシュボード**：体調×気圧（二軸）／支出カテゴリ別（円）／カロリー・PFC 推移
- **統合出力**：体調・天気気圧・食事・家計簿を日別にまとめた Markdown／食事・家計簿の CSV
- **カレンダー表示**：履歴をリスト/カレンダーで切替。各日のセルを体調スコアで色分けし、食事・支出の有無をドット表示。日をタップでその日の記録へ
- **分析の高度化**：期間サマリー KPI（平均体調/睡眠/摂取kcal/平均支出/記録継続率）、**相関分析**（体調×気圧／体調×気圧の前日差Δ／体調×睡眠 のピアソン相関係数）、**条件別の平均体調**（頭痛・睡眠・天気で比較）

**Phase 7（日記）**
- **日記**：日付ごとにタイトル・本文・タグを記録（`/` 今日画面の一番下）
- **カレンダー連携**：日記のある日にドットを表示
- **日記の検索**：履歴画面の「日記」タブでタイトル・本文・タグを横断検索
- **統合 Markdown に同梱**：出力した Markdown に日記の全文が含まれる

**Phase 10（AI に聞く）**
- **アプリ内 AI 質問**：期間（7日/30日/90日/1年）を選び、自分の記録について自然文で質問できる
- **プリセット質問**：「気圧と体調の関係は？」「支出で削れそうなところは？」などをワンタップで
- **ストリーミング表示**：回答が届いた順に表示。中断も可能
- **API キーはサーバー側**：Supabase Edge Function を経由するため、キーはブラウザに出ない
- **利用回数制限**：1ユーザーあたり 1日 20回（コスト暴走の防止）

## 技術スタック

| 区分 | 採用 |
|---|---|
| フロント | React 19 + TypeScript + Vite |
| ルーティング | react-router-dom |
| グラフ | recharts |
| バックエンド | Supabase（Auth / PostgreSQL / RLS / Edge Functions） |
| AI | Claude API（`claude-opus-5`）を Supabase Edge Function 経由で利用 |

---

## セットアップ

### 1. 依存インストール

```bash
npm install
```

> ⚠️ **Google Drive 上（`G:\マイドライブ` 等）には置かないでください。** node_modules の展開時に
> Drive 仮想ファイルシステムが書き込みエラーを多発させます。ローカルディスク（例: `C:\Users\<you>\projects`）で開発し、
> GitHub をソース・オブ・トゥルースとして運用してください。

### 2. Supabase プロジェクト作成

1. <https://supabase.com> でプロジェクトを作成
2. **SQL Editor** で [`supabase/schema.sql`](supabase/schema.sql) を貼り付けて実行（テーブル・RLS・トリガを作成）
   - すべて `create table if not exists` / `create or replace` なので、**既存プロジェクトでも再実行して問題ない**。
     日記（Phase 7）と AI 利用回数（Phase 10）のテーブルを追加したので、更新時はもう一度実行すること。
3. **Project Settings > API** から `Project URL` と `anon public` キーを取得

### 3. 環境変数

`.env.example` をコピーして `.env` を作成し、値を設定：

```bash
cp .env.example .env
```

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

> メール確認を省略してすぐ試したい場合は、Supabase の
> **Authentication > Sign In / Providers > Email** で「Confirm email」をオフにする。

### 4. AI 機能（「AI に聞く」）のセットアップ

この機能だけ Supabase Edge Function を使う。**設定しなくてもアプリの他の機能は動く**（AI 画面だけがエラーになる）。

1. <https://console.anthropic.com> で API キーを発行する
2. Supabase CLI をインストールし、プロジェクトにリンクする

   ```bash
   npm install -g supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   ```

3. API キーを **Edge Function のシークレット** として登録する

   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```

   > ⚠️ **`.env` の `VITE_` 変数には絶対に入れないこと。** `VITE_` 接頭辞の値はビルド結果に埋め込まれ、
   > ブラウザから丸見えになる。API キーは必ず Edge Function のシークレットに置く。

4. デプロイする

   ```bash
   supabase functions deploy ask-ai
   ```

`SUPABASE_URL` と `SUPABASE_ANON_KEY` は Edge Function の実行環境に自動で入るため、設定は不要。

**コストのつまみ**（[`supabase/functions/ask-ai/index.ts`](supabase/functions/ask-ai/index.ts) の先頭）:

| 定数 | 既定値 | 意味 |
|---|---|---|
| `DAILY_LIMIT` | 20 | 1ユーザーあたり 1日の質問回数 |
| `MAX_RANGE_DAYS` | 400 | 1回で扱える最大日数 |
| `COMPACT_THRESHOLD_DAYS` | 120 | これを超える期間は構造化データを1日1行に圧縮（日記は常に全文） |
| `output_config.effort` | `high` | 回答の作り込み度。`medium` / `low` に下げるとコストと待ち時間が減る |

### 5. 開発サーバー起動

```bash
npm run dev
```

ブラウザで表示された URL（既定 `http://localhost:5173`）を開く。

### 6. ビルド

```bash
npm run build      # 型チェック + 本番ビルド（dist/）
npm run preview    # ビルド結果のプレビュー
```

---

## テスト

2層構成で「ちゃんと動くか」を機械的に確認できる。

### 単体テスト（Vitest）

栄養計算（合計・PFC換算・数値パース）と日付処理（月またぎ・曜日表示）を検証。高速・ネット不要。

```bash
npm test           # 1回実行
npm run test:watch # 監視モード
```

対象: [`src/lib/nutrition.test.ts`](src/lib/nutrition.test.ts) / [`src/lib/date.test.ts`](src/lib/date.test.ts) /
[`src/lib/analysis.test.ts`](src/lib/analysis.test.ts) / [`src/lib/export.test.ts`](src/lib/export.test.ts)（日記の Markdown 出力を含む）

### E2E テスト（Playwright）

実ブラウザで dev サーバー（実 Supabase 接続）を自動操作し、
**新規登録 → 食事記録 → 1日合計反映 → 日記の保存と検索 → ログアウト → 再ログイン → データ残存** までを検証する。
ログイン／ログアウト要件とクラウド保存を自動で実証する。

```bash
# 初回のみブラウザを取得
npx playwright install chromium

npm run test:e2e            # ヘッドレス実行（dev サーバーは自動起動）
npx playwright test --ui    # UI モードで対話的に実行
```

対象: [`e2e/app.spec.ts`](e2e/app.spec.ts)

> 前提: `.env`（Supabase 接続情報）と、Supabase 側で **Confirm email = OFF**。
> 注意: 実行ごとに `lifelog-e2e-<時刻>@example.com` のテストユーザーが Supabase Auth に作成される（蓄積したら Supabase ダッシュボードの Authentication > Users から削除可）。

---

## データモデル

すべて `user_id` に紐づき RLS で分離し、**日付単位**で設計している。

日記を `daily_records.memo` に相乗りさせず別テーブルにしているのは、将来のカレンダー共有（Phase 9）で
「日記は共有するが体調・服薬・家計簿は共有しない」を RLS で表現できるようにするため。
共有の粒度になりうる単位でテーブルを分けておく。

- `meal_entries` — 食事記録（1 行 = 1 食品）
- `food_templates` — 食品テンプレート（単品）
- `meal_templates` — 食事セットテンプレート（複数食品 + 自動セットフラグ）
- `user_settings` — ユーザーごとの栄養目標（target_calories / protein / fat / carbohydrate）
- `daily_records` — 体調の日次記録（user×date、condition/mood/sleep/headache/medication/memo）
- `weather_records` — 天気・気圧の日次記録（user×date、weather/pressure/temp/humidity）
- `expenses` — 家計簿（amount/category/payment_method/memo）
- `expense_categories` — ユーザー追加の支出カテゴリ
- `diary_entries` — 日記（user×date、title/body/tags）。体調メモとは別テーブル
- `ai_usage` — 「AI に聞く」の1日あたり利用回数（加算は `consume_ai_quota()` 関数経由のみ）

詳細は [`supabase/schema.sql`](supabase/schema.sql) を参照。

---

## ロードマップ

| フェーズ | 内容 | 状態 |
|---|---|---|
| **Phase 1** | 食事管理 MVP（記録・栄養素・テンプレート・グラフ） | ✅ 完了 |
| **Phase 2** | 栄養目標設定・検索・タグ絞り込み・CSV/Markdown 出力 | ✅ 完了（食品DB連携は後続） |
| **Phase 3** | 体調管理（体調スコア・睡眠・気分・頭痛・服薬・メモ） | ✅ 完了 |
| **Phase 4** | 天気・気圧（手入力、体調×気圧グラフ） | ✅ 完了（API連携は後続） |
| **Phase 5** | 家計簿（支出・カテゴリ・支払方法、カテゴリ別グラフ） | ✅ 完了 |
| **Phase 6** | 統合ダッシュボード・CSV/Markdown 出力 | ✅ 完了 |
| **Phase 7** | 日記（本文・タグ・検索・カレンダー連携・Markdown 同梱） | ✅ 完了 |
| **Phase 10** | AI に聞く（Edge Function + Claude API、ストリーミング） | ✅ 完了 |
| **Phase 8** | 写真（Supabase Storage・クライアント側圧縮・日記/食事/レシートに添付） | ⬜ 未着手 |
| **Phase 9** | カレンダー共有（ユーザー間招待・共有範囲の指定・読み取り専用） | ⬜ 未着手 |

---

## デプロイ（任意）

静的 SPA なので Vercel / Netlify / Cloudflare Pages 等にそのまま載せられる。
ビルドコマンド `npm run build`、出力ディレクトリ `dist`、環境変数 `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` を設定する。SPA のためルーティングの fallback（全て `index.html`）を有効にする。

「AI に聞く」を本番で使う場合は、上の **4. AI 機能のセットアップ** の Edge Function デプロイも必要
（ホスティング側の環境変数ではなく、Supabase 側のシークレットに API キーを置く）。
