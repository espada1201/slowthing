import { type Page, expect, test } from '@playwright/test';
import { openWorld } from './helpers';

const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!;
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
