import { type Page, expect, test } from '@playwright/test';
import { frames, goToStop, meanDiff, openWorld, readout, sample, watchErrors } from './helpers';

/** The part of World I's Measured model these tests read (src/worlds/measured.ts), plus town time at you. */
interface Model {
  beta: number;
  motion: [number, number] | null;
  north: [number, number];
  trams: { length: number }[];
  lamps: { tau: number }[];
  clocks: { id: string; at: [number, number]; reads: number; seen: number }[];
  t: number;
}

const probe = (page: Page): Promise<Model> => page.evaluate(() => (window as any).slowlight.probe());
const clock = (m: Model, id: string) => m.clocks.find((c) => c.id === id)!;
/** street-1 stands 20 m north of street-0. */
const pair = (m: Model) => clock(m, 'street-1').reads - clock(m, 'street-0').reads;
const pause = (page: Page, on: boolean) => page.evaluate((p) => (window as any).slowlight.pause(p), on);
/** "08:05.4" or "10:08:05.4" in seconds past the hour. */
const seconds = (s: string) => s.split(':').slice(-2).reduce((acc, v) => acc * 60 + Number(v), 0);

test('the Measured button shows the map and the diagram, from the keyboard too, and folds the panel behind Dials', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  const button = page.locator('.topbar [data-view="measured"]');
  await expect(button).toHaveAccessibleName('Measured');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.measured')).toBeHidden();
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: /^Map of the town at your now/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Spacetime diagram along your motion/ })).toBeVisible();
  await expect(page.locator('.seen-tag')).toBeVisible();
  await expect(page.locator('#panel')).toBeHidden();
  await page.getByRole('button', { name: 'Dials', exact: true }).click();
  await expect(page.locator('#panel')).toBeVisible();
  await button.focus();
  await page.keyboard.press('Space');
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.measured')).toBeHidden();
  expect(errors).toEqual([]);
});

test('at rest, the map’s tower clock reads the town clock t while you see it 5.4 s behind, and a tram car is 3.22 m', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await goToStop(page, 'Seen and measured');
  // The map would give the answer away, so it waits for the prediction.
  await expect(page.locator('.measured')).toBeHidden();
  await page.getByRole('button', { name: 'Just show me' }).click();
  await expect(page.locator('.measured')).toBeVisible();
  await pause(page, true);
  await frames(page, 2);

  const tower = page.locator('.m-map [data-clock="tower"]');
  await expect(tower).toBeVisible();
  await expect(tower).toHaveText(await readout(page, 'Town clock t'));
  const m = await probe(page);
  expect(clock(m, 'tower').reads).toBeCloseTo(m.t, 9);
  // Its light crossed 64.8 m at 12 m/s.
  expect(clock(m, 'tower').reads - clock(m, 'tower').seen).toBeCloseTo(5.4, 2);
  const [now, seen] = await page.locator('.m-diagram [data-clock="tower"]').allTextContents();
  expect(Math.abs(seconds(now) - seconds(seen) - 5.4)).toBeLessThanOrEqual(0.1 + 1e-9);

  expect(m.trams.length).toBeGreaterThan(0);
  for (const car of m.trams) expect(car.length).toBeCloseTo(7.2 / Math.sqrt(5), 6);
  await expect(page.locator('.m-car')).toHaveText('3.22 m');
  expect(errors).toEqual([]);
});

test('screen readers can read every clock reading the map and the diagram show, and where the trams and lamps are, rewritten at most once a second', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await page.locator('.topbar [data-view="measured"]').click();
  const region = page.getByRole('region', { name: 'Measured view' });
  await expect(region).toBeVisible();
  /**
   * The Measured view's ARIA snapshot as a screen reader reaches it. The snapshot lists the text drawn inside an image,
   * but an image's children are presentational, so screen readers skip them: leave out each image and what it holds.
   */
  const reached = async () => {
    let image = -1;
    return (await region.ariaSnapshot())
      .split('\n')
      .filter((line) => {
        const indent = line.search(/\S/);
        if (image >= 0 && indent > image) return false;
        image = /^\s*- '?img\b/.test(line) ? indent : -1;
        return image < 0;
      })
      .join('\n');
  };
  /** With time held, wait until what a screen reader reaches in the Measured view holds every clock reading drawn there. */
  const heard = async () => {
    await pause(page, true);
    let words = '';
    await expect(async () => {
      words = await reached();
      const drawn = await page.locator('.measured [data-clock]').evaluateAll((els) => els.filter((e) => e.getAttribute('display') === 'inline').map((e) => e.textContent ?? ''));
      expect(drawn.length).toBeGreaterThan(1);
      for (const reading of drawn) expect(words).toContain(reading);
    }).toPass({ timeout: 20_000 });
    return words;
  };
  const before = await heard();
  expect(before).toMatch(/tram car.* \d+ m (ahead|behind|left|right)/i);
  expect(before).toMatch(/lamp.* \d+ m (ahead|behind|left|right)/i);
  const tower = await page.locator('.m-map [data-clock="tower"]').textContent();

  // Read, not announced: nothing in the view is a live region, and the words change at most once a second.
  const live = '[aria-live]:not([aria-live="off"]), [role="status"], [role="log"], [role="alert"], [role="timer"], [role="marquee"]';
  expect(await page.locator('.measured').evaluate((el, live) => !!el.closest(live) || !!el.querySelector(live), live)).toBe(false);
  const { t } = await probe(page);
  await pause(page, false);
  const { rewrites, seconds, drawn } = await page.locator('.measured').evaluate(
    (el) =>
      new Promise<{ rewrites: number; seconds: number; drawn: number }>((resolve) => {
        const [start, frames] = [performance.now(), (window as any).slowlight.frames];
        let rewrites = 0;
        // A rewrite of the words arrives as one batch of changes; the drawings' own changes are left out.
        const watch = new MutationObserver((changes) => {
          if (changes.some((c) => !(c.target instanceof SVGElement) && !c.target.parentElement?.closest('svg'))) rewrites++;
        });
        watch.observe(el, { subtree: true, childList: true, characterData: true });
        setTimeout(() => {
          watch.disconnect();
          resolve({ rewrites, seconds: (performance.now() - start) / 1000, drawn: (window as any).slowlight.frames - frames });
        }, 6000);
      }),
  );
  console.log(`words rewritten ${rewrites} times in ${seconds.toFixed(1)} s, over ${drawn} frames`);
  expect(rewrites).toBeLessThanOrEqual(Math.floor(seconds) + 1);

  // A second on, the words hold the new readings.
  await page.waitForFunction((t0) => (window as any).slowlight.probe().t > t0 + 1, t, { timeout: 90_000 });
  const after = await heard();
  expect(await page.locator('.m-map [data-clock="tower"]').textContent()).not.toBe(tower);
  expect(after).not.toBe(before);
  expect(errors).toEqual([]);
});

test('at the carousel, the map shows all eight lamps flashing together every 0.885 s, and the view is unchanged', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await goToStop(page, 'Moving clocks');
  await expect(page.locator('.measured')).toBeVisible();
  const a = await probe(page);
  await page.waitForFunction((t) => (window as any).slowlight.probe().t > t + 1, a.t, { timeout: 90_000 });
  const b = await probe(page);
  for (const m of [a, b]) {
    expect(m.lamps).toHaveLength(8);
    const taus = m.lamps.map((l) => l.tau);
    expect(Math.max(...taus) - Math.min(...taus)).toBeLessThan(1e-9);
  }
  // 0.6 s of a lamp's own time per flash, at γ = 1.474.
  const period = (0.6 * (b.t - a.t)) / (b.lamps[0].tau - a.lamps[0].tau);
  expect(period).toBeCloseTo(0.6 * Math.sqrt(1 + (13 / 12) ** 2), 9);
  expect(period).toBeCloseTo(0.885, 3);

  await pause(page, true);
  await frames(page, 2);
  const radii = await page.locator('.m-lamp').evaluateAll((els) => els.map((e) => e.getAttribute('r')));
  expect(radii).toHaveLength(8);
  expect(new Set(radii).size).toBe(1);
  // Seen keeps light delay's bunching: the view is drawn the same with the map on or off.
  const withMap = await sample(page);
  await page.locator('.topbar [data-view="measured"]').click();
  await expect(page.locator('.measured')).toBeHidden();
  await frames(page, 2);
  expect(meanDiff(withMap, await sample(page))).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('cruising at 0.9 c, each clock 20 m further ahead reads 1.5 s later, turning round flips it, and stopping makes them jump', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');

  // Turn round on the avenue to face south (turning right, so any drift is away from the street clocks' posts).
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => (window as any).slowlight.probe().north[1] < -0.995, null, { timeout: 120_000 });
  await page.keyboard.up('ArrowRight');
  // Set off from rest and read one frame of the spin-up: clocks far enough behind you run backwards in your now.
  await pause(page, true);
  await page.keyboard.press('KeyF');
  const p0 = await probe(page);
  const p1: Model = await page.evaluate(
    () =>
      new Promise((resolve) => {
        (window as any).slowlight.pause(false);
        requestAnimationFrame(() => resolve((window as any).slowlight.probe()));
      }),
  );
  const dt = p1.t - p0.t;
  expect(dt).toBeGreaterThan(0);
  for (const ck of p0.clocks) {
    const behind = -ck.at[1];
    const change = clock(p1, ck.id).reads - ck.reads;
    if (behind > 3) expect(change, `${ck.id}, ${behind.toFixed(1)} m behind`).toBeLessThan(0);
    if (behind < 0) expect(change, `${ck.id}, ${(-behind).toFixed(1)} m ahead`).toBeGreaterThan(dt);
  }
  // Clocks run backwards beyond c·Δt/Δβ: c²/a = 2.3 m as the cruise starts, a little more over a whole frame.
  const horizon = (12 * dt) / p1.beta;
  console.log(`spin-up: frame of ${dt.toFixed(3)} s, beta ${p1.beta.toFixed(3)}, clocks run backwards beyond ${horizon.toFixed(2)} m`);
  expect(horizon).toBeGreaterThan(2.3);
  expect(horizon).toBeLessThan(2.7);

  await page.waitForFunction(() => (window as any).slowlight.probe().beta > 0.8995, null, { timeout: 180_000 });
  const south = await probe(page);
  const along = south.north[0] * south.motion![0] + south.north[1] * south.motion![1];
  expect(along).toBeLessThan(-0.99);
  expect(pair(south)).toBeCloseTo((south.beta * 20 * along) / 12, 6);
  expect(pair(south)).toBeLessThan(-1.49);

  // The tour's coast north starts at full speed: steady from the first frame.
  await goToStop(page, 'Whose now?');
  const north = await probe(page);
  expect(north.beta).toBeCloseTo(0.9, 9);
  expect(pair(north)).toBeCloseTo(1.5, 9);
  await page.getByRole('button', { name: 'Just show me' }).click();
  await expect(page.locator('.measured')).toBeVisible();

  // Stopping changes your now, not the clocks: each one jumps by 0.9 × its distance ahead ÷ c.
  await pause(page, true);
  const before = await probe(page);
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Stopping');
  const after = await probe(page);
  expect(after.beta).toBe(0);
  expect(after.t).toBe(before.t);
  for (const ck of after.clocks) expect(ck.reads - clock(before, ck.id).reads, ck.id).toBeCloseTo((-0.9 * ck.at[1]) / 12, 6);
  const far = after.clocks.reduce((p, q) => (Math.abs(q.at[1] - 100) < Math.abs(p.at[1] - 100) ? q : p));
  console.log(`stopping: ${far.id}, ${far.at[1].toFixed(1)} m ahead, jumped ${(far.reads - clock(before, far.id).reads).toFixed(2)} s`);
  expect(errors).toEqual([]);
});

test('opening Dials over the Measured map takes the map out of the way instead of stacking over its edge', async ({ page }) => {
  // The panel is 12 px narrower than the map, so the map must not show beside or behind it.
  await openWorld(page, 'slow-light', '&on=measured');
  await expect(page.locator('.measured')).toBeVisible();
  // With the map up the dials fold behind this button, which must look like one that opens something.
  await expect(page.locator('.panel-toggle .chev')).toHaveText('▾');
  await expect(page.getByRole('button', { name: 'Dials', exact: true })).toBeVisible();
  await page.locator('.panel-toggle').click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.measured')).toBeHidden();
  await expect(page.locator('.panel-toggle .chev')).toHaveText('▴');
  await page.locator('.panel-toggle').click();
  await expect(page.locator('.measured')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the Measured button on the tour card puts the map above the view, clear of the tour', async ({ page }) => {
    const errors = watchErrors(page);
    await openWorld(page, 'slow-light');
    await expect(page.locator('.topbar [data-view="measured"]')).toBeHidden();
    await page.locator('.quick [data-view="measured"]').tap();
    await expect(page.locator('.measured')).toBeVisible();
    await expect(page.locator('.quick [data-view="measured"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const map = (await page.locator('.measured').boundingBox())!;
    for (const below of ['.tour', '.hud']) expect(map.y + map.height, `the map should end above ${below}`).toBeLessThanOrEqual((await page.locator(below).boundingBox())!.y);
    expect(errors).toEqual([]);
  });

  test('at a question with its answer shown, the map, instruments and card leave a band of the view clear', async ({ page }) => {
    // A band of the view stays clear between the instruments and the card.
    await openWorld(page, 'slow-light', '&stop=seen-and-measured');
    await page.getByRole('button', { name: 'Just show me' }).tap();
    await expect(page.locator('.predict-reveal')).toBeVisible();
    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    const [map, hud, card] = [await box('.measured'), await box('.hud'), await box('.tour')];
    expect(map.y + map.height).toBeLessThanOrEqual(hud.y);
    expect(card.y - (hud.y + hud.height), 'clear view between the instruments and the card').toBeGreaterThanOrEqual(90);
    // Next is still on screen, above whatever else is there.
    await expect(page.locator('[data-tour-next]')).toBeInViewport({ ratio: 1 });
    expect(card.y + card.height).toBeLessThanOrEqual(844);
  });
});

test.describe('at 200% browser zoom', () => {
  // A 1280×800 screen at 200%: the page has 640×400 CSS pixels. A keyboard-only tester at this zoom lost the tour
  // card, its stop number and Next under the map at every stop that opens Measured.
  test.use({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 });

  test('the map shrinks to sit above the tour card, and the card and Next stay on top', async ({ page }) => {
    await openWorld(page, 'slow-light', '&on=measured');
    await expect(page.locator('.measured')).toBeVisible();
    const map = (await page.locator('.measured').boundingBox())!;
    expect(map.y + map.height, 'the map should end above the tour card').toBeLessThanOrEqual((await page.locator('.tour').boundingBox())!.y);
    for (const sel of ['[data-tour-next]', '.tour-no']) {
      const onTop = await page.locator(sel).evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && (el === hit || el.contains(hit));
      });
      expect(onTop, `${sel} should be visible, not covered`).toBe(true);
    }
  });

  test('the Dials panel opens tall enough to show the effect switches', async ({ page }) => {
    // At 52% of a 400 px window the keyboard-only tester saw only the c slider, and had to Tab blind to the switches.
    await openWorld(page, 'slow-light');
    await page.getByRole('button', { name: 'Dials', exact: true }).click();
    await expect(page.locator('.switch:has([data-toggle="aberration"])')).toBeInViewport({ ratio: 1 });
  });
});
