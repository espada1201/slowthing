import { type Page, expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** True when a tap at the middle of the element would land on it, not on something drawn over it. */
const onTop = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && (el === hit || el.contains(hit) || (el instanceof HTMLInputElement && !!el.labels?.[0]?.contains(hit)));
  });

for (const world of ['slow-light', 'big-hbar', 'big-g']) {
  test(`${world} on a phone: nothing spills sideways and every control is tappable`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`./?world=${world}&quality=low&e2e`);
    await page.waitForFunction(() => (window as any).slowlight?.frames > 1, null, { timeout: 60_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('#panel')).toBeHidden();
    for (const sel of ['[data-tour-next]', '[data-back]', '.panel-toggle']) expect(await onTop(page, sel), `${sel} should be tappable`).toBe(true);
    await expect(page.locator('.quick [data-action]').first()).toBeVisible();

    await page.getByRole('button', { name: 'Dials' }).click();
    await expect(page.locator('#panel')).toBeVisible();
    const controls = await page.locator('#panel').evaluate((panel) =>
      [...panel.querySelectorAll<HTMLElement>('[data-dial], [data-reset], [data-share], [data-toggle], [data-action], select')].map((el) =>
        el.dataset.dial ? `[data-dial="${el.dataset.dial}"]` : el.dataset.reset ? `[data-reset="${el.dataset.reset}"]` : el.dataset.toggle ? `[data-toggle="${el.dataset.toggle}"]` : el.dataset.action ? `#panel [data-action="${el.dataset.action}"]` : el.hasAttribute('data-share') ? '[data-share]' : '#panel select',
      ),
    );
    expect(controls.length).toBeGreaterThan(3);
    for (const sel of controls) expect(await onTop(page, sel), `${sel} should be tappable with the panel open`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('a thumb drag on the left walks, and lifting it stops; the hint saying so goes once you have walked', async ({ page }) => {
  await page.goto('./?world=slow-light&quality=low&e2e');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 1, null, { timeout: 60_000 });
  const speed = () => page.evaluate(() => parseFloat((window as any).slowlight.readouts()[0].value));
  await expect(page.locator('.move-hint')).toContainText('left');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 600 }] });
  for (let y = 590; y >= 480; y -= 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y }] });
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[0].value) > 1, null, { timeout: 30_000 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => parseFloat((window as any).slowlight.readouts()[0].value) < 0.5, null, { timeout: 30_000 });
  expect(await speed()).toBeLessThan(0.5);
  await expect(page.locator('.move-hint')).toBeHidden();
});
