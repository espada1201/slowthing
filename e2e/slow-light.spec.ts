import { expect, test } from '@playwright/test';
import { clockSeconds, expectRendered, frames, openWorld, readout, switchDiff, watchErrors } from './helpers';

test('renders the town, and every effect switch changes what you see', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await expectRendered(page);
  // Tour stop 3 cruises at 0.9 c.
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Aberration');
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });
  await frames(page, 20);
  for (const id of ['aberration', 'doppler', 'beaming', 'adapt']) expect((await switchDiff(page, id)).mean, `${id} should change the view`).toBeGreaterThan(4);

  // Stop 6 calls the tram past you; freeze it in view and compare light delay and contraction.
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Terrell rotation');
  const t0 = await clockSeconds(page, 'Town clock t');
  await page.waitForFunction((t) => {
    const [h, m, s] = (window as any).slowlight.readouts().find((r: any) => r.label === 'Town clock t').value.split(':').map(Number);
    return h * 3600 + m * 60 + s > t + 4.5;
  }, t0, { timeout: 90_000 });
  for (const id of ['delay', 'contraction']) expect((await switchDiff(page, id)).changed, `${id} should change the view`).toBeGreaterThan(2000);
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

test('keys keep driving after a click on a switch or a dial', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await page.locator('.switch:has([data-toggle="doppler"])').click();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[0].value) > 1, null, { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  await page.locator('[data-dial="c"]').click();
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('The late clock');
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
