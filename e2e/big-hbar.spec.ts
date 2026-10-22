import { type Page, expect, test } from '@playwright/test';
import { expectRendered, openWorld, readout, watchErrors } from './helpers';

// The wave is stepped in fragment shaders, which software rendering in CI runs far below real time.
test.slow();

const status = (page: Page): Promise<string> => page.evaluate(() => (window as any).slowlight.status());

/** Wait until a readout's leading number passes `min`. */
async function untilAbove(page: Page, label: string, min: number) {
  await page.waitForFunction(([l, m]) => parseFloat((window as any).slowlight.readouts().find((r: any) => r.label === l)?.value) > m, [label, min] as const, { timeout: 150_000, polling: 500 });
}

test('at the real ħ the ball is a point; turned up, it rolls out as a wave', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-hbar');
  await expectRendered(page);
  expect(await readout(page, 'Wavelength λ')).toBe('4.14×10⁻³⁴ m');
  expect(await readout(page, 'Spread Δx')).toBe('0 (a point)');
  expect(await status(page)).toContain('Classical');
  // The first stop rolls a classical ball through the right-hand opening, so it lands straight behind it.
  await page.waitForFunction(() => (window as any).slowlight.status().includes('landed at x = 2.6 m'), null, { timeout: 150_000, polling: 500 });
  expect(await readout(page, 'Dots recorded')).toBe('1');

  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Turn ħ up');
  expect(await readout(page, 'Wavelength λ')).toBe('0.982 m');
  expect(await status(page)).toContain('Wave on a 256² grid');
  // Part of the wave gets through the two openings while the rest comes back.
  await untilAbove(page, 'Past the obstacle', 15);
  expect(parseFloat(await readout(page, 'Spread Δx'))).toBeGreaterThan(1.5);
  expect(errors).toEqual([]);
});

test('measuring the wave pins it down to one spot', async ({ page }) => {
  await openWorld(page, 'big-hbar');
  for (let i = 0; i < 4; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Looking collapses it');
  // The stop measures 1.2 s into the roll, when the packet is about 1.3 m across.
  const spread = await page
    .waitForFunction(() => {
      const s = (window as any).slowlight;
      return s.status().includes('Measured at') && parseFloat(s.readouts().find((r: any) => r.label === 'Spread Δx').value);
    }, null, { timeout: 150_000 })
    .then((h) => h.jsonValue());
  expect(spread).toBeLessThan(0.8);
});

test('rapid fire at the glass: once every outcome is arriving, about as many get through as theory says', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = watchErrors(page);
  await openWorld(page, 'big-hbar');
  for (let i = 0; i < 5; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Through glass');
  expect(await readout(page, 'Theory (plane wave)')).toBe('28%');
  const tally = (min: number) =>
    page
      .waitForFunction((m) => {
        const t = /^(\d+) of (\d+)/.exec((window as any).slowlight.readouts().find((r: any) => r.label === 'Glass: through').value);
        return t && Number(t[2]) >= m ? [Number(t[1]), Number(t[2])] : null;
      }, min, { timeout: 300_000, polling: 1000 })
      .then((h) => h.jsonValue() as Promise<number[]>);
  // The screen is nearer than the porch, so balls that get through are counted before the ones that bounce
  // back: the first tallies lean high. Judge the stream once both kinds are arriving.
  const [t1, n1] = await tally(120);
  const [t2, n2] = await tally(n1 + 200);
  const through = (t2 - t1) / (n2 - n1);
  expect(through).toBeGreaterThan(0.15);
  expect(through).toBeLessThan(0.42);
  expect(errors).toEqual([]);
});
