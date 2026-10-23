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
  // A keyboard-only tester ran out of time in the tour paying five Tabs (Cruise, Stop, Measured, Back) after each answer.
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-tour-next]')).toBeFocused();
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

test('the ? key opens and closes the controls help, as the how-to-move hint says', async ({ page }) => {
  // Two testers read "? lists every key" in the hint, pressed ?, and nothing happened.
  await openWorld(page, 'slow-light');
  await expect(page.locator('.move-hint')).toContainText('? lists every key');
  const button = page.getByRole('button', { name: 'Controls help' });
  await page.locator('#view').focus();
  await page.keyboard.press('Shift+Slash');
  await expect(page.locator('.help')).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Shift+Slash');
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
    await page.getByRole('button', { name: 'Dials', exact: true }).click();
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

for (const size of [{ width: 1280, height: 800 }, { width: 640, height: 400 }, { width: 390, height: 844 }]) {
  test(`Check the physics scrolls with the keyboard as soon as it opens, at ${size.width}×${size.height}`, async ({ page }) => {
    // A keyboard-only tester pressed PageDown, Space, ArrowDown and End on the proofs page and nothing moved until one Tab.
    await page.setViewportSize(size);
    await page.goto('./?e2e');
    await page.getByRole('button', { name: 'Check the physics →' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.proof').first()).toBeVisible();
    const top = () => page.locator('main.proofs-page').evaluate((el) => el.scrollTop);
    let was = await top();
    expect(was).toBe(0);
    for (const key of ['PageDown', 'Space', 'ArrowDown', 'End']) {
      await page.keyboard.press(key);
      await expect.poll(top, { message: `${key} scrolls the page` }).toBeGreaterThan(was);
      was = await top();
    }
  });
}

const BETA = "β (beta): your speed as a share of light's speed";
const GAMMA = "γ (gamma): how many times slower a moving clock runs";

for (const [name, size, touch] of [
  ['a desktop', { width: 1280, height: 800 }, false],
  ['a phone held sideways', { width: 844, height: 390 }, true],
  ['200% zoom', { width: 640, height: 400 }, false],
] as const) {
  test.describe(`β and γ on ${name}`, () => {
    test.use({ viewport: size, isMobile: touch, hasTouch: touch });

    // Three testers tried hover and tap on β and γ and nothing happened; on a short screen even the two-word glosses are hidden.
    test('each Greek label is a control whose name says what it means, and shows its definition on hover, focus or tap', async ({ page }) => {
      await openWorld(page, 'slow-light');
      const beta = page.getByRole('button', { name: BETA, exact: true });
      const gamma = page.getByRole('button', { name: GAMMA, exact: true });
      await expect(beta).toBeVisible();
      await expect(gamma).toBeVisible();
      await expect(beta).toHaveText('β');
      await expect(gamma).toHaveText('γ');
      const tip = page.locator('.sym-tip');
      await expect(tip).toBeHidden();
      // Focus.
      await beta.focus();
      await expect(tip).toHaveText(BETA);
      await gamma.focus();
      await expect(tip).toHaveText(GAMMA);
      // Instruments refresh ten times a second: the control keeps focus, and its tip stays.
      await page.waitForTimeout(500);
      await expect(gamma).toBeFocused();
      await expect(tip).toHaveText(GAMMA);
      await gamma.blur();
      await expect(tip).toBeHidden();
      if (touch) {
        await beta.tap();
        await expect(tip).toHaveText(BETA);
        await page.waitForTimeout(300);
        await expect(tip, 'a tap keeps the definition up').toHaveText(BETA);
        await page.touchscreen.tap(size.width - 20, 200);
        await expect(tip).toBeHidden();
      } else {
        await beta.hover();
        await expect(tip).toHaveText(BETA);
        await page.mouse.move(size.width - 20, 200);
        await expect(tip).toBeHidden();
      }
      // Wherever it is, the definition is on the screen.
      await beta.focus();
      const shown = await tip.boundingBox();
      expect(shown!.x).toBeGreaterThanOrEqual(0);
      expect(shown!.x + shown!.width).toBeLessThanOrEqual(size.width);
      expect(shown!.y + shown!.height).toBeLessThanOrEqual(size.height);
      // The control is a fair target.
      const target = (await beta.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(24);
      expect(target.height).toBeGreaterThanOrEqual(24);
    });
  });
}

test('the ? list defines β and γ, and Esc closes a definition before it closes the list', async ({ page }) => {
  await openWorld(page, 'slow-light');
  await page.getByRole('button', { name: 'Controls help' }).click();
  const help = page.getByRole('dialog', { name: 'Controls' });
  await expect(help).toContainText(BETA);
  await expect(help).toContainText(GAMMA);
  await page.getByRole('button', { name: BETA, exact: true }).focus();
  await expect(page.locator('.sym-tip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sym-tip')).toBeHidden();
  await expect(help).toBeVisible();
});

test('World II and III define no symbols they do not show', async ({ page }) => {
  await openWorld(page, 'big-g');
  await page.getByRole('button', { name: 'Controls help' }).click();
  await expect(page.getByRole('dialog', { name: 'Controls' })).not.toContainText('beta');
});

test('Esc leaves the world for the Worlds list only when nothing is open, and puts away one open thing at a time', async ({ page }) => {
  // A keyboard tester pressed Esc to get out of a world and nothing happened. (Big G has the ruler.)
  await openWorld(page, 'big-g');
  await page.getByRole('button', { name: 'Controls help' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.help')).toBeHidden();
  await expect(page.locator('.plate')).toHaveCount(0);
  await page.keyboard.press('KeyR');
  await expect(page.locator('.ruler')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ruler')).toBeHidden();
  await expect(page.locator('.plate')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.plate')).toHaveCount(3);
  expect(await page.evaluate(() => (window as any).slowlight.world)).toBeNull();
  await expect(page.locator('.plate').first()).toBeFocused();
});

test('Esc in an answer box stays in the box, and the ? list names it', async ({ page }) => {
  await openWorld(page, 'big-g');
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyN');
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Weigh the hole');
  await page.locator('[data-ask="rs"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-ask="rs"]')).toBeVisible();
  await page.getByRole('button', { name: 'Controls help' }).click();
  await expect(page.locator('.help')).toContainText('Esc closes what is open, and leaves the world when nothing is');
});

test.describe('at 200% zoom', () => {
  test.use({ viewport: { width: 640, height: 400 } });

  test('Shift+Tab from the first dial lands on the Dials button that opened the panel, not on ?', async ({ page }) => {
    // With Dials open the panel came after ? in the page, so Shift+Tab from the slider landed on ?.
    await openWorld(page, 'slow-light');
    await page.locator('.panel-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#panel [data-dial="c"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.panel-toggle')).toBeFocused();
    // And Tab from ? goes on to Dials.
    await page.getByRole('button', { name: 'Controls help' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.panel-toggle')).toBeFocused();
  });
});
