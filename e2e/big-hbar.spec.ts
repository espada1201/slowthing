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

/** Full-resolution count of pixels in the floor detector's cold cyan: green and blue well above red. */
const detectorGlow = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const src = document.querySelector<HTMLCanvasElement>('#view')!;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] - d[i] > 70 && d[i + 2] - d[i] > 50) n++;
    return n;
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
  for (let i = 0; i < 7; i++) await page.keyboard.press('KeyN');
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

test('measuring fires a floor detector, which flashes and leaves a lump no wider than its resolution', async ({ page }) => {
  await openWorld(page, 'big-hbar');
  for (let i = 0; i < 4; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('A detector pins it down');
  const resolution = parseFloat(/([\d.]+) m resolution/.exec((await page.locator('.tour-text').textContent()) ?? '')![1]);
  // The stop measures 1.2 s into the roll, when the packet is about 1.3 m across. Frozen as the detector fires, the
  // flash and the spread belong to the same moment.
  await page.waitForFunction(() => (window as any).slowlight.status().includes('Detector fired at'), null, { timeout: 150_000, polling: 50 });
  await page.evaluate(() => (window as any).slowlight.pause(true));
  const spread = parseFloat(await readout(page, 'Spread Δx'));
  expect(spread).toBeGreaterThan(0.3);
  expect(spread).toBeLessThanOrEqual(resolution);
  await frames(page, 2);
  const flash = await detectorGlow(page);
  expect(flash).toBeGreaterThan(100);
  // The flash fades over 1.5 s of game time, which passes no faster than the clock and by at most 0.05 s a frame;
  // nothing else in the courtyard is that colour.
  await page.evaluate(() => (window as any).slowlight.pause(false));
  await page.waitForTimeout(1600);
  await frames(page, 31);
  expect(await detectorGlow(page)).toBeLessThan(flash / 10);
});

test('rapid fire at the glass: once every outcome is arriving, about as many get through as theory says, no slower', async ({ page }) => {
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
  // Faster parts of the packet tunnel more easily, so what gets through is a touch faster than the ball, never slower.
  const rolled = parseFloat((await readout(page, 'Ball')).split(' at ')[1]);
  const speedThrough = parseFloat(await readout(page, 'Glass: speed through'));
  expect(speedThrough).toBeGreaterThan(rolled);
  expect(speedThrough).toBeLessThan(rolled + 0.05);
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Fainter, not slower');
  await page.locator('.choice[data-choice="1"]').click();
  const said = parseFloat(/averages ([\d.]+) m\/s/.exec((await page.locator('.predict-reveal').textContent()) ?? '')![1]);
  expect(Math.abs(speedThrough - said)).toBeLessThanOrEqual(0.01);
  expect(errors).toEqual([]);
});

test('a GPU context lost and restored mid-roll starts the roll over, and the wave is read back again', async ({ page }) => {
  const errors = watchErrors(page);
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' && m.text().includes('WebGL')) warnings.push(m.text());
  });
  await openWorld(page, 'big-hbar');
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Turn ħ up');
  // Mid-roll, once the wave has been read back at least once.
  await untilAbove(page, 'Spread Δx', 1.2);
  const z = async () => parseFloat((await readout(page, 'Where (mean)')).split(', ')[1]);
  const lostAt = await z();
  // Lose the context and get it back, as a GPU reset does, each time waiting for the canvas to say so.
  const context = (event: string, call: string) =>
    page.evaluate(
      ([e, c]) =>
        new Promise((done) => {
          const view = document.querySelector<HTMLCanvasElement>('#view')!;
          const w = window as any;
          // A lost context hands out no extensions, so keep the one fetched before.
          w.loseGl ??= view.getContext('webgl2')!.getExtension('WEBGL_lose_context');
          view.addEventListener(e, done, { once: true });
          w.loseGl[c]();
        }),
      [event, call],
    );
  await context('webglcontextlost', 'loseContext');
  await frames(page, 5);
  await context('webglcontextrestored', 'restoreContext');
  await frames(page, 3);
  // The wave lived in textures that went with the old context: the roll starts over from the launch mark,
  expect(await z()).toBeGreaterThan(lostAt + 1);
  // and is read back as it rolls, until part of it is through the openings.
  await untilAbove(page, 'Past the obstacle', 15);
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});

test('leaving the courtyard frees the GPU objects it made, visit after visit', async ({ page }) => {
  // Count live WebGL objects of each kind by wrapping the context's create and delete calls.
  await page.addInitScript(() => {
    const live: Record<string, number> = ((window as any).liveGl = {});
    const gl = WebGL2RenderingContext.prototype as any;
    for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'Renderbuffer', 'Program', 'Shader', 'VertexArray']) {
      live[kind] = 0;
      const create = gl[`create${kind}`], remove = gl[`delete${kind}`];
      gl[`create${kind}`] = function (this: unknown, ...args: unknown[]) {
        const o = create.apply(this, args);
        if (o) live[kind]++;
        return o;
      };
      gl[`delete${kind}`] = function (this: unknown, o: unknown) {
        if (o) live[kind]--;
        return remove.call(this, o);
      };
    }
  });
  const errors = watchErrors(page);
  await page.goto('./?quality=low&e2e');
  const live: Record<string, number>[] = [];
  for (let visit = 0; visit < 3; visit++) {
    await page.locator('.plate[data-world="big-hbar"]').click();
    await expect(page.locator('.tour-title')).toHaveText('A real ball');
    // Roll a wave and wait for a read-back, so the visit makes everything a roll needs.
    await page.keyboard.press('KeyN');
    await untilAbove(page, 'Spread Δx', 1.2);
    await page.getByRole('button', { name: '← Worlds' }).click();
    await expect(page.locator('.plate')).toHaveCount(3);
    live.push(await page.evaluate(() => ({ ...(window as any).liveGl })));
  }
  // The first visit leaves what three.js keeps for any later scene, such as compiled programs; no visit adds to it.
  expect(live[1]).toEqual(live[0]);
  expect(live[2]).toEqual(live[0]);
  expect(errors).toEqual([]);
});
