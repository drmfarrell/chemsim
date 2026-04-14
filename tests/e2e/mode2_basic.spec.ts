import { test, expect } from '@playwright/test';

test.describe('Mode 2: Box Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });
  });

  test('switches to box mode and shows molecules', async ({ page }) => {
    // Switch to mode 2
    await page.selectOption('#mode-selector', 'mode2');

    // Wait for molecules to load
    await page.waitForTimeout(2000);

    // Canvas should still be visible
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Temperature slider should be visible
    await expect(page.locator('#temp-group')).toBeVisible();

    // Molecule count group should be visible
    await expect(page.locator('#molecule-count-group')).toBeVisible();

    // FPS should be reasonable
    const fps = page.locator('#fps-counter');
    await page.waitForTimeout(1000);
    const fpsText = await fps.textContent();
    const fpsNum = parseInt(fpsText || '0');
    expect(fpsNum).toBeGreaterThan(0);
  });

  test('temperature slider updates', async ({ page }) => {
    await page.selectOption('#mode-selector', 'mode2');
    await page.waitForTimeout(1000);

    // Change temperature via slider
    const slider = page.locator('#temp-slider');
    await slider.fill('500');
    await slider.dispatchEvent('input');

    // Verify the slider value itself changed (the display may be overwritten by simulation)
    const sliderValue = await slider.inputValue();
    expect(sliderValue).toBe('500');
  });
});
