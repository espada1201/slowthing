import { expect, test } from '@playwright/test';
import { clockSeconds, frames, meanDiff, openWorld, readout, sample, watchErrors } from './helpers';

test('title screen lists the three worlds and enters one from the keyboard', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?e2e');
  await expect(page.getByRole('heading', { name: 'Slowlight' })).toBeVisible();
  await expect(page.locator('.plate')).toHaveCount(3);
  await page.locator('.plate[data-world="slow-light"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).slowlight?.world === 'slow-light');
  await expect(page.locator('.tour-title')).toHaveText('A town at 12 m/s');
  await page.getByRole('button', { name: '← Worlds' }).click();
  await expect(page.locator('.plate')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a shared link restores the dial settings', async ({ page }) => {
  await page.goto('./?world=slow-light&quality=low&e2e&c=50');
  await page.waitForFunction(() => (window as any).slowlight?.world === 'slow-light');
  const c = await page.evaluate(() => (window as any).slowlight.constants.c);
  expect(c).toBeCloseTo(50, 6);
  await expect(page.locator('.dial-value').first()).toContainText('50 m/s');
});

test('phone layout keeps the dials behind a toggle, on top of the instruments', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?world=slow-light&quality=low&e2e');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 3);
  await expect(page.locator('#panel')).toBeHidden();
  await page.getByRole('button', { name: 'Dials' }).click();
  await expect(page.locator('#panel')).toBeVisible();
  // Every control in the open panel must be the thing a tap actually lands on.
  for (const sel of ['[data-dial="c"]', '[data-reset="real"]', '.switch:has([data-toggle="doppler"])']) {
    const control = page.locator(sel);
    await control.scrollIntoViewIfNeeded();
    const onTop = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (el === hit || el.contains(hit));
    });
    expect(onTop, `${sel} should not be covered`).toBe(true);
  }
  await page.locator('[data-reset="real"]').click();
  expect(await page.evaluate(() => (window as any).slowlight.constants.c)).toBe(299792458);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('on a phone the main actions are one tap away, outside the dials', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?world=big-hbar&quality=low&e2e');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 3);
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('.quick [data-action="measure"]')).toBeVisible();
  await expect(page.locator('.panel-quality select')).toBeAttached();
});

test('every proof passes in the browser, including the GPU shader checks', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.goto('./?proofs&e2e');
  await expect(page.locator('.proof')).not.toHaveCount(0);
  await expect(page.locator('.proofs-summary')).toHaveText(/^(\d+) of \1 passed$/, { timeout: 150_000 });
  await expect(page.locator('.proof[data-state="fail"]')).toHaveCount(0);
  for (const id of ['gpu-aberration', 'gpu-doppler', 'gpu-retarded', 'gpu-tram-colour', 'gpu-schrodinger', 'gpu-geodesics']) await expect(page.locator(`.proof[data-proof="${id}"]`)).toHaveAttribute('data-state', 'pass');
  expect(errors).toEqual([]);
});

test('a tour prediction can be answered and then explains itself', async ({ page }) => {
  await page.goto('./?world=slow-light&quality=low&e2e');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 3);
  await page.locator('[data-tour-next]').click();
  await expect(page.locator('.predict-q')).toContainText('Compared with your watch');
  await expect(page.locator('.tour-text')).toBeHidden();
  await page.locator('.choice[data-choice="2"]').click();
  await expect(page.locator('.choice[data-choice="1"]')).toHaveAttribute('data-state', 'right');
  await expect(page.locator('.choice[data-choice="2"]')).toHaveAttribute('data-state', 'wrong');
  await expect(page.locator('.predict-reveal')).toContainText('5.4 s');
  await expect(page.locator('.tour-text')).toBeVisible();
});

test('with reduced motion, a world holds still until a key press, and a cruise waits for its Start button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorld(page, 'slow-light');
  await expect(page.locator('.status')).toHaveText(/nothing moves until you tap/);
  const view = await sample(page);
  const t = await clockSeconds(page, 'Town clock t');
  await frames(page, 5);
  expect(meanDiff(await sample(page), view)).toBe(0);
  expect(await clockSeconds(page, 'Town clock t')).toBe(t);

  await page.keyboard.press('KeyN');
  await page.waitForFunction((t0) => {
    const [h, m, s] = (window as any).slowlight.readouts().find((r: any) => r.label === 'Town clock t').value.split(':').map(Number);
    return h * 3600 + m * 60 + s > t0 + 0.5;
  }, t);
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Aberration');
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeVisible();
  await frames(page, 10);
  expect(await readout(page, 'β = v/c')).toBe('0.000');
  await start.click();
  await expect(start).toBeHidden();
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });
});

test('Auto quality drops to the low preset at half resolution on a slow GPU, and a preset chosen by hand stays', async ({ page }) => {
  // No e2e flag here: that switches Auto quality off. The software renderer draws every frame far too slowly.
  await page.goto('./?world=slow-light');
  const menu = page.locator('.top-right select');
  const width = () => page.evaluate(() => document.querySelector<HTMLCanvasElement>('#view')!.width);
  await expect(menu.locator('option[value="auto"]')).toHaveText('Auto (medium)');
  await expect(menu.locator('option[value="auto"]')).toHaveText('Auto (low)', { timeout: 60_000 });
  await expect.poll(width, { timeout: 30_000 }).toBeCloseTo(1280 * 0.7 * 0.5, -1);
  await page.waitForTimeout(5000);
  await expect(menu.locator('option[value="auto"]')).toHaveText('Auto (low)');

  await menu.selectOption('high');
  await expect(menu.locator('option[value="auto"]')).toHaveText('Auto');
  await expect.poll(width, { timeout: 60_000 }).toBeCloseTo(1280 * 0.5, -1);
  await page.reload();
  await expect(page.locator('.top-right select')).toHaveValue('high');
});
