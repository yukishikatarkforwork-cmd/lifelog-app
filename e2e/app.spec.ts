import { test, expect } from '@playwright/test';

// 毎回ユニークなテストユーザーを作る（メール確認は OFF 前提）
const ts = Date.now();
const email = `lifelog-e2e-${ts}@example.com`;
const password = `Test-pw-${ts}`;
const FOOD = `E2Eテスト食品-${ts}`;
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
});
