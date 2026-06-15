import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'design-shots';
mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';

const pages = [
  { path: '/', name: 'today' },
  { path: '/history', name: 'history' },
  { path: '/graph', name: 'graph' },
  { path: '/templates', name: 'templates' },
  { path: '/settings', name: 'settings' },
  { path: '/export', name: 'export' },
];

const viewports = [
  { w: 390, h: 844, tag: 'mobile' },
  { w: 1280, h: 900, tag: 'desktop' },
];

const browser = await chromium.launch();

for (const vp of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();

  // login
  await page.goto(BASE + '/login');
  await page.waitForLoadState('networkidle');
  // login page screenshot once (mobile only enough, but do both)
  await page.screenshot({ path: `${OUT}/login-${vp.tag}.png`, fullPage: true });

  // fill credentials
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'Test1234!');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.app-header', { timeout: 15000 });
  await page.waitForTimeout(1000);

  for (const p of pages) {
    await page.goto(BASE + p.path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${p.name}-${vp.tag}.png`, fullPage: true });
    console.log('shot', p.name, vp.tag);
  }
  await ctx.close();
}

await browser.close();
console.log('done');
