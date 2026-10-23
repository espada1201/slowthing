import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers';

// Auto quality is switched off under ?e2e (which compares pixels), so these runs leave the flag out: the governor
// that the visitor gets, wired to the real frame loop, judging real frame times.

test('Auto steps the resolution and then the preset down when every frame is slow, and never back up', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 640, height: 400 });
  // Frames at 8 per second whatever the machine: three times too slow at any resolution or preset.
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => void setTimeout(() => cb(performance.now()), 120)) as number;
  });
  await page.goto('./?world=big-hbar');
  await page.waitForFunction(() => (window as any).slowlight?.frames > 2, null, { timeout: 60_000 });
  const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const seen: { preset: string; width: number }[] = [];
  const look = () =>
    page.evaluate(() => ({
      preset: /Auto \((\w+)\)/.exec(document.querySelector('.top-right select option')!.textContent!)?.[1] ?? '',
      width: document.querySelector<HTMLCanvasElement>('#view')!.width,
    }));
  const first = await look();
  expect(first.preset).toBe('medium');
  // Until it reaches the cheapest preset at the lowest resolution, then a while longer to see that it stays there.
  let settledFor = 0;
  for (let i = 0; i < 160 && settledFor < 12; i++) {
    await page.waitForTimeout(500);
    const now = await look();
    seen.push(now);
    settledFor = now.preset === 'low' && seen.length > 1 && now.width === seen[seen.length - 2].width ? settledFor + 1 : 0;
  }
  expect(seen.at(-1)!.preset).toBe('low');
  expect(seen.at(-1)!.width, 'drawn at a fraction of the window').toBeLessThan(0.6 * 640 * 1.5);
  for (let i = 1; i < seen.length; i++) {
    expect(rank[seen[i].preset], `preset at sample ${i}`).toBeLessThanOrEqual(rank[seen[i - 1].preset]);
    if (seen[i].preset === seen[i - 1].preset) expect(seen[i].width, `width at sample ${i}`).toBeLessThanOrEqual(seen[i - 1].width);
  }
  expect(errors).toEqual([]);
});
