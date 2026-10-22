import { type Page, expect, test } from '@playwright/test';
import { expectRendered, frames, meanDiff, openWorld, readout, sample, switchDiff, watchErrors } from './helpers';

// Every pixel marches a light ray, which software rendering in CI draws at well under one frame a second.
test.slow();

/** Drag the G slider to a position (0 = the real G, 1000 = its maximum) and let the picture catch up. */
async function setG(page: Page, step: number) {
  await page.locator('[data-dial="G"]').evaluate((el: HTMLInputElement, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, step);
  await frames(page, 2);
}

test('the G dial turns the black hole back into a rock, or makes it bigger', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-g');
  const hole = await expectRendered(page);
  expect(await readout(page, 'Schwarzschild radius')).toBe('4.5 m');

  await setG(page, 0);
  expect(await readout(page, 'Schwarzschild radius')).toContain('10⁻²²');
  expect(await page.evaluate(() => (window as any).slowlight.status())).toContain('nothing visibly bends');
  expect(meanDiff(hole, await sample(page)), 'the real G should show the rock, not the hole').toBeGreaterThan(4);

  // The world preset sits at step 960; 15 steps more is a little over twice the G.
  await setG(page, 975);
  expect(parseFloat(await readout(page, 'Schwarzschild radius'))).toBeGreaterThan(9);
  expect(meanDiff(hole, await sample(page)), 'a bigger G should show a bigger shadow').toBeGreaterThan(4);
  expect(errors).toEqual([]);
});

test('light bending, the gravitational shift and the shadow guide each change the picture', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-g');
  for (const id of ['lensing', 'redshift']) expect((await switchDiff(page, id)).mean, `${id} should change the image`).toBeGreaterThan(4);
  // The guide is a thin dashed circle at the shadow's edge.
  expect((await switchDiff(page, 'guide')).changed).toBeGreaterThan(150);
  expect(errors).toEqual([]);
});

test('the readouts follow you toward the hole', async ({ page }) => {
  await openWorld(page, 'big-g');
  const start = parseFloat(await readout(page, 'Your distance r'));
  await page.locator('#view').focus();
  await page.keyboard.press('KeyF');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForFunction((r0) => parseFloat((window as any).slowlight.readouts()[1].value) < r0 - 10, start, { timeout: 60_000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  expect(parseFloat(await readout(page, 'Your clock rate'))).toBeLessThan(0.9397);

  // The last tour stop hovers at 1.2 rs.
  for (let i = 0; i < 8; i++) await page.keyboard.press('KeyN');
  await frames(page, 2);
  expect(parseFloat(await readout(page, 'Your clock rate'))).toBeCloseTo(0.414, 2);
  expect(await readout(page, 'Shadow')).toBe('73% of sky');
});

/**
 * The angle between the sky directions drawn at two page points, worked out without the app's code: World III draws
 * a pinhole view 75° tall (at least 60° wide on a portrait screen), stretched over the canvas's drawing buffer.
 */
function pinholeAngle(page: Page, a: number[], b: number[]) {
  return page.evaluate(([a, b]) => {
    const view = document.querySelector<HTMLCanvasElement>('#view')!;
    const box = view.getBoundingClientRect();
    const aspect = view.width / view.height;
    const tanX = Math.max(Math.tan((37.5 * Math.PI) / 180) * aspect, Math.tan(Math.PI / 6));
    const tanY = tanX / aspect;
    const ray = ([x, y]: number[]) => [((2 * (x - box.left)) / box.width - 1) * tanX, (1 - (2 * (y - box.top)) / box.height) * tanY, -1];
    const [u, v] = [ray(a), ray(b)];
    return (Math.acos((u[0] * v[0] + u[1] * v[1] + 1) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
  }, [a, b]);
}

const rulerReading = async (page: Page) => parseFloat((await page.locator('.ruler-angle').textContent()) ?? '');

/** The ruler must be right to 0.1°. Its maths is exact, so this allows only for its rounding to 0.01°. */
async function expectReading(page: Page, a: number[], b: number[]) {
  await expect(page.locator('.ruler-angle')).toBeVisible();
  expect(Math.abs((await rulerReading(page)) - (await pinholeAngle(page, a, b)))).toBeLessThan(0.01);
}

test('the sky ruler reads the angle between two clicked points, and works from the keyboard', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-g');
  await page.evaluate(() => (window as any).slowlight.pause(true));
  const button = page.locator('.panel [data-ruler]');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const a = [430, 420], b = [860, 260];
  await page.mouse.click(a[0], a[1]);
  await page.mouse.click(b[0], b[1]);
  await expectReading(page, a, b);
  // A click marks the sky; it does not take the mouse for looking around.
  expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();

  // Pick the second mark up from beside it: it keeps its offset from the pointer, so the pointer never hides it.
  await page.mouse.move(b[0] + 10, b[1] + 6);
  await page.mouse.down();
  await page.mouse.move(b[0] - 90, b[1] + 66, { steps: 5 });
  await page.mouse.up();
  await expectReading(page, a, [b[0] - 100, b[1] + 60]);

  // The marks hold on to the sky: turning the view carries them across the screen and keeps the angle between them.
  const mark = page.locator('.ruler-mark').first();
  const [where, reading] = [await mark.getAttribute('transform'), await rulerReading(page)];
  await page.locator('.hud').click();
  await page.evaluate(() => (window as any).slowlight.pause(false));
  await page.keyboard.down('ArrowLeft');
  await frames(page, 3);
  await page.keyboard.up('ArrowLeft');
  await page.evaluate(() => (window as any).slowlight.pause(true));
  await frames(page, 1);
  expect(await mark.getAttribute('transform')).not.toBe(where);
  expect(await rulerReading(page)).toBe(reading);

  // By keyboard: R switches it, the arrows move a cross out from the middle of the view (10 px with Shift), Enter marks.
  await page.keyboard.press('KeyR');
  await expect(page.locator('.ruler')).toBeHidden();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 12; i++) await page.keyboard.press('Shift+ArrowRight');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expectReading(page, [640, 400], [760, 395]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ruler')).toBeHidden();
  expect(errors).toEqual([]);
});

/**
 * The shadow's extent on the page, and points on its left and right edges on the row through its middle, found the way
 * a careful eye would: the shadow is the only pure black in the view (the sky round it is not quite black).
 */
function shadowEdges(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector<HTMLCanvasElement>('#view')!;
    const c = document.createElement('canvas');
    [c.width, c.height] = [view.width, view.height];
    const g = c.getContext('2d')!;
    g.drawImage(view, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const black = (i: number, j: number) => d[4 * (j * c.width + i)] + d[4 * (j * c.width + i) + 1] + d[4 * (j * c.width + i) + 2] === 0;
    let [x0, x1, y0, y1] = [c.width, 0, c.height, 0];
    for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) if (black(i, j)) [x0, x1, y0, y1] = [Math.min(x0, i), Math.max(x1, i), Math.min(y0, j), Math.max(y1, j)];
    const row = Math.round((y0 + y1) / 2);
    let [a, b] = [Math.round((x0 + x1) / 2), Math.round((x0 + x1) / 2)];
    while (black(a - 1, row)) a--;
    while (black(b + 1, row)) b++;
    const box = view.getBoundingClientRect();
    const [sx, sy] = [box.width / c.width, box.height / c.height];
    return { y: Math.round(box.top + (row + 0.5) * sy), left: Math.round(box.left + a * sx), right: Math.round(box.left + (b + 1) * sx), top: box.top + y0 * sy, bottom: box.top + (y1 + 1) * sy };
  });
}

/** rs and M from a ruler reading across the shadow, by the stop's steps: sin α = (3√3/2)(rs/r)√(1 − rs/r), M = rs c²/(2G). */
async function weigh(page: Page) {
  const alpha = ((await rulerReading(page)) / 2) * (Math.PI / 180);
  const r = parseFloat(await readout(page, 'Your distance r'));
  // Without the square root, then with that rs put into it; c and G as the steps give them.
  const first = (r * Math.sin(alpha)) / ((3 * Math.sqrt(3)) / 2);
  const rs = first / Math.sqrt(1 - first / r);
  return { rs, M: (rs * 3e8 ** 2) / (2 * 2e12) };
}

/** How far off the reveal says each typed answer was, in per cent. */
const offs = async (page: Page) => [...(await page.locator('.predict-reveal').innerText()).matchAll(/([\d.]+)% (?:low|high)/g)].map((m) => parseFloat(m[1]));

test('weighing the hole: its shadow, measured with the ruler, gives rs and M to 2%, and the answer waits for yours', async ({ page }) => {
  const errors = watchErrors(page);
  await openWorld(page, 'big-g');
  for (let i = 0; i < 4; i++) await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Weigh the hole');
  // Until you answer, the instruments show only your distance: rs, the clock rate and the rest would give it away.
  await expect(page.locator('.readouts dt')).toHaveText(['Your distance r']);
  await expect(page.locator('.status')).toBeHidden();
  await expect(page.locator('.tour-text')).toBeHidden();
  await frames(page, 2);

  const { y, left, right } = await shadowEdges(page);
  await page.locator('.panel [data-ruler]').click();
  await page.mouse.click(left, y);
  await page.mouse.click(right, y);
  const { rs, M } = await weigh(page);

  // Typed as a visitor types; a slip of the keyboard is caught before anything is given away.
  const rsBox = page.locator('[data-ask="rs"]');
  await rsBox.click();
  await page.keyboard.type('4.0.1');
  await page.locator('[data-check]').click();
  await expect(rsBox).toBeFocused();
  expect(await rsBox.evaluate((el: HTMLInputElement) => el.validationMessage)).toContain('Type a number');
  await expect(page.locator('.predict-reveal')).toBeHidden();

  await rsBox.click({ clickCount: 3 });
  await page.keyboard.type(rs.toFixed(2));
  expect(await rsBox.evaluate((el) => el.matches(':invalid')), 'a corrected box should lose its red edge as you type').toBe(false);
  await page.locator('[data-ask="M"]').click();
  await page.keyboard.type(`${(M / 1e4).toFixed(2)}×10^4`);
  await page.keyboard.press('Enter');
  const reveal = page.locator('.predict-reveal');
  await expect(reveal).toContainText('rs = 4 m');
  await expect(reveal).toContainText('= 90,000 kg');
  expect(await offs(page)).toHaveLength(2);
  for (const off of await offs(page)) expect(off).toBeLessThan(2);
  await expect(page.locator('.tour-text')).toBeVisible();
  await expect(page.locator('.readouts dt').first()).toHaveText('Schwarzschild radius');

  // The ring is the extension: at 20 rs light bends too much for the usual formula √(2rs/r).
  await page.keyboard.press('KeyN');
  await expect(page.locator('.tour-title')).toHaveText('Einstein ring');
  await expect(page.locator('.tour-text')).toContainText('into a ring 20.2°');
  await expect(page.locator('.tour-text')).toContainText('gives only 18.1°');
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test('the sky ruler measures by touch, and dragging a mark does not turn the view', async ({ page }) => {
    const errors = watchErrors(page);
    await openWorld(page, 'big-g');
    await page.evaluate(() => (window as any).slowlight.pause(true));
    const button = page.locator('.quick [data-ruler]');
    await button.tap();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const a = [110, 360], b = [300, 480];
    await page.touchscreen.tap(a[0], a[1]);
    await page.touchscreen.tap(b[0], b[1]);
    await expectReading(page, a, b);

    // A finger drags the second mark from beside it, on the side of the screen where a drag would turn the view.
    const view = await sample(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', b[0] + 12, b[1] + 8);
    for (let i = 1; i <= 4; i++) await touch('touchMove', b[0] + 12 - 15 * i, b[1] + 8 - 20 * i);
    await touch('touchEnd');
    await expectReading(page, a, [b[0] - 60, b[1] - 80]);
    await frames(page, 2);
    expect(meanDiff(view, await sample(page)), 'the view should not have turned').toBeLessThan(0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('weighing the hole by touch: the shadow sits clear of the tour card, and the answer boxes take typing', async ({ page }) => {
    const errors = watchErrors(page);
    await openWorld(page, 'big-g');
    for (let i = 0; i < 4; i++) await page.locator('[data-tour-next]').tap();
    await expect(page.locator('.tour-title')).toHaveText('Weigh the hole');
    await frames(page, 2);
    const shadow = await shadowEdges(page);
    expect(shadow.bottom).toBeLessThan((await page.locator('.tour').boundingBox())!.y);

    await page.locator('.quick [data-ruler]').tap();
    await page.touchscreen.tap(shadow.left, shadow.y);
    await page.touchscreen.tap(shadow.right, shadow.y);
    const { rs, M } = await weigh(page);
    await page.locator('[data-ask="rs"]').tap();
    await page.keyboard.type(rs.toFixed(2));
    await page.locator('[data-ask="M"]').tap();
    await page.keyboard.type(String(Math.round(M)));
    await page.locator('[data-check]').tap();
    await expect(page.locator('.predict-reveal')).toContainText('rs = 4 m');
    expect(await offs(page)).toHaveLength(2);
    for (const off of await offs(page)) expect(off).toBeLessThan(2);
    expect(errors).toEqual([]);
  });
});
