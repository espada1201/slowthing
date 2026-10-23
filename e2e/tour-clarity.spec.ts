import { expect, test } from '@playwright/test';
import { goToStop, openWorld, watchErrors } from './helpers';

test('a question says that answering is optional, and Next goes on without it', async ({ page }) => {
  // Next turns red under the pointer, which at a question reads as a warning: the question says it is optional.
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await goToStop(page, 'The late clock');
  await expect(page.locator('.predict-opt')).toBeVisible();
  await expect(page.locator('.predict-opt')).toContainText('Optional');
  await expect(page.locator('.predict-opt')).toContainText('Next');
  await page.locator('[data-tour-next]').click();
  await expect(page.locator('.tour-title')).toHaveText('Aberration');
  await page.locator('.choice[data-choice="0"]').click();
  await expect(page.locator('.predict-opt')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the instruments gloss the shorthand: β and γ say what they are in words', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await expect(page.locator('.readouts dt', { hasText: 'β' })).toContainText('share of c');
  await expect(page.locator('.readouts dt', { hasText: 'γ' })).toContainText('clock slow-down');
  await expect(page.locator('.readouts dt', { hasText: 'τ' })).toContainText('watch');
});

test('the last tour stop says the tour is over, and going back removes the line', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await expect(page.locator('.tour-end')).toBeHidden();
  const stops = Number((await page.locator('.tour-no').textContent())!.split('/')[1]);
  for (let i = 1; i < stops; i++) await page.locator('[data-tour-next]').click();
  await expect(page.locator('.tour-end')).toBeVisible();
  await expect(page.locator('.tour-end')).toContainText('end of the tour');
  await page.locator('.tour [aria-label="Previous tour stop"]').click();
  await expect(page.locator('.tour-end')).toBeHidden();
});
