import { test, expect } from '@playwright/test';

test('persistent pool dispatch latency', async ({ page, context }) => {
  await context.route('**/sw.js', (r) => r.abort());
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('ChemSim') || t.toLowerCase().includes('pool') || t.toLowerCase().includes('error')) {
      console.log(`[browser ${m.type()}]`, t);
    }
  });

  await page.goto('/');
  await page.waitForSelector('#loading-overlay.hidden', { timeout: 30000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const cs = (globalThis as any).__chemsim;
    // Warmup so the very first dispatch's JIT/worker cold start doesn't
    // dominate the average.
    cs.benchPoolDispatch(100);
    // Now measure.
    return cs.benchPoolDispatch(2000);
  });
  console.log('dispatch bench:', JSON.stringify(result));
  expect((result as any).error).toBeUndefined();
  // Sanity floor: dispatch should at least *return* and not be absurd.
  expect((result as any).perDispatchUs).toBeLessThan(5000);
});
