# Lifelog 🥗 — 自己管理統合アプリ

体調・食事・栄養・家計簿・天気・気圧を日付単位で横断管理する自己管理アプリ。
「今日」画面で体調・天気気圧・食事・家計簿を**1日単位でまとめて入力**でき、
**分析ダッシュボード**で「体調×気圧」「支出カテゴリ別」「栄養推移」を可視化、
**CSV / Markdown** で書き出して AI 分析にも渡せる。スマホでの毎日利用を前提に設計。

## 主な機能（Phase 1 + 2）

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

## 技術スタック

| 区分 | 採用 |
|---|---|
| フロント | React 19 + TypeScript + Vite |
| ルーティング | react-router-dom |
| グラフ | recharts |
| バックエンド | Supabase（Auth / PostgreSQL / RLS） |

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

### 4. 開発サーバー起動

```bash
npm run dev
```

ブラウザで表示された URL（既定 `http://localhost:5173`）を開く。

### 5. ビルド

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

対象: [`src/lib/nutrition.test.ts`](src/lib/nutrition.test.ts) / [`src/lib/date.test.ts`](src/lib/date.test.ts)

### E2E テスト（Playwright）

実ブラウザで dev サーバー（実 Supabase 接続）を自動操作し、
**新規登録 → 食事記録 → 1日合計反映 → ログアウト → 再ログイン → データ残存** までを検証する。
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

すべて `user_id` に紐づき RLS で分離。将来の体調/天気気圧/家計簿テーブル追加に備え **日付単位** で設計。

- `meal_entries` — 食事記録（1 行 = 1 食品）
- `food_templates` — 食品テンプレート（単品）
- `meal_templates` — 食事セットテンプレート（複数食品 + 自動セットフラグ）
- `user_settings` — ユーザーごとの栄養目標（target_calories / protein / fat / carbohydrate）
- `daily_records` — 体調の日次記録（user×date、condition/mood/sleep/headache/medication/memo）
- `weather_records` — 天気・気圧の日次記録（user×date、weather/pressure/temp/humidity）
- `expenses` — 家計簿（amount/category/payment_method/memo）
- `expense_categories` — ユーザー追加の支出カテゴリ

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
| **Phase 6** | 統合ダッシュボード・CSV/Markdown 出力 | ✅ 完了（アプリ内 AI 分析は後続） |

---

## デプロイ（任意）

静的 SPA なので Vercel / Netlify / Cloudflare Pages 等にそのまま載せられる。
ビルドコマンド `npm run build`、出力ディレクトリ `dist`、環境変数 `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` を設定する。SPA のためルーティングの fallback（全て `index.html`）を有効にする。
