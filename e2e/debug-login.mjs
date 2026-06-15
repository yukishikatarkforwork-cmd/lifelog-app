import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5173';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('console', m => console.log('CONSOLE', m.type(), m.text()));
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto(BASE + '/login');
await page.waitForLoadState('networkidle');
await page.fill('[data-testid="auth-email"]', 'test@example.com');
await page.fill('[data-testid="auth-password"]', 'Test1234!');
await page.click('[data-testid="auth-submit"]');
await page.waitForTimeout(2500);
console.log('URL after login:', page.url());
const err = await page.locator('.error-box').first().textContent().catch(() => null);
console.log('error-box:', err);
const ls = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter(k => k.includes('supabase') || k.includes('sb-'));
  return keys.map(k => k + ' = ' + (localStorage.getItem(k) || '').slice(0, 40));
});
console.log('localStorage auth keys:', ls);
await page.screenshot({ path: 'design-shots/_debug-afterlogin.png', fullPage: true });

// now try navigating to / and see
await page.goto(BASE + '/');
await page.waitForTimeout(2000);
console.log('URL after goto /:', page.url());
await browser.close();
