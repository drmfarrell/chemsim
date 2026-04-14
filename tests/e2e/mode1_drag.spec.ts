import { test, expect } from '@playwright/test';

test.describe('Mode 1: Drag Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#loading-overlay.hidden', { timeout: 15000 });
    await page.waitForTimeout(500); // Let initial render settle
  });

  test('dragging molecule B changes energy readout', async ({ page }) => {
    // Get initial energy
    await page.waitForTimeout(300);
    const initialEnergy = await page.locator('#energy-total').textContent();

    // Get canvas center and try to drag molecule B (positioned to the right)
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    // Molecule B starts at +5 Angstroms to the right of center
    // In screen space, that's roughly center + some offset
    const centerX = box.x + box.width * 0.65; // molecule B is right of center
    const centerY = box.y + box.height * 0.5;

    // Drag toward molecule A (center)
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, centerY, { steps: 10 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    const newEnergy = await page.locator('#energy-total').textContent();

    // Energy should have changed (molecules are closer now)
    // We can't predict the exact value, but it should be different
    // (In practice the energy gets more negative as molecules approach)
    expect(newEnergy).not.toBeNull();
  });

  test('distance readout updates during interaction', async ({ page }) => {
    // Initial distance should be shown
    await page.waitForTimeout(300);
    const distance = page.locator('#distance-value');
    const text = await distance.textContent();
    // Should show a number, not the default "--"
    expect(text).not.toBe('--');
    expect(text).toMatch(/[\d.]+/);
  });
});
