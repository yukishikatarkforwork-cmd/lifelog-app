import { test, expect } from '@playwright/test';

// 毎回ユニークなテストユーザーを作る（メール確認は OFF 前提）
const ts = Date.now();
const email = `lifelog-e2e-${ts}@example.com`;
const password = `Test-pw-${ts}`;
const FOOD = `E2Eテスト食品-${ts}`;
const DIARY_TITLE = `E2E日記-${ts}`;
const DIARY_BODY = `江ノ島に行った-${ts}`;
const SHARE_TARGET = `lifelog-e2e-share-${ts}@example.com`;
const TRIP_TITLE = `E2E旅行-${ts}`;
const KCAL = 432;

test('未ログインではログイン画面が表示される（ルートガード）', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-submit')).toBeVisible();
});

test('新規登録 → 食事記録 → 合計反映 → ログアウト → 再ログイン → データ残存', async ({ page }) => {
  // --- 新規登録（メール確認OFFのため即ログイン状態に）---
  await page.goto('/');
  await page.getByTestId('tab-signup').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();

  // ログイン成功 → 今日の記録画面。新規ユーザーなので合計は 0
  await expect(page.getByTestId('add-breakfast')).toBeVisible();
  await expect(page.getByTestId('total-calories')).toHaveText('0');

  // --- 朝食を1件記録 ---
  await page.getByTestId('add-breakfast').click();
  await page.getByTestId('meal-food-name').fill(FOOD);
  await page.getByTestId('meal-calories').fill(String(KCAL));
  await page.getByTestId('meal-save').click();

  // 記録が一覧に出て、1日合計カロリーに反映される
  await expect(page.getByText(FOOD)).toBeVisible();
  await expect(page.getByTestId('total-calories')).toHaveText(String(KCAL));

  // --- 体調を保存（Phase 3）---
  await page.getByTestId('condition-save').click();
  await expect(page.getByText('保存しました ✓').first()).toBeVisible();

  // --- 支出を追加（Phase 5）---
  await page.getByTestId('add-expense').click();
  await page.getByTestId('expense-amount').fill('1200');
  await page.getByTestId('expense-save').click();
  await expect(page.getByText('¥1,200').first()).toBeVisible();

  // --- 日記を書く（Phase 7）---
  await page.getByTestId('diary-title').fill(DIARY_TITLE);
  await page.getByTestId('diary-body').fill(DIARY_BODY);
  await page.getByTestId('diary-save').click();
  await expect(page.getByTestId('diary-save')).toHaveText('保存しました ✓');

  // --- 履歴の日記タブで本文検索して見つかる ---
  await page.getByTestId('nav-history').click();
  await page.getByTestId('tab-diary').click();
  await page.getByTestId('diary-search').fill(DIARY_BODY);
  await expect(page.getByText(DIARY_TITLE)).toBeVisible();
  // 一致しない語では出てこない
  await page.getByTestId('diary-search').fill(`該当なし-${ts}`);
  await expect(page.getByText('一致する日記がありません。')).toBeVisible();
  await page.getByTestId('nav-today').click();

  // --- 栄養目標を設定 → 今日の記録に「目標との比較」が出る ---
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('goal-calories').fill('2000');
  await page.getByTestId('goal-save').click();
  await expect(page.getByText('栄養目標を保存しました。')).toBeVisible();
  await page.getByTestId('nav-today').click();
  await expect(page.getByText('目標との比較')).toBeVisible();
  await expect(page.getByText(`${KCAL} / 2000 kcal`)).toBeVisible();

  // --- 写真カードが表示される（アップロードは Storage 設定に依存するのでここでは行わない）---
  await expect(page.getByRole('heading', { name: '写真' })).toBeVisible();

  // --- 旅のしおり: 作成 → 予定 → 持ち物（Phase 15）---
  await page.getByTestId('nav-trips').click();
  await page.getByTestId('trip-new').click();
  await page.getByTestId('trip-title').fill(TRIP_TITLE);
  // 未来日を入れられること自体がここでの確認点（記録用の入力とは違う）
  await page.getByTestId('trip-start').fill('2030-05-01');
  await page.getByTestId('trip-end').fill('2030-05-03');
  await page.getByTestId('trip-create').click();

  // 一覧に出る → 開く
  await page.getByText(TRIP_TITLE).click();
  await expect(page.getByText('2泊3日')).toBeVisible();

  // 予定を1件追加
  await page.getByTestId('trip-item-title').fill('清水寺を見る');
  await page.getByTestId('trip-item-add').click();
  await expect(page.getByText('清水寺を見る')).toBeVisible();

  // 持ち物を1件追加
  await page.getByTestId('trip-check-text').fill('充電器');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('充電器')).toBeVisible();

  // --- カレンダー共有: 作成 → 一覧に出る → 解除（Phase 9）---
  await page.getByTestId('nav-settings').click();
  await page.getByRole('link', { name: '共有の設定を開く' }).click();
  await page.getByTestId('share-email').fill(SHARE_TARGET);
  // 既定は日記・写真。体調も足して、範囲がそのまま保存されることを見る
  await page.getByTestId('scope-condition').click();
  await page.getByTestId('share-create').click();
  await expect(page.getByText(SHARE_TARGET)).toBeVisible();
  await expect(page.getByText('承諾待ち')).toBeVisible();

  // 解除すると一覧から消える
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '共有を解除' }).click();
  await expect(page.getByText(SHARE_TARGET)).toHaveCount(0);

  // --- ログアウト ---
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-submit')).toBeVisible(); // ログイン画面に戻る

  // --- 再ログイン（同じ資格情報）---
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(password);
  await page.getByTestId('auth-submit').click();

  // クラウド保存された本人の記録が残っている
  await expect(page.getByText(FOOD)).toBeVisible();
  await expect(page.getByTestId('total-calories')).toHaveText(String(KCAL));
  await expect(page.getByTestId('diary-title')).toHaveValue(DIARY_TITLE);
  await expect(page.getByTestId('diary-body')).toHaveValue(DIARY_BODY);
});
