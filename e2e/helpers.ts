import { type Page, expect } from '@playwright/test';

/** Collect console errors and uncaught exceptions for the whole test. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Open a world directly (low quality keeps software rendering quick) and wait for frames. */
export async function openWorld(page: Page, world: string, extra = '') {
  await page.goto(`./?world=${world}&quality=low&e2e${extra}`);
  await page.waitForFunction(() => (window as any).slowlight?.frames > 8, null, { timeout: 60_000 });
}

/** A 32×20 grid of luminance samples from the WebGL canvas. */
export async function sample(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const src = document.querySelector<HTMLCanvasElement>('#view')!;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 20;
    const g = c.getContext('2d')!;
    g.drawImage(src, 0, 0, 32, 20);
    const d = g.getImageData(0, 0, 32, 20).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4) out.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    return out;
  });
}

export const spread = (s: number[]) => {
  const m = s.reduce((a, b) => a + b, 0) / s.length;
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length);
};

export const meanDiff = (a: number[], b: number[]) => a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0) / a.length;

export async function frames(page: Page, n: number) {
  const start = await page.evaluate(() => (window as any).slowlight.frames);
  await page.waitForFunction((s) => (window as any).slowlight.frames >= s, start + n, { timeout: 60_000 });
}

export async function expectRendered(page: Page) {
  const s = await sample(page);
  expect(spread(s), 'canvas should show a scene, not a flat colour').toBeGreaterThan(8);
  return s;
}

export async function readout(page: Page, label: string): Promise<string> {
  return page.evaluate((l) => (window as any).slowlight.readouts().find((r: any) => r.label === l)?.value ?? '', label);
}

/** Full-resolution luminance of the WebGL canvas, kept in the page for `changedPixels`. */
const grab = () => {
  const src = document.querySelector<HTMLCanvasElement>('#view')!;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
  return out;
};

/**
 * Flip an effect switch and back with time frozen. Returns the mean change on the coarse grid and how many
 * full-resolution pixels changed visibly (for switches that only draw thin lines).
 */
export async function switchDiff(page: Page, id: string): Promise<{ mean: number; changed: number }> {
  const box = page.locator(`[data-toggle="${id}"]`);
  const was = await box.isChecked();
  await page.evaluate(() => (window as any).slowlight.pause(true));
  await frames(page, 2);
  const before = await sample(page);
  await page.evaluate(`window.__before = (${grab})()`);
  await box.setChecked(!was, { force: true });
  await frames(page, 2);
  const after = await sample(page);
  const changed = await page.evaluate(`(() => { const a = (${grab})(), b = window.__before; let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) n++; return n; })()`);
  await box.setChecked(was, { force: true });
  await page.evaluate(() => (window as any).slowlight.pause(false));
  return { mean: meanDiff(before, after), changed: changed as number };
}

/** Town or world time shown by a clock readout ("10:08:23.4"), in seconds. */
export async function clockSeconds(page: Page, label: string): Promise<number> {
  const [h, m, s] = (await readout(page, label)).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
