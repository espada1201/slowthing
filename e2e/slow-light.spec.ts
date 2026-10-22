import { expect, test } from '@playwright/test';
import { measureFlashes } from './flash';
import { clockSeconds, expectRendered, frames, goToStop, openWorld, readout, switchDiff, watchErrors } from './helpers';

test('renders the town, and every effect switch changes what you see', async ({ page }) => {
  // Six switch comparisons, each a few software-rendered frames: about 1.5 min on a busy 4-core machine.
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await expectRendered(page);
  // The Aberration stop cruises at 0.9 c.
  await goToStop(page, 'Aberration');
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });
  await frames(page, 20);
  for (const id of ['aberration', 'doppler', 'beaming', 'adapt']) expect((await switchDiff(page, id)).mean, `${id} should change the view`).toBeGreaterThan(4);

  // The Terrell stop calls the tram past you; freeze it in view and compare light delay and contraction.
  await goToStop(page, 'Terrell rotation');
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

test('Cruise from where the world opens carries you round the kiosk and the clock tower, not into them', async ({ page }) => {
  // Five of five testers pressed Cruise at the first stop and stopped dead against the kiosk or the tower.
  test.setTimeout(120_000);
  await openWorld(page, 'slow-light');
  await page.locator('[data-action="cruise"]:visible').first().click();
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });
  // The tower stands 66 m ahead: at 0.9 c (10.8 m/s) 10 s of town time takes you well past it.
  const t0 = await clockSeconds(page, 'Town clock t');
  let slowest = 1;
  while ((await clockSeconds(page, 'Town clock t')) < t0 + 10) {
    slowest = Math.min(slowest, parseFloat(await readout(page, 'β = v/c')));
    await frames(page, 2);
  }
  expect(slowest).toBeGreaterThan(0.85);
});

test('after the dials are turned, the tour card says the stop may not look as described, and puts them back', async ({ page }) => {
  // Testers read "A town at 12 m/s: light here crawls" beside a dial reading 299 792 458 m/s.
  await openWorld(page, 'slow-light');
  await expect(page.locator('.tour-turned')).toBeHidden();
  await page.locator('[data-reset="real"]').click();
  await expect(page.locator('.tour-turned')).toBeVisible();
  await page.getByRole('button', { name: 'Use this stop’s dials' }).click();
  expect(await page.evaluate(() => (window as any).slowlight.constants.c)).toBe(12);
  await expect(page.locator('.tour-turned')).toBeHidden();
});

test('the tour advances and resetting to the real universe restores c', async ({ page }) => {
  await openWorld(page, 'slow-light');
  const titles: string[] = [];
  for (let i = 0; i < 11; i++) {
    titles.push((await page.locator('.tour-title').textContent()) ?? '');
    await page.locator('[data-tour-next]').click();
  }
  expect(new Set(titles).size).toBe(11);
  await expect(page.locator('.tour-title')).toHaveText('The real universe');
  expect(await page.evaluate(() => (window as any).slowlight.constants.c)).toBe(299792458);
  await expect(page.locator('[data-tour-next]')).toBeDisabled();
});

test('the carousel lamps flash within the WCAG 2.3.1 limit', async ({ page }) => {
  test.setTimeout(180_000);
  await openWorld(page, 'slow-light');
  await goToStop(page, 'Moving clocks');
  const { flashes, area } = await measureFlashes(page, 2);
  // Light delay bunches some lamps' flashes past three a second; what keeps them safe is their small area.
  expect(flashes).toBeGreaterThan(3);
  expect(area).toBeLessThan(0.25);
});

test('a level reticle stays fixed at the centre at 0.9 c, and stays off once switched off', async ({ page }) => {
  const reticle = page.locator('.reticle');
  const cruise = async () => {
    await openWorld(page, 'slow-light');
    await expect(reticle).toBeHidden();
    await goToStop(page, 'Aberration');
    await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });
    await frames(page, 3);
  };
  await cruise();
  await expect(reticle).toBeVisible();
  const box = (await reticle.boundingBox())!;
  expect(box.x + box.width / 2).toBeCloseTo(640, 0);
  expect(box.y + box.height / 2).toBeCloseTo(400, 0);
  // Level: tilted by even 2°, the 72 × 12 px bar would be less than five times as wide as it is tall.
  expect(box.width).toBeGreaterThan(5 * box.height);

  await page.locator('[data-toggle="reticle"]').setChecked(false, { force: true });
  await expect(reticle).toBeHidden();
  await cruise();
  await expect(page.locator('[data-toggle="reticle"]')).not.toBeChecked();
  await expect(reticle).toBeHidden();
});
