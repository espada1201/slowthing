import { type Page, expect, test } from '@playwright/test';
import { openWorld } from './helpers';

const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!;
const inside = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('at 200% browser zoom (640×400)', () => {
  test.use({ viewport: { width: 640, height: 400 } });

  test('with the map up, the instruments, map and tour card each have their own space', async ({ page }) => {
    // The card does not cover the instruments' lower rows.
    await openWorld(page, 'slow-light', '&on=measured');
    const [map, hud, card] = [await box(page, '.measured'), await box(page, '.hud'), await box(page, '.tour')];
    expect(overlap(map, card), 'map over the card').toBe(false);
    expect(overlap(hud, card), 'instruments under the card').toBe(false);
    expect(overlap(map, hud), 'map over the instruments').toBe(false);
  });
});

test.describe('a phone held sideways (844×390)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('the quick actions are on the tour card, as on an upright phone, and a question keeps the card on screen', async ({ page }) => {
    await openWorld(page, 'slow-light', '&stop=seen-and-measured');
    await expect(page.locator('.quick [data-action="cruise"]')).toBeVisible();
    await expect(page.locator('.quick [data-view="measured"]')).toBeVisible();
    await page.getByRole('button', { name: 'Just show me' }).tap();
    await expect(page.locator('.predict-reveal')).toBeVisible();
    const card = await box(page, '.tour');
    expect(card.y, 'the card keeps its title on screen').toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(390);
    await expect(page.locator('[data-tour-next]')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.quick [data-action="cruise"]')).toBeInViewport({ ratio: 1 });
  });
});

test.describe('the Measured map on a phone held sideways (844×390)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  // The Seen toggle sat over the β number.
  test('the Seen label is clear of the instruments, the map and the tour card', async ({ page }) => {
    await openWorld(page, 'slow-light', '&on=measured');
    await expect(page.locator('.seen-tag')).toBeVisible();
    const seen = await box(page, '.seen-tag');
    for (const other of ['.hud', '.measured', '.tour', '.top-right', '.world-name']) expect(overlap(seen, await box(page, other)), `Seen over ${other}`).toBe(false);
    await expect(page.locator('.sym').first()).toBeInViewport({ ratio: 1 });
  });
});

test.describe('the tour card on a phone held sideways (844×390)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  // A tester could not see the quiz answers or their feedback: they sat behind the Cruise, Stop, Measured and Next row.
  test('a question, its answers and the feedback sit above the button row, never under it', async ({ page }) => {
    await openWorld(page, 'slow-light', '&stop=seen-and-measured');
    const body = await box(page, '.tour-body');
    const row = await box(page, '.tour-actions');
    expect(body.y + body.height, 'the card scrolls above its row').toBeLessThanOrEqual(row.y + 1);
    for (const choice of await page.locator('.choice').all()) expect(inside((await choice.boundingBox())!, body), 'every answer is on screen, in the card').toBe(true);
    await page.getByRole('button', { name: 'Just show me' }).tap();
    await expect(page.locator('.predict-reveal')).toBeFocused();
    expect(inside(await box(page, '.predict-reveal'), await box(page, '.tour-body')), 'the feedback is on screen, in the card').toBe(true);
    const at = await page.locator('.predict-reveal').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(at, 'nothing is drawn over the feedback').toBe(true);
  });

  // A long paragraph ran down behind the row at stops 10 and 12, with nothing to say there was more.
  for (const stop of ['stopping', 'the-real-universe']) {
    test(`stop "${stop}": the card scrolls to its last line, and says so while there is more below`, async ({ page }) => {
      await openWorld(page, 'slow-light', `&stop=${stop}`);
      const more = page.locator('.tour-more span');
      const body = page.locator('.tour-body');
      const scrolls = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 2);
      if (scrolls) {
        await expect(more, 'a cue that the card scrolls').toBeVisible();
        await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      }
      await expect(more).toBeHidden();
      const last = page.locator(stop === 'the-real-universe' ? '.tour-end' : '.tour-text');
      await expect(last).toBeVisible();
      expect(inside((await last.boundingBox())!, await box(page, '.tour-body')), 'the last line is on screen, in the card').toBe(true);
    });
  }

  test('on Big G, the note that the dials differ is whole on the card, and says the text is for this stop’s setting', async ({ page }) => {
    await openWorld(page, 'big-g');
    await expect(page.locator('.tour-turned')).toBeHidden();
    await page.locator('[data-dial="G"]').evaluate((el: HTMLInputElement) => {
      el.value = '900';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const note = page.locator('.tour-turned');
    await expect(note).toBeVisible();
    await expect(note).toContainText('this stop’s setting');
    expect(inside((await note.boundingBox())!, await box(page, '.tour-body')), 'the note is whole, in the card').toBe(true);
    await expect(page.locator('.tour-turned button')).toBeInViewport({ ratio: 1 });
  });

  test('on Big G at the top of the G dial, the line about the shadow has the view to itself', async ({ page }) => {
    await openWorld(page, 'big-g');
    await page.locator('[data-dial="G"]').evaluate((el: HTMLInputElement) => {
      el.value = '1000';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('.view-notice')).toBeVisible();
    const note = await box(page, '.view-notice');
    for (const other of ['.hud', '.tour', '.top-right', '.world-name']) expect(overlap(note, await box(page, other)), `the note over ${other}`).toBe(false);
    expect(inside(note, { x: 0, y: 0, width: 844, height: 390 })).toBe(true);
  });
});

test('a message from Real universe does not land on the Seen label', async ({ page }) => {
  await openWorld(page, 'slow-light', '&on=measured');
  await page.locator('.panel-toggle').click();
  await page.locator('[data-reset="real"]').click();
  await expect(page.locator('.toast.show')).toBeVisible();
  expect(overlap(await box(page, '.toast'), await box(page, '.seen-tag')), 'the toast covers the Seen label').toBe(false);
});

test('a visitor who steps through the tour is not left with the how-to-move hint over the view', async ({ page }) => {
  // Stepping through the tour dismisses the how-to-move hint, since tour-only visitors never walk.
  await openWorld(page, 'slow-light');
  await expect(page.locator('.move-hint')).toBeVisible();
  await page.keyboard.press('KeyN');
  await expect(page.locator('.move-hint')).toBeHidden();
  // It is not marked as learned: the next visit that has not walked sees it again.
  await openWorld(page, 'slow-light');
  await expect(page.locator('.move-hint')).toBeVisible();
});
