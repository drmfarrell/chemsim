import { test, expect } from '@playwright/test';

test.describe('VR Entry', () => {
  test('VR button visibility reflects WebXR support', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });

    // In headless Chromium, WebXR is NOT supported, so the VR button should be hidden
    const vrButton = page.locator('#vr-button');
    // The button exists in the DOM but should not be displayed
    const display = await vrButton.evaluate(el => window.getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('WebXR detection does not crash the app', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });

    // Even without VR support, the app should function normally
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Mode switching should still work
    await page.selectOption('#mode-selector', 'mode2');
    await page.waitForTimeout(1000);
    await page.selectOption('#mode-selector', 'mode1');
    await page.waitForTimeout(500);

    await expect(canvas).toBeVisible();
  });
});
