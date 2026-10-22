import { type Page, expect, test } from '@playwright/test';
import { clockSeconds, expectRendered, frames, meanDiff, openWorld, readout, sample, spread, watchErrors } from './helpers';

test('title screen lists the three worlds and enters one from the keyboard', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?e2e');
  await expect(page.getByRole('heading', { name: 'Slowlight' })).toBeVisible();
  await expect(page.locator('.plate')).toHaveCount(3);
  // Two testers could not tell what c, ħ and G mean: each card says it in words.
  await expect(page.locator('.plate[data-world="big-hbar"] .plate-dial')).toHaveText('ħ = 0.25 J·s, how wavy matter is');
  await page.locator('.plate[data-world="slow-light"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).slowlight?.world === 'slow-light');
  await expect(page.locator('.tour-title')).toHaveText('A town at 12 m/s');
  await page.getByRole('button', { name: '← Worlds' }).click();
  await expect(page.locator('.plate')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('inside a world, a first visit is told how to move until it moves, and is not told again', async ({ page }) => {
  // Three of five simulated testers could not find out how to walk once inside a world.
  await openWorld(page, 'slow-light');
  await expect(page.locator('.move-hint')).toBeVisible();
  await expect(page.locator('.move-hint')).toContainText('W A S D');
  await page.locator('#view').focus();
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[0].value) > 0.5, null, { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  await expect(page.locator('.move-hint')).toBeHidden();
  await openWorld(page, 'big-hbar');
  await expect(page.locator('.move-hint')).toBeHidden();
});

test('a world that fails to load says so, and the other worlds still open', async ({ page }) => {
  await page.route(/\/assets\/bigG-[^/]+\.js$/, (route) => route.abort());
  await page.goto('./?quality=low&e2e');
  await page.locator('.plate[data-world="big-g"]').click();
  await expect(page.getByRole('alert')).toContainText('failed to start');
  await page.locator('.plate[data-world="slow-light"]').click();
  await page.waitForFunction(() => (window as any).slowlight?.world === 'slow-light');
});

test('N on the last tour stop and B on the first leave the world as it is, like their disabled buttons', async ({ page }) => {
  await openWorld(page, 'slow-light');
  const c = () => page.evaluate(() => (window as any).slowlight.constants.c);
  const turn = (v: number) =>
    page.locator('[data-dial="c"]').evaluate((el: HTMLInputElement, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
  await turn(600);
  const first = await c();
  await page.keyboard.press('KeyB');
  await frames(page, 2);
  expect(await c()).toBe(first);
  await expect(page.locator('.tour-no')).toHaveText(/^1 \//);

  const stops = Number((await page.locator('.tour-no').textContent())!.split('/')[1]);
  for (let i = 1; i < stops; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-no')).toHaveText(`${stops} / ${stops}`);
  await turn(300);
  const last = await c();
  await page.keyboard.press('KeyN');
  await frames(page, 2);
  expect(await c()).toBe(last);
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
  await expect(page.locator('.toast')).toContainText('every effect back on');
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

test('if the GPU checks cannot load, the proofs page says so instead of passing without them', async ({ page }) => {
  await page.route(/\/assets\/bigG-[^/]+\.js$/, (route) => route.abort());
  await page.goto('./?proofs&e2e');
  await expect(page.locator('.proof[data-proof="gpu-load"]')).toHaveAttribute('data-state', 'fail', { timeout: 60_000 });
  await expect(page.locator('.proofs-summary')).toHaveText(/^\d+ of \d+ passed$/, { timeout: 150_000 });
  const [passed, total] = (await page.locator('.proofs-summary').textContent())!.match(/\d+/g)!.map(Number);
  expect(passed).toBeLessThan(total);
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

test('with reduced motion, a world holds still until a key press, and holds again while a cruise waits for its Start button', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorld(page, 'slow-light');
  await expect(page.locator('.status')).toHaveText(/nothing moves until you tap/);
  const view = await sample(page);
  const t = await clockSeconds(page, 'Town clock t');
  await frames(page, 5);
  expect(meanDiff(await sample(page), view)).toBe(0);
  expect(await clockSeconds(page, 'Town clock t')).toBe(t);

  await page.keyboard.press('KeyN');
  await expect.poll(() => clockSeconds(page, 'Town clock t'), { timeout: 60_000 }).toBeGreaterThan(t + 0.5);
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Aberration');
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await expect(start).toBeVisible();
  const held = await clockSeconds(page, 'Town clock t');
  await frames(page, 10);
  expect(await readout(page, 'β = v/c')).toBe('0.000');
  expect(await clockSeconds(page, 'Town clock t')).toBe(held);
  await start.click();
  await expect(start).toBeHidden();
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[1].value) > 0.85, null, { timeout: 60_000 });

  // The next stop's cruise waits as well: its calm Stop brings you to rest, and the instruments on screen say so at once.
  await page.keyboard.press('KeyN');
  await expect(start).toBeVisible();
  await expect(page.locator('.status')).toHaveText(/nothing moves until you tap/);
  await expect(page.locator('dt', { hasText: 'β = v/c' }).locator('xpath=following-sibling::dd[1]')).toHaveText('0.000');
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

/** Lose or restore the view's WebGL context, as a graphics card reset does. */
const gpu = (page: Page, call: 'loseContext' | 'restoreContext') =>
  page.evaluate((c) => {
    const w = window as any;
    // A lost context hands out no extensions, so keep the one that restores it.
    w.loseContext ??= document.querySelector<HTMLCanvasElement>('#view')!.getContext('webgl2')!.getExtension('WEBGL_lose_context');
    w.loseContext[c]();
  }, call);

test('a graphics card reset is explained until the view comes back, and a reload suggested if it never does', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  const notice = page.locator('#gpu-reset');
  await expect(notice).toHaveRole('status');
  await expect(notice).toBeHidden();

  await gpu(page, 'loseContext');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText('The graphics card was reset. Restoring the view…');
  expect(spread(await sample(page)), 'the view is gone while the context is lost').toBe(0);
  await gpu(page, 'restoreContext');
  await expect(notice).toBeEmpty();
  await expect(notice).toBeHidden();
  await frames(page, 10);
  await expectRendered(page);

  await gpu(page, 'loseContext');
  await expect(notice).toHaveText('The graphics card was reset and the view did not come back. Reload the page to bring the world back.', { timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('Auto quality does not judge the empty frames drawn while the graphics context is lost', async ({ page }) => {
  await page.goto('./?world=slow-light');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 0);
  await gpu(page, 'loseContext');
  const before = await page.evaluate(() => (window as any).slowlight.frames);
  // Judged, these quick empty frames lift Auto to the high preset within 5 s.
  await page.waitForTimeout(8000);
  expect(await page.evaluate(() => (window as any).slowlight.frames)).toBeGreaterThan(before + 100);
  await expect(page.locator('.top-right select option[value="auto"]')).toHaveText('Auto (medium)');
});
