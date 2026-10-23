import { type Page, expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

// Walks the whole of each tour with the keyboard alone at 200% zoom (640x400), counting presses, in the three worlds.
test.use({ viewport: { width: 640, height: 400 } });
test.slow();

const focused = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement;
    return { next: !!e?.hasAttribute('data-tour-next'), choice: e?.classList.contains('choice') ?? false, reveal: e?.classList.contains('predict-reveal') ?? false, end: e?.classList.contains('tour-end') ?? false, inTour: !!e?.closest('.tour'), body: e === document.body };
  });

for (const world of ['slow-light', 'big-hbar', 'big-g']) {
  test(`${world}: Tab, Enter and Space alone reach every stop and the end of the tour, with no wasted presses`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`./?world=${world}&quality=low&e2e`);
    await page.waitForFunction(() => (window as any).slowlight?.frames > 2, null, { timeout: 90_000 });
    const stops = Number((await page.locator('.tour-no').textContent())!.split('/')[1]);
    let presses = 0;
    const press = async (key: string) => {
      presses++;
      await page.keyboard.press(key);
    };

    // Tab to Next, the way a visitor who has not read the hint's "N" has to.
    let tabs = 0;
    while (!(await focused(page)).next) {
      expect(tabs, 'Next is within reach of the keyboard').toBeLessThan(12);
      await press('Tab');
      tabs++;
    }

    let questions = 0;
    for (let stop = 1; stop <= stops; stop++) {
      await expect(page.locator('.tour-no')).toHaveText(`${stop} / ${stops}`);
      const choices = await page.locator('.predict:visible .choice').count();
      if (choices) {
        questions++;
        // Focus followed Next onto the first answer; answering puts it on the reveal; Tab goes on to Next.
        expect(await focused(page), `stop ${stop}: focus on the first answer`).toMatchObject({ choice: true });
        await press('Enter');
        await expect(page.locator('.predict-reveal')).toBeVisible();
        expect(await focused(page), `stop ${stop}: focus on the reveal`).toMatchObject({ reveal: true });
        if (stop < stops) {
          await press('Tab');
          expect(await focused(page), `stop ${stop}: Tab from the answer reaches Next`).toMatchObject({ next: true });
        }
      } else if (await page.locator('.predict:visible').count()) {
        // A measurement is optional: Next goes on without it, and keeps focus.
        expect(await focused(page), `stop ${stop}: Next keeps focus past a measurement`).toMatchObject({ next: true });
      } else if (stop < stops) {
        expect(await focused(page), `stop ${stop}: Next keeps focus`).toMatchObject({ next: true });
      }
      if (stop < stops) await press('Space');
    }

    // At the last stop the tour says it is over, and focus stays in the card rather than falling to the page.
    await expect(page.locator('.tour-end')).toBeVisible();
    await expect(page.locator('.tour-end')).toContainText('end of the tour');
    expect(await focused(page)).toMatchObject({ body: false, inTour: true });
    const budget = tabs + (stops - 1) + 2 * questions;
    expect(presses, `${world}: ${tabs} Tabs to Next, ${stops - 1} Next presses, 2 more at each of ${questions} questions`).toBeLessThanOrEqual(budget);
    expect(errors).toEqual([]);
  });

  test(`${world}: N and B walk the whole tour from the page, and Back is reachable from the last stop`, async ({ page }) => {
    await page.goto(`./?world=${world}&quality=low&e2e`);
    await page.waitForFunction(() => (window as any).slowlight?.frames > 2, null, { timeout: 90_000 });
    const stops = Number((await page.locator('.tour-no').textContent())!.split('/')[1]);
    for (let stop = 2; stop <= stops; stop++) {
      await page.keyboard.press('KeyN');
      await expect(page.locator('.tour-no')).toHaveText(`${stop} / ${stops}`);
    }
    // A last stop that asks a question says the tour is over once the answer is shown.
    if (await page.locator('.predict:visible').count()) {
      await expect(page.locator('.tour-end')).toBeHidden();
      await page.getByRole('button', { name: 'Just show me' }).focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('.tour-end')).toBeVisible();
    for (let stop = stops - 1; stop >= 1; stop--) {
      await page.keyboard.press('KeyB');
      await expect(page.locator('.tour-no')).toHaveText(`${stop} / ${stops}`);
    }
    await expect(page.locator('.tour-end')).toBeHidden();
  });
}

// A disabled button cannot hold focus. Wherever the tour disables the one a keyboard user is on, focus goes somewhere
// in the card instead of falling to the page, where Space and the arrows would act on the world.
const inCard = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.tour') && document.activeElement !== document.body);
const onKeys = async (page: Page, world: string) => {
  await page.goto(`./?world=${world}&quality=low&e2e`);
  await page.waitForFunction(() => (window as any).slowlight?.frames > 2, null, { timeout: 90_000 });
};

test('Back at stop 2, pressed from the keyboard, lands on stop 1 with focus still in the card, on Next', async ({ page }) => {
  await onKeys(page, 'slow-light');
  await page.getByRole('button', { name: 'Next tour stop' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.tour-no')).toHaveText(/^2 \//);
  await page.getByRole('button', { name: 'Previous tour stop' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tour-no')).toHaveText(/^1 \//);
  await expect(page.getByRole('button', { name: 'Previous tour stop' })).toBeDisabled();
  expect(await focused(page)).toMatchObject({ next: true });
  await page.keyboard.press('Space');
  await expect(page.locator('.tour-no')).toHaveText(/^2 \//);
});

test('a last stop with a measurement, reached with Next from the keyboard, puts focus on its first answer', async ({ page }) => {
  await onKeys(page, 'big-g');
  await page.evaluate(() => (window as any).slowlight.cutTour(5));
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-no')).toHaveText('4 / 5');
  await page.getByRole('button', { name: 'Next tour stop' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.tour-no')).toHaveText('5 / 5');
  await expect(page.locator('[data-ask]').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next tour stop' })).toBeDisabled();
  expect(await inCard(page), 'focus is in the card, not on the page').toBe(true);
  await expect(page.locator('[data-ask]').first()).toBeFocused();
});

test('a last stop with nothing to answer, reached with Next from the keyboard, puts focus on the closing line', async ({ page }) => {
  await onKeys(page, 'slow-light');
  await page.getByRole('button', { name: 'Next tour stop' }).focus();
  for (let i = 1; i < 12; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-no')).toHaveText('12 / 12');
  await page.getByRole('button', { name: 'Previous tour stop' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tour-no')).toHaveText('11 / 12');
  await page.getByRole('button', { name: 'Next tour stop' }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.tour-no')).toHaveText('12 / 12');
  expect(await focused(page)).toMatchObject({ end: true });
});
