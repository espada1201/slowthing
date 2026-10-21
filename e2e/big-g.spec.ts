import { type Page, expect, test } from '@playwright/test';
import { expectRendered, frames, meanDiff, openWorld, readout, sample, watchErrors } from './helpers';

// Every pixel marches a light ray, which software rendering in CI draws at well under one frame a second.
test.slow();

/** Drag the G slider to a position (0 = the real G, 1000 = its maximum) and let the picture catch up. */
async function setG(page: Page, step: number) {
  await page.locator('[data-dial="G"]').evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, step);
  await frames(page, 2);
}

test('the G dial turns the black hole back into a rock, or makes it bigger', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-g');
  const hole = await expectRendered(page);
  expect(await readout(page, 'Schwarzschild radius')).toBe('4.5 m');

  await setG(page, 0);
  expect(await readout(page, 'Schwarzschild radius')).toContain('10⁻²²');
  expect(await page.evaluate(() => (window as any).slowlight.status())).toContain('nothing visibly bends');
  expect(meanDiff(hole, await sample(page)), 'the real G should show the rock, not the hole').toBeGreaterThan(4);

  // The world preset sits at step 960; 15 steps more is a little over twice the G.
  await setG(page, 975);
  expect(parseFloat(await readout(page, 'Schwarzschild radius'))).toBeGreaterThan(9);
  expect(meanDiff(hole, await sample(page)), 'a bigger G should show a bigger shadow').toBeGreaterThan(4);
  expect(errors).toEqual([]);
});

test('light bending and the gravitational shift each change the picture', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-g');
  for (const id of ['lensing', 'redshift']) {
    await frames(page, 2);
    const on = await sample(page);
    await page.locator(`[data-toggle="${id}"]`).uncheck({ force: true });
    await frames(page, 2);
    const off = await sample(page);
    expect(meanDiff(on, off), `${id} toggle should change the image`).toBeGreaterThan(4);
    await page.locator(`[data-toggle="${id}"]`).check({ force: true });
  }
  expect(errors).toEqual([]);
});

test('the readouts follow you toward the hole', async ({ page }) => {
  await openWorld(page, 'big-g');
  const start = parseFloat(await readout(page, 'Your distance r'));
  await page.locator('#view').focus();
  await page.keyboard.press('KeyF');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForFunction((r0) => parseFloat((window as any).slowlight.readouts()[1].value) < r0 - 10, start, { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  expect(parseFloat(await readout(page, 'Your clock rate'))).toBeLessThan(0.9397);

  // The last tour stop hovers at 1.2 rs.
  for (let i = 0; i < 7; i++) await page.keyboard.press('KeyN');
  await frames(page, 2);
  expect(parseFloat(await readout(page, 'Your clock rate'))).toBeCloseTo(0.414, 2);
  expect(await readout(page, 'Shadow')).toBe('73% of sky');
});
