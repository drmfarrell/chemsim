import { test, expect } from '@playwright/test';

const MOLECULES = [
  'water', 'hydrogen_sulfide', 'carbon_dioxide', 'methane',
  'carbon_tetrachloride', 'chloroform', 'methanol',
  'tetrafluoromethane', 'ammonia', 'urea',
];

test.describe('Mode 1: All Molecule Pairs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });
  });

  for (const mol of MOLECULES) {
    test(`loads ${mol} without crashing`, async ({ page }) => {
      // Select the molecule for A
      await page.selectOption('#molecule-a-selector', mol);
      // Give it time to load
      await page.waitForTimeout(1000);

      // Check the canvas is still rendering (no crash)
      const canvas = page.locator('canvas');
      await expect(canvas).toBeVisible();

      // Check FPS is still showing
      const fps = page.locator('#fps-counter');
      await page.waitForTimeout(500);
      const fpsText = await fps.textContent();
      expect(fpsText).toMatch(/\d+ FPS/);
    });
  }
});
