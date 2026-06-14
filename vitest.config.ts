/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

// 単体テスト（Vitest）は src 配下のみ対象。
// E2E（Playwright / e2e 配下）は対象外にする。
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
