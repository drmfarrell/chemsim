import { test, expect } from '@playwright/test';

test.describe('Mode 1: Basic Loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for loading overlay to disappear
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });
  });

  test('app loads and shows two molecules', async ({ page }) => {
    // Canvas should be present
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Control panel should be visible
    await expect(page.locator('#control-panel')).toBeVisible();

    // Energy display should be visible
    await expect(page.locator('#energy-display')).toBeVisible();

    // FPS counter should show a number
    const fps = page.locator('#fps-counter');
    await expect(fps).toBeVisible();
    // Wait for FPS to update
    await page.waitForTimeout(1000);
    const fpsText = await fps.textContent();
    expect(fpsText).toMatch(/\d+ FPS/);
  });

  test('molecule dropdowns are populated', async ({ page }) => {
    const selA = page.locator('#molecule-a-selector');
    const options = await selA.locator('option').count();
    expect(options).toBeGreaterThanOrEqual(10);
  });

  test('energy readout shows values', async ({ page }) => {
    // Wait for physics to compute
    await page.waitForTimeout(500);

    const energy = page.locator('#energy-total');
    const text = await energy.textContent();
    expect(text).toMatch(/[\d.-]+ kJ\/mol/);
  });

  test('distance is displayed', async ({ page }) => {
    await page.waitForTimeout(500);
    const distance = page.locator('#distance-value');
    const text = await distance.textContent();
    expect(text).not.toBe('--');
  });
});
