import { type Page, expect, test } from '@playwright/test';
import { expectRendered, frames, openWorld, readout, watchErrors } from './helpers';

// The wave is stepped in fragment shaders, which software rendering in CI runs far below real time.
test.slow();

const status = (page: Page): Promise<string> => page.evaluate(() => (window as any).slowlight.status());

/** Wait until a readout's leading number passes `min`. */
async function untilAbove(page: Page, label: string, min: number) {
  await page.waitForFunction(([l, m]) => parseFloat((window as any).slowlight.readouts().find((r: any) => r.label === l)?.value) > m, [label, min] as const, { timeout: 150_000, polling: 500 });
}

/** Share of the view in the wave's vermilion: red well above blue, which the pale stone never is. */
const waveShare = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 40;
    const g = c.getContext('2d')!;
    g.drawImage(document.querySelector<HTMLCanvasElement>('#view')!, 0, 0, 64, 40);
    const d = g.getImageData(0, 0, 64, 40).data;
    let warm = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] - d[i + 2] > 80) warm++;
    return warm / (64 * 40);
  });

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

test('Show wave draws |ψ|² across the floor, and hiding it leaves bare stone', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-hbar');
  for (let i = 0; i < 6; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('A ball as wide as a room');
  // The crests sweep across the floor as the wave rolls, so a frame difference mostly measures that motion:
  // count the wave's own colour instead.
  await frames(page, 3);
  const shown = await waveShare(page);
  expect(shown).toBeGreaterThan(0.006);
  await page.locator('[data-toggle="wave"]').uncheck({ force: true });
  await frames(page, 2);
  // What stays warm is the thin ring marking the ball's spread: a few pixels at this size, not the wave's glow.
  expect(await waveShare(page)).toBeLessThan(shown / 3);
  await page.locator('[data-toggle="wave"]').check({ force: true });
  await frames(page, 2);
  expect(await waveShare(page)).toBeGreaterThan(0.006);
  expect(errors).toEqual([]);
});

test('rapid fire repeats a roll, and the detector walls decide which landings are recorded', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-hbar');
  // Stand past the openings with rapid fire on, go back to the real ħ, and roll a classical ball at the back wall:
  // every repeat of that roll lands where the first did.
  for (let i = 0; i < 3; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Two openings');
  await page.locator('[data-reset="real"]').click();
  await page.keyboard.press('KeyF');
  await untilAbove(page, 'Dots recorded', 30);
  expect(await status(page)).toContain('Rapid fire');
  // With the walls off the repeats keep landing but leave no dots; back on, recording resumes at once.
  await page.locator('[data-toggle="detector"]').uncheck({ force: true });
  const recorded = Number(await readout(page, 'Dots recorded'));
  await frames(page, 10);
  expect(Number(await readout(page, 'Dots recorded'))).toBe(recorded);
  await page.locator('[data-toggle="detector"]').check({ force: true });
  await frames(page, 10);
  expect(Number(await readout(page, 'Dots recorded'))).toBeGreaterThan(recorded);
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
