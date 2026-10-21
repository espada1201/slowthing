import { expect, test } from '@playwright/test';
import { expectRendered, frames, meanDiff, openWorld, readout, sample, watchErrors } from './helpers';

test('renders the town and every effect toggle changes what you see at speed', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await expectRendered(page);
  // Tour stop 3 cruises at 0.9 c.
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Aberration');
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });
  for (const id of ['aberration', 'doppler', 'beaming']) {
    await frames(page, 3);
    const on = await sample(page);
    await page.locator(`[data-toggle="${id}"]`).uncheck({ force: true });
    await frames(page, 3);
    const off = await sample(page);
    expect(meanDiff(on, off), `${id} toggle should change the image`).toBeGreaterThan(4);
    await page.locator(`[data-toggle="${id}"]`).check({ force: true });
  }
  expect(errors).toEqual([]);
});

test('the clock HUD shows time dilation while you run', async ({ page }) => {
  await openWorld(page, 'slow-light');
  expect(await readout(page, 'β = v/c')).toBe('0.000');
  await page.locator('#view').focus();
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.5, null, { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const gamma = parseFloat(await readout(page, 'γ'));
  expect(gamma).toBeGreaterThan(1.1);
  const younger = parseFloat(await readout(page, 'You are younger by'));
  expect(younger).toBeGreaterThan(0);
});

test('the tour advances and resetting to the real universe restores c', async ({ page }) => {
  await openWorld(page, 'slow-light');
  const titles: string[] = [];
  for (let i = 0; i < 8; i++) {
    titles.push((await page.locator('.tour-title').textContent()) ?? '');
    await page.locator('[data-tour-next]').click();
  }
  expect(new Set(titles).size).toBe(8);
  await expect(page.locator('.tour-title')).toHaveText('The real universe');
  expect(await page.evaluate(() => (window as any).slowlight.constants.c)).toBe(299792458);
  await expect(page.locator('[data-tour-next]')).toBeDisabled();
});
