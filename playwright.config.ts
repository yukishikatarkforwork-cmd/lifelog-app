import { defineConfig, devices } from '@playwright/test';

// ローカルの dev サーバー（実 Supabase に接続）に対して E2E を実行する。
// .env が必要（README 参照）。webServer が未起動なら自動で npm run dev する。
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  // 主な利用はスマホ。デスクトップ幅だと下部ナビ（data-testid 付き）が隠れるので、スマホ幅で流す
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
