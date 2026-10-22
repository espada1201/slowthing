import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

/** Sentence ends: a full stop, question or exclamation mark before the end or before a word that isn't lower case. */
const sentences = (text: string) => (text.trim().match(/[.!?](?=\s+[^a-z\s]|\s*$)/g) ?? []).length;

for (const world of ['slow-light', 'big-hbar', 'big-g']) {
  test(`${world}: every tour stop, and every answer it reveals, is one or two sentences`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`./?world=${world}&quality=low&e2e`);
    await page.waitForFunction(() => (window as any).slowlight?.frames > 0, null, { timeout: 60_000 });
    const stops = Number((await page.locator('.tour-no').textContent())!.split('/')[1]);
    for (let i = 1; i <= stops; i++) {
      await expect(page.locator('.tour-no')).toHaveText(`${i} / ${stops}`);
      const title = await page.locator('.tour-title').textContent();
      const text = (await page.locator('.tour-text').textContent()) ?? '';
      expect(sentences(text), `"${title}": ${text}`).toBeGreaterThanOrEqual(1);
      expect(sentences(text), `"${title}": ${text}`).toBeLessThanOrEqual(2);
      // Following the tour never counts as turning the dials yourself.
      await expect(page.locator('.tour-turned'), `"${title}"`).toBeHidden();
      if (await page.locator('.predict').isVisible()) {
        await page.getByRole('button', { name: 'Just show me' }).click();
        const reveal = (await page.locator('.predict-reveal').textContent()) ?? '';
        expect(sentences(reveal), `"${title}" reveal: ${reveal}`).toBeGreaterThanOrEqual(1);
        expect(sentences(reveal), `"${title}" reveal: ${reveal}`).toBeLessThanOrEqual(2);
      }
      await page.keyboard.press('KeyN');
    }
    expect(errors).toEqual([]);
  });
}
