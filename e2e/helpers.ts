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
