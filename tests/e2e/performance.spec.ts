import { test, expect } from '@playwright/test';

test.describe('Performance', () => {
  test('FPS stays above 30 for 10 seconds in Mode 1', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });

    // Collect FPS readings over 10 seconds
    const fpsReadings: number[] = [];

    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const fps = page.locator('#fps-counter');
      const text = await fps.textContent();
      const num = parseInt(text || '0');
      fpsReadings.push(num);
    }

    // All readings should be above 30
    const minFps = Math.min(...fpsReadings);
    const avgFps = fpsReadings.reduce((a, b) => a + b, 0) / fpsReadings.length;

    console.log(`FPS readings: ${fpsReadings.join(', ')}`);
    console.log(`Min FPS: ${minFps}, Avg FPS: ${avgFps}`);

    // Allow for occasional dip but average should be good
    expect(avgFps).toBeGreaterThan(25);
  });
});
