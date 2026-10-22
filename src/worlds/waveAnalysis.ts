// What a read-back of the courtyard wave says: how much of the ball is on the floor, where and how spread, how much is
// past the obstacle, its mean wavevector, cells drawn with probability |ψ|², and the lump a detector leaves.

import { cumulative, meanWavevector, sampleIndex } from '../physics/schrodinger';
import { OBSTACLE_Z, cellCentre } from './courtyard';

/**
 * The wave on a grid of n² cells dx wide, as GpuSchrodinger reads it back: RGBA per cell, row j = z, holding Re ψ,
 * Im ψ half a step after and half a step before, and the probability absorbed there.
 */
export interface Readback {
  readonly n: number;
  readonly dx: number;
  readonly buffer: Float32Array;
}

export interface WaveStats {
  inField: number;
  /** Probability the absorbing walls have taken so far. */
  absorbed: number;
  /** Highest |ψ|² on the floor (1/m²). */
  peak: number;
  x: number;
  z: number;
  spread: number;
  /** Share of the ball past the obstacle, on the floor or already absorbed there. */
  beyond: number;
  /** Probability on the floor past the obstacle, not yet absorbed. */
  beyondOnFloor: number;
}

/** Summarise a read-back: probability left on the floor and absorbed, its mean and spread, and how much is past the obstacle. */
export function analyse({ n, dx, buffer: b }: Readback): WaveStats {
  const cell = dx * dx;
  let m = 0, mx = 0, mz = 0, mxx = 0, mzz = 0, ab = 0, beyond = 0, onFloor = 0, peak = 0;
  for (let j = 0; j < n; j++) {
    const z = cellCentre(j, dx);
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4;
      const rho = Math.max(0, b[k] * b[k] + b[k + 1] * b[k + 2]);
      ab += b[k + 3];
      if (z < OBSTACLE_Z) {
        beyond += rho * cell + b[k + 3];
        onFloor += rho;
      }
      if (rho === 0) continue;
      const x = cellCentre(i, dx);
      if (rho > peak) peak = rho;
      m += rho;
      mx += rho * x;
      mz += rho * z;
      mxx += rho * x * x;
      mzz += rho * z * z;
    }
  }
  const inField = m * cell;
  if (m <= 0) return { inField: 0, absorbed: ab, peak: 0, x: 0, z: 0, spread: 0, beyond: 1, beyondOnFloor: 0 };
  const ex = mx / m, ez = mz / m;
  return {
    inField,
    absorbed: ab,
    peak,
    x: ex,
    z: ez,
    spread: Math.sqrt(Math.max(0, mxx / m - ex * ex + mzz / m - ez * ez)),
    beyond: beyond / Math.max(1e-9, inField + ab),
    beyondOnFloor: onFloor * cell,
  };
}

/** Mean wavevector of the wave in a read-back, over the cells `inside` picks (all of them by default). */
export function wavevector({ n, dx, buffer: b }: Readback, inside: (i: number, j: number) => boolean = () => true): [number, number] {
  // Im ψ is read back at the half steps either side of Re ψ: their mean is Im ψ at the same moment.
  return meanWavevector({ nx: n, ny: n, dx }, (k) => b[k * 4], (k) => 0.5 * (b[k * 4 + 1] + b[k * 4 + 2]), inside);
}

/** Draw a cell with probability |ψ|²: its centre's x and z and its index, or null if the read-back holds no wave. */
export function sampleCell({ n, dx, buffer: b }: Readback): [number, number, number] | null {
  const cdf = cumulative(n * n, (k) => b[k * 4] ** 2 + b[k * 4 + 1] * b[k * 4 + 2]);
  if (cdf[n * n - 1] <= 1e-12) return null;
  const k = sampleIndex(cdf, Math.random());
  return [cellCentre(k % n, dx), cellCentre(Math.floor(k / n), dx), k];
}

/**
 * The lump a detector leaves when it catches the ball: |ψ|² times its Gaussian response, of σ `sigma` cells about
 * (ci, cj) in cells (cell i is centred on i). Returns the probability that survives, which ψ is rescaled by, and the
 * summary of the lump once rescaled; null if nothing survives.
 */
export function collapsed({ n, dx, buffer: b }: Readback, ci: number, cj: number, sigma: number): { norm: number; stats: WaveStats } | null {
  // What survives is |ψ|² times the response: its total sets the rescaling, its moments the new summary.
  let kept = 0, mx = 0, mz = 0, mrr = 0, peak = 0, beyond = 0;
  const reach = 6 * sigma;
  for (let j = Math.max(0, Math.ceil(cj - reach)); j <= Math.min(n - 1, cj + reach); j++) {
    const z = cellCentre(j, dx);
    for (let i = Math.max(0, Math.ceil(ci - reach)); i <= Math.min(n - 1, ci + reach); i++) {
      const k = (j * n + i) * 4;
      const x = cellCentre(i, dx);
      const d2 = (i - ci) ** 2 + (j - cj) ** 2;
      const rho = Math.exp(-d2 / (2 * sigma * sigma)) * Math.max(0, b[k] ** 2 + b[k + 1] * b[k + 2]);
      kept += rho;
      mx += rho * x;
      mz += rho * z;
      mrr += rho * (x * x + z * z);
      if (rho > peak) peak = rho;
      if (z < OBSTACLE_Z) beyond += rho;
    }
  }
  const norm = kept * dx * dx;
  if (norm <= 1e-12) return null;
  const ex = mx / kept, ez = mz / kept;
  const spread = Math.sqrt(Math.max(0, mrr / kept - ex * ex - ez * ez));
  return { norm, stats: { inField: 1, absorbed: 0, peak: peak / norm, x: ex, z: ez, spread, beyond: beyond / kept, beyondOnFloor: beyond / kept } };
}
