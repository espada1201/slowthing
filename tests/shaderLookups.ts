// The shaders' table lookups, step for step, on the CPU: shaders/reflect.glsl reflectKnots and
// shaders/slow-surface.frag skyKnots / skyBeam. Tests run them against the full spectral sums.
import { SKY_HALF, SKY_RAPIDITY_MAX, SKY_STEP, SKY_TEXELS, buildSkyLUT } from '../src/physics/skylight';
import { KNOTS, LUT_LOG_D_RANGE, buildKnotLUT } from '../src/physics/spectrum';
import { LUT_SIZE, SKY_ETA, SKY_X } from '../src/lut';

const knotLut = buildKnotLUT(LUT_SIZE);
const { spectrum, beam } = buildSkyLUT(SKY_X, SKY_ETA);

/** Σ_p K_p(dR) · light[p], light[p] being the light at knot p times the surface colour. */
export function reflectKnots(dR: number, light: number[][]): number[] {
  const x = Math.min(1, Math.max(0, (Math.log(dR) + LUT_LOG_D_RANGE) / (2 * LUT_LOG_D_RANGE))) * (LUT_SIZE - 1);
  const i0 = Math.floor(x), i1 = Math.min(i0 + 1, LUT_SIZE - 1), f = x - i0;
  const c = [0, 0, 0];
  for (let p = 0; p < KNOTS.length; p++) {
    for (let k = 0; k < 3; k++) {
      const row = (3 * p + k) * LUT_SIZE;
      for (let j = 0; j < 3; j++) c[j] += light[p][k] * (knotLut[(row + i0) * 4 + j] * (1 - f) + knotLut[(row + i1) * 4 + j] * f);
    }
  }
  return c.map((v) => Math.max(v, 0));
}

function skyCell(x: number, eta: number) {
  const q = [(Math.acos(Math.max(-1, Math.min(1, x))) / Math.PI) * (SKY_X - 1), Math.min(1, eta / SKY_RAPIDITY_MAX) * (SKY_ETA - 1)];
  const a = q.map(Math.floor);
  const b = [Math.min(a[0] + 1, SKY_X - 1), Math.min(a[1] + 1, SKY_ETA - 1)];
  const g = [q[0] - a[0], q[1] - a[1]];
  return [0, 1, 2, 3].map((c) => ({ ix: c & 1 ? b[0] : a[0], e: c & 2 ? b[1] : a[1], w: (c & 1 ? g[0] : 1 - g[0]) * (c & 2 ? g[1] : 1 - g[1]) }));
}

/** The sky light at each knot, off a face at cos x to its motion at rapidity η, seen with Doppler factor dOut. */
export function skyKnots(dOut: number, x: number, eta: number, searchlight: boolean): number[] {
  const i = Math.min(2 * SKY_HALF, Math.max(0, Math.log(dOut) / SKY_STEP + SKY_HALF));
  const n0 = Math.min(Math.floor(i), 2 * SKY_HALF - 1), f = i - n0;
  const v = new Array(16).fill(0);
  for (const { ix, e, w } of skyCell(x, eta)) {
    for (let t = 0; t < 4; t++) {
      const o = ((ix + SKY_X * e) * 2 * SKY_TEXELS + n0 + 4 * t + (searchlight ? 0 : SKY_TEXELS)) * 4;
      for (let k = 0; k < 4; k++) v[4 * t + k] += w * spectrum[o + k];
    }
  }
  return KNOTS.map((_, p) => Math.exp(v[2 * p] * (1 - f) + v[2 * p + 1] * f));
}

/** The searchlight alone on that face's sky light. */
export function skyBeam(x: number, eta: number): number {
  return Math.exp(skyCell(x, eta).reduce((s, { ix, e, w }) => s + w * beam[(e * SKY_X + ix) * 4], 0));
}
