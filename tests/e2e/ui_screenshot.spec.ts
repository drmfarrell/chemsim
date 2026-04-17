import { test } from '@playwright/test';
import fs from 'fs';

test('screenshot advanced + collapsed panel', async ({ page, context }) => {
  await context.route('**/sw.js', (r) => r.abort());
  await page.goto('/');
  await page.waitForSelector('#loading-overlay.hidden', { timeout: 30000 });
  await page.selectOption('#mode-selector', 'mode2');
  await page.waitForTimeout(2000);
  fs.mkdirSync('test-results', { recursive: true });

  // Initial state with advanced panel closed
  await page.screenshot({ path: 'test-results/ui-default.png' });

  // Open advanced panel
  await page.click('#advanced-btn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/ui-advanced-open.png' });

  // Close advanced, hide main panel
  await page.click('#advanced-close');
  await page.click('#toggle-main-panel');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/ui-panel-hidden.png' });
});
