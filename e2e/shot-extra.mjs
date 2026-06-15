import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto(BASE + '/login');
await page.waitForLoadState('networkidle');
await page.fill('[data-testid="auth-email"]', 'test@example.com');
await page.fill('[data-testid="auth-password"]', 'Test1234!');
await page.click('[data-testid="auth-submit"]');
await page.waitForSelector('.app-header', { timeout: 15000 });
// history -> calendar tab
await page.goto(BASE + '/history');
await page.waitForTimeout(800);
await page.getByText('カレンダー', { exact: false }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: 'design-shots/history-calendar-mobile.png', fullPage: true });
// settings
await page.goto(BASE + '/settings');
await page.waitForTimeout(800);
await page.screenshot({ path: 'design-shots/settings-mobile.png', fullPage: true });
// add-meal modal on today
await page.goto(BASE + '/');
await page.waitForTimeout(800);
await page.getByText('追加', { exact: false }).first().click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'design-shots/today-addmodal-mobile.png', fullPage: true });
await browser.close();
console.log('extra done');
