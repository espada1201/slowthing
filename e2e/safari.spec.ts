import { type Page, expect, test } from '@playwright/test';
import { frames, meanDiff, openWorld, sample, watchErrors } from './helpers';

// Only Chromium runs here, so Safari and iOS are simulated by what they lack: these pages are loaded with
// extensions, APIs and gestures taken away before any script runs.

// Big G marches a ray per pixel, which software rendering draws at well under one frame a second.
test.slow();

/** Make the GPU look like a phone's: these extensions answer null (and are not listed), and are never enabled. */
async function without(page: Page, ...hidden: string[]) {
  await page.addInitScript((names) => {
    for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
      const get = C.prototype.getExtension as (this: unknown, name: string) => unknown;
      C.prototype.getExtension = function (this: unknown, name: string) {
        return names.includes(name) ? null : get.call(this, name);
      } as typeof C.prototype.getExtension;
      const list = C.prototype.getSupportedExtensions;
      C.prototype.getSupportedExtensions = function (this: WebGLRenderingContext) {
        return list.call(this)?.filter((n: string) => !names.includes(n)) ?? null;
      };
    }
  }, hidden);
}

/** Console warnings too: three.js says so when a float texture cannot be filtered linearly. */
function watchWarnings(page: Page) {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  return warnings;
}

test.describe('iOS has no OES_texture_float_linear', () => {
  for (const world of ['slow-light', 'big-hbar', 'big-g']) {
    test(`${world} draws, and three.js has no float texture to filter linearly`, async ({ page }) => {
      await without(page, 'OES_texture_float_linear');
      const errors = watchErrors(page);
      const warnings = watchWarnings(page);
      await openWorld(page, world);
      await frames(page, 2);
      const view = await sample(page);
      expect(Math.max(...view) - Math.min(...view), 'something is on screen').toBeGreaterThan(20);
      expect(warnings).toEqual([]);
      expect(errors).toEqual([]);
    });
  }

  test('every proof, the GPU shaders against the CPU physics, passes', async ({ page }) => {
    test.setTimeout(180_000);
    await without(page, 'OES_texture_float_linear');
    const errors = watchErrors(page);
    await page.goto('./?proofs&e2e');
    await expect(page.locator('.proofs-summary')).toHaveText(/^(\d+) of \1 passed$/, { timeout: 150_000 });
    await expect(page.locator('.proof[data-state="fail"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('older iPhones render into 16-bit float textures but not 32-bit ones', () => {
  test('Big ħ says why it cannot open, and the other two worlds open', async ({ page }) => {
    await without(page, 'EXT_color_buffer_float', 'OES_texture_float_linear');
    const errors = watchErrors(page);
    await page.goto('./?quality=low&e2e');
    await page.locator('.plate[data-world="big-hbar"]').click();
    await expect(page.locator('.error')).toContainText('Big ħ cannot run on this device');
    await expect(page.locator('.plate')).toHaveCount(3);
    for (const world of ['slow-light', 'big-g']) {
      await page.locator(`.plate[data-world="${world}"]`).click();
      await page.waitForFunction((w) => (window as any).slowlight?.world === w && (window as any).slowlight.frames > 4, world, { timeout: 60_000 });
      await expect(page.locator('.tour-title')).toBeVisible();
      const view = await sample(page);
      expect(Math.max(...view) - Math.min(...view), `${world} is on screen`).toBeGreaterThan(20);
      await page.getByRole('button', { name: '← Worlds' }).click();
      await expect(page.locator('.plate')).toHaveCount(3);
    }
    expect(errors).toEqual([]);
  });

  test('a link straight into the world it cannot run lands on the title screen with the reason', async ({ page }) => {
    await without(page, 'EXT_color_buffer_float');
    await page.goto('./?world=big-hbar&quality=low&e2e');
    await expect(page.locator('.error')).toContainText('Big ħ cannot run on this device');
    await expect(page.locator('.plate')).toHaveCount(3);
  });
});

test('with no float render target at all, only Big G opens, and the others say why', async ({ page }) => {
  await without(page, 'EXT_color_buffer_float', 'EXT_color_buffer_half_float');
  const errors = watchErrors(page);
  await page.goto('./?quality=low&e2e');
  await page.locator('.plate[data-world="slow-light"]').click();
  await expect(page.locator('.error')).toContainText('Slow Light cannot run on this device');
  await page.locator('.plate[data-world="big-hbar"]').click();
  await expect(page.locator('.error')).toContainText('Big ħ cannot run on this device');
  await page.locator('.plate[data-world="big-g"]').click();
  await page.waitForFunction(() => (window as any).slowlight?.world === 'big-g' && (window as any).slowlight.frames > 4, null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('with no WebGL2 at all, the title screen says so instead of failing silently', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return /webgl/.test(type) ? null : (get as any).call(this, type, ...rest);
    } as typeof get;
  });
  const uncaught: string[] = [];
  page.on('pageerror', (e) => uncaught.push(e.message));
  await page.goto('./?world=slow-light&quality=low&e2e');
  await expect(page.locator('.error')).toContainText('WebGL2 is not available');
  await page.locator('.plate[data-world="big-g"]').click();
  await expect(page.locator('.error')).toContainText('WebGL2 is not available');
  await expect(page.locator('.plate')).toHaveCount(3);
  expect(uncaught).toEqual([]);
});

test('with no pointer lock (iPad Safari), dragging the mouse looks around', async ({ page }) => {
  await page.addInitScript(() => {
    (Element.prototype as any).requestPointerLock = undefined;
  });
  const errors = watchErrors(page);
  await openWorld(page, 'slow-light');
  await page.evaluate(() => (window as any).slowlight.pause(true));
  await frames(page, 2);
  const before = await sample(page);
  await page.mouse.move(640, 500);
  await page.mouse.down();
  await page.mouse.move(400, 500, { steps: 8 });
  await page.mouse.up();
  await frames(page, 2);
  expect(meanDiff(before, await sample(page)), 'the view turned').toBeGreaterThan(2);
  // and a plain move with no button down does not
  const turned = await sample(page);
  await page.mouse.move(900, 300, { steps: 8 });
  await frames(page, 2);
  expect(meanDiff(turned, await sample(page))).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('sound left on starts at the click that ends a press, as iOS Safari allows, not only at its pointerdown', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('slowlight-sound', 'on');
    // Safari lets audio start only from a click, a touchend or a key press: resume() does nothing at any other time.
    let activation = false;
    for (const type of ['click', 'touchend', 'keydown']) {
      window.addEventListener(type, () => { activation = true; setTimeout(() => (activation = false)); }, true);
    }
    const node = () => ({ gain: { value: 0, setTargetAtTime() {} }, connect: (n: unknown) => n });
    class Audio {
      state = 'suspended';
      destination = {};
      currentTime = 0;
      constructor() {
        (window as any).audio = this;
      }
      createGain = node;
      createDynamicsCompressor = node;
      resume() {
        if (activation) this.state = 'running';
        return Promise.resolve();
      }
    }
    (window as any).AudioContext = Audio;
  });
  const errors = watchErrors(page);
  await page.goto('./?quality=low&e2e');
  await expect(page.locator('.plate')).toHaveCount(3);
  await page.mouse.move(400, 300);
  await page.mouse.down();
  expect(await page.evaluate(() => (window as any).audio.state), 'a pointerdown is no gesture to Safari').toBe('suspended');
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).audio.state)).toBe('running');
  expect(errors).toEqual([]);
});

test.describe('the GPU proofs say why they cannot run', () => {
  const gpuRows = (page: Page) => page.locator('.proof[data-proof]:has(.proof-world:text("GPU")) .proof-result');

  test('on a device without 32-bit float render targets, they name the textures', async ({ page }) => {
    await without(page, 'EXT_color_buffer_float');
    await page.goto('./?proofs&e2e');
    await expect(page.locator('.proofs-summary')).toHaveText(/^\d+ of \d+ passed$/, { timeout: 150_000 });
    const first = gpuRows(page).first();
    await expect(first).toContainText('32-bit floating-point textures');
    await expect(first).not.toContainText('WebGL2');
  });

  test('with no WebGL2, they say that, not something about textures', async ({ page }) => {
    await page.addInitScript(() => {
      const get = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return /webgl/.test(type) ? null : (get as any).call(this, type, ...rest);
      } as typeof get;
    });
    await page.goto('./?proofs&e2e');
    await expect(page.locator('.proofs-summary')).toHaveText(/^\d+ of \d+ passed$/, { timeout: 150_000 });
    const first = gpuRows(page).first();
    await expect(first).toContainText('WebGL2 is not available');
    await expect(first).not.toContainText('32-bit');
  });
});
