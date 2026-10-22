// WCAG 2.3.1 (three flashes or below threshold), measured on what the canvas shows. All but `measureFlashes` run
// inside the page (passed as source text), so they use nothing from outside their own bodies.

import type { Page } from '@playwright/test';

/** Relative luminance of the WebGL canvas, averaged in linear light over block × block pixels. */
const grabLuminance = (block: number) => {
  const src = document.querySelector<HTMLCanvasElement>('#view')!;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) lin[i] = i / 255 <= 0.04045 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4;
  const w = Math.floor(c.width / block), h = Math.floor(c.height / block);
  const y = new Float32Array(w * h);
  for (let py = 0; py < h * block; py++) {
    for (let px = 0; px < w * block; px++) {
      const i = (py * c.width + px) * 4;
      y[Math.floor(py / block) * w + Math.floor(px / block)] += 0.2126 * lin[d[i]] + 0.7152 * lin[d[i + 1]] + 0.0722 * lin[d[i + 2]];
    }
  }
  for (let i = 0; i < y.length; i++) y[i] /= block * block;
  return { w, h, y };
};

/**
 * Feed it frames of relative luminance taken every 1/fps s. A transition is a swing of at least 0.1 whose darker
 * end is below 0.8; two opposing ones make a flash. `result` gives the most flashes any spot makes within a second,
 * and the largest share of a winW × winH window (a 10° field) flashing more than three times a second at the same
 * moment: under 25% (0.006 sr), WCAG allows any rate.
 */
export const flashMeter = (w: number, h: number, fps: number) => {
  const n = w * h;
  const lo = new Float32Array(n), hi = new Float32Array(n);
  const dir = new Int8Array(n);
  const at: number[][] = Array.from({ length: n }, () => []);
  let frames = 0;
  return {
    add(y: Float32Array) {
      for (let p = 0; p < n; p++) {
        const v = y[p];
        if (frames === 0) lo[p] = hi[p] = v;
        lo[p] = Math.min(lo[p], v);
        hi[p] = Math.max(hi[p], v);
        if (dir[p] !== 1 && v - lo[p] >= 0.1 && lo[p] < 0.8) dir[p] = 1;
        else if (dir[p] !== -1 && hi[p] - v >= 0.1 && v < 0.8) dir[p] = -1;
        else continue;
        lo[p] = hi[p] = v;
        at[p].push(frames);
      }
      frames++;
    },
    result(winW: number, winH: number) {
      let most = 0;
      const rapid = Array.from({ length: frames }, () => new Uint8Array(n));
      at.forEach((t, p) => {
        for (let i = 0, j = 0; j < t.length; j++) {
          while (t[j] - t[i] >= fps) i++;
          most = Math.max(most, j - i + 1);
          // Seven transitions within a second are more than three flashes: the spot counts as flashing throughout.
          if (j - i >= 6) for (let k = t[i]; k <= t[j]; k++) rapid[k][p] = 1;
        }
      });
      const ww = Math.min(w, winW), wh = Math.min(h, winH);
      const sat = new Float64Array((w + 1) * (h + 1));
      let area = 0;
      for (const m of rapid) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sat[(y + 1) * (w + 1) + x + 1] = m[y * w + x] + sat[y * (w + 1) + x + 1] + sat[(y + 1) * (w + 1) + x] - sat[y * (w + 1) + x];
        for (let y = 0; y + wh <= h; y++) {
          for (let x = 0; x + ww <= w; x++) {
            const s = sat[(y + wh) * (w + 1) + x + ww] - sat[y * (w + 1) + x + ww] - sat[(y + wh) * (w + 1) + x] + sat[y * (w + 1) + x];
            area = Math.max(area, s / (winW * winH));
          }
        }
      }
      return { flashes: most / 2, area };
    },
  };
};

const run = async (grab: typeof grabLuminance, meter: typeof flashMeter, seconds: number) => {
  const sl = (window as any).slowlight;
  const fps = 60, block = 4;
  sl.pause(true);
  let f = grab(block);
  const m = meter(f.w, f.h, fps);
  for (let k = 0; k < seconds * fps; k++) {
    if (k) {
      const n = sl.frames;
      sl.step(1 / fps);
      while (sl.frames === n) await new Promise((r) => requestAnimationFrame(r));
      f = grab(block);
    }
    m.add(f.y);
  }
  sl.pause(false);
  // WCAG's estimate of a 10° field is 341 × 256 px of a 1024 × 768 screen; taken here in CSS pixels.
  const scale = document.querySelector<HTMLCanvasElement>('#view')!.width / innerWidth;
  return m.result(Math.round((341 * scale) / block), Math.round((256 * scale) / block));
};

/** Step the world through `seconds` at 60 frames a second and measure its flashes. */
export const measureFlashes = (page: Page, seconds: number) => page.evaluate(`(${run})(${grabLuminance}, ${flashMeter}, ${seconds})`) as Promise<{ flashes: number; area: number }>;
