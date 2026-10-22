import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import { openWorld } from './helpers';

/**
 * What axe finds against WCAG 2.0 to 2.2 (A and AA) and its best practices that fails a screen: anything serious
 * or critical, and content outside every landmark, which screen-reader users cannot jump to.
 */
async function problems(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical' || v.id === 'region').map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('the title screen passes axe', async ({ page }) => {
  await page.goto('./?e2e');
  await expect(page.locator('.plate')).toHaveCount(3);
  expect(await problems(page)).toEqual([]);
});

for (const world of ['slow-light', 'big-hbar', 'big-g']) {
  test(`${world} passes axe`, async ({ page }) => {
    await openWorld(page, world);
    expect(await problems(page)).toEqual([]);
  });
}

test('the Measured view, with its map in words, passes axe', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await page.locator('.topbar [data-view="measured"]').click();
  await expect(page.getByRole('region', { name: 'Measured view' }).getByRole('listitem').first()).toContainText(/\d:\d\d\.\d/);
  expect(await problems(page)).toEqual([]);
});

test('an answered prediction passes axe', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await page.keyboard.press('KeyN');
  await page.locator('.choice[data-choice="2"]').click();
  await expect(page.locator('.predict-reveal')).toBeVisible();
  expect(await problems(page)).toEqual([]);
});

test('answering a prediction from the keyboard leaves focus on the answer, not at the top of the page', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await page.keyboard.press('KeyN');
  await page.locator('.choice[data-choice="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.predict-reveal')).toBeFocused();
});

test('Next pressed from the keyboard onto a question puts focus on its first answer, and Dials opened from the keyboard puts it in the panel', async ({ page }) => {
  // A keyboard-only tester needed six Tabs from the top bar to reach each question's answers, and four more to
  // reach Real universe after opening Dials.
  await openWorld(page, 'slow-light', '&on=measured');
  await page.locator('[data-tour-next]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.choice[data-choice="0"]')).toBeFocused();
  await page.locator('.panel-toggle').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel [data-dial="c"]')).toBeFocused();
});

test('Esc closes the controls help, and the help button no longer says it is open', async ({ page }) => {
  await openWorld(page, 'slow-light');
  const button = page.getByRole('button', { name: 'Controls help' });
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.help')).toBeHidden();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('the proofs page passes axe once every proof has run', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./?proofs&e2e');
  await expect(page.locator('.proofs-summary')).toHaveText(/^(\d+) of \1 passed$/, { timeout: 150_000 });
  expect(await problems(page)).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a world with its dials open passes axe', async ({ page }) => {
    await openWorld(page, 'slow-light');
    await page.getByRole('button', { name: 'Dials' }).click();
    await expect(page.locator('#panel')).toBeVisible();
    expect(await problems(page)).toEqual([]);
  });
});

test('after a prediction, screen readers hear which answer was right and which pick was wrong', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await page.keyboard.press('KeyN');
  await page.getByRole('button', { name: 'about 5 s ahead', exact: true }).click();
  await expect(page.locator('.choices')).toMatchAriaSnapshot(`
    - button "the same time" [disabled]
    - button "about 5 s behind (right answer)" [disabled]
    - button "about 5 s ahead (your answer, wrong)" [disabled]
  `);
});
