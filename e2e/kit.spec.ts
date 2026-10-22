import { type Page, expect, test } from '@playwright/test';
import { WORLDS } from '../src/worlds';
import { goToStop, watchErrors } from './helpers';

const worlds = Object.keys(WORLDS);
/** The stop each world's round trip shares from. */
const away: Record<string, string> = { 'slow-light': 'Whose now?', 'big-hbar': 'Two openings', 'big-g': 'Weigh the hole' };

/** Open an address and wait until the app has entered `world` (and restored whatever the address names). */
async function enter(page: Page, url: string, world: string) {
  await page.goto(url);
  await page.waitForFunction((id) => (window as any).slowlight?.world === id, world, { timeout: 60_000 });
}

const setupOf = (page: Page) => page.evaluate(() => (window as any).slowlight.setup);
/**
 * Each of the world's switches as its control shows it: an effect's checkbox, or whether a way of looking (World I's
 * Measured map) is pressed. World I's Comfort reticle is the visitor's own setting, not the world's, and links leave it out.
 */
async function shown(page: Page) {
  const ids = Object.keys((await setupOf(page)).switches);
  return page.evaluate(
    (ids) =>
      Object.fromEntries(
        ids.map((id) => {
          const box = document.querySelector<HTMLInputElement>(`[data-toggle="${id}"]`);
          const view = document.querySelector(`[data-view="${id}"]`);
          return [id, box ? box.checked : view ? view.getAttribute('aria-pressed') === 'true' : null];
        }),
      ),
    ids,
  );
}
const search = (page: Page) => new URL(page.url()).search;
/** With World I's Measured map open, the Dials panel waits behind its button: open it, as a visitor would. */
async function openPanel(page: Page) {
  if (!(await page.locator('[data-share]').isVisible())) await page.locator('.panel-toggle').click();
}

// Software rendering draws Big G well under one frame a second, and each of these tests opens a world several times.
test.slow();

test('the classroom example link opens Terrell rotation with Doppler colour on, light delay off and c = 30', async ({ page }) => {
  const errors = watchErrors(page);
  const link = '?world=slow-light&stop=terrell-rotation&on=doppler&off=delay&c=30';
  await enter(page, `./${link}&quality=low&e2e`, 'slow-light');
  await expect(page.locator('.tour-title')).toHaveText('Terrell rotation');
  expect(await page.evaluate(() => (window as any).slowlight.tour)).toBe(5);
  await expect(page.locator('[data-toggle="doppler"]')).toBeChecked();
  await expect(page.locator('[data-toggle="beaming"]')).not.toBeChecked();
  await expect(page.locator('[data-toggle="delay"]')).not.toBeChecked();
  await expect(page.locator('[data-toggle="adapt"]')).toBeChecked();
  expect(await page.evaluate(() => (window as any).slowlight.constants.c)).toBe(30);
  await expect(page.locator('.dial-value').first()).toContainText('30 m/s');
  expect(search(page)).toBe(`${link}&quality=low`);
  await page.locator('[data-share]').click();
  expect(search(page)).toBe(link);
  expect(errors).toEqual([]);
});

for (const id of worlds) {
  test(`${id}: a shared stop, switches and dial reopen exactly, and Share writes the same link back`, async ({ page }) => {
    const errors = watchErrors(page);
    await enter(page, `./?world=${id}&quality=low&e2e`, id);
    await goToStop(page, away[id]);
    await openPanel(page);
    const own = (await setupOf(page)).switches;
    const boxes = await page.locator('[data-toggle]').evaluateAll((els) => els.map((el) => [el.getAttribute('data-toggle')!, (el as HTMLInputElement).checked] as const));
    const flipped: Record<string, boolean> = {};
    for (const wanted of [true, false]) {
      const box = boxes.find(([id, on]) => id in own && on === wanted);
      if (box) await page.locator(`[data-toggle="${box[0]}"]`).setChecked((flipped[box[0]] = !wanted), { force: true });
    }
    for (const view of await page.locator('.topbar [data-view]').all()) await view.click();
    await page.locator('[data-dial]').evaluate((el: HTMLInputElement) => {
      el.value = '700';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const shared = await setupOf(page);
    expect(shared.switches).toMatchObject(flipped);
    await page.locator('[data-share]').click();
    const link = page.url();
    expect(link).toMatch(new RegExp(`\\?world=${id}&stop=[a-z0-9-]+&(on|off)=.*&(c|hbar|G)=[0-9.e-]+$`));

    await enter(page, `${link}&quality=low&e2e`, id);
    expect(await setupOf(page)).toEqual(shared);
    expect(await shown(page)).toEqual(shared.switches);
    expect(page.url()).toBe(`${link}&quality=low`);
    await openPanel(page);
    await page.locator('[data-share]').click();
    expect(page.url()).toBe(link);
    expect(errors).toEqual([]);
  });

  test(`${id}: a hostile link opens stop 1 as authored, with no errors`, async ({ page }) => {
    const errors = watchErrors(page);
    const hostile = new URLSearchParams({ world: id, quality: 'low', stop: '__proto__', on: '__proto__,constructor,toString', off: 'x'.repeat(10_000), c: '0x10', hbar: '-5', G: 'NaN', view: '<script>alert(1)</script>' });
    await enter(page, `./?${hostile}&e2e`, id);
    await expect(page.locator('.tour-no')).toHaveText(/^1 \//);
    // The address bar shows the canonical link, which names only what differs from the stop as authored: nothing.
    expect(search(page)).toBe(`?world=${id}&quality=low`);
    expect(await shown(page)).toEqual((await setupOf(page)).switches);
    expect(errors).toEqual([]);
  });
}

test('an id that is not a world opens the title screen', async ({ page }) => {
  const errors = watchErrors(page);
  for (const notAWorld of ['constructor', '__proto__', 'toString']) {
    await page.goto(`./?world=${notAWorld}&e2e`);
    await expect(page.locator('.plate')).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).slowlight.world)).toBeNull();
  }
  expect(errors).toEqual([]);
});
