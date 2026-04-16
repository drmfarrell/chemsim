import { test, expect } from '@playwright/test';
import fs from 'fs';

test('rayon thread pool initializes and mode 2 runs', async ({ page }) => {
  const messages: string[] = [];
  const errors: string[] = [];

  page.on('console', (msg) => messages.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`));

  await page.goto('/');
  await page.waitForSelector('#loading-overlay.hidden', { timeout: 30000 });

  const coi = await page.evaluate(() =>
    typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : null
  );
  console.log('crossOriginIsolated =', coi);
  console.log('Console so far:\n' + messages.join('\n'));
  console.log('Page errors:\n' + errors.join('\n'));

  expect(coi).toBe(true);
  expect(messages.some((m) => m.includes('rayon thread pool initialized'))).toBeTruthy();

  await page.selectOption('#mode-selector', 'mode2');
  await page.waitForTimeout(4000);

  // FPS counter should report non-zero
  const fpsText = (await page.locator('#fps-counter').textContent()) ?? '0';
  const fps = parseInt(fpsText);
  console.log('FPS after 4s in mode 2:', fps);

  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/rayon-mode2.png', fullPage: true });

  // Headless chromium often runs at software-GL speeds; just verify the loop
  // is ticking (not frozen) and no uncaught page errors fired.
  expect(fps).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
