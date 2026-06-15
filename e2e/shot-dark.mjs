import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'design-shots';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: 'dark',
});
const page = await ctx.newPage();

await page.goto(BASE + '/login');
await page.waitForLoadState('networkidle');
await page.fill('input[type="email"]', 'test@example.com');
await page.fill('input[type="password"]', 'Test1234!');
await page.click('button[type="submit"]');
await page.waitForSelector('.app-header', { timeout: 15000 });
await page.waitForTimeout(1000);

await page.goto(BASE + '/graph');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/v4-graph-dark.png`, fullPage: true });
console.log('dark graph shot done');

await ctx.close();
await browser.close();
console.log('done');
