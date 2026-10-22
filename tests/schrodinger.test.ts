import { describe, expect, it } from 'vitest';
import {
  Schrodinger2D,
  barrierTransmission,
  correctSteps,
  cumulative,
  freeSpreadWidth,
  meanWavevector,
  packetAverage,
  sampleIndex,
  stableTimeStep,
} from '../src/physics/schrodinger';

const particle = { mass: 1, hbar: 1 };

describe('Schrödinger leapfrog solver', () => {
  it('conserves probability to machine precision, even with walls and a barrier', () => {
    const grid = { nx: 96, ny: 96, dx: 0.25 };
    const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, 4));
    for (let j = 0; j < 96; j++) {
      sim.open[j * 96 + 60] = j > 40 && j < 56 ? 1 : 0;
      sim.potential[j * 96 + 30] = 4;
    }
    sim.setGaussian(6, 12, 1.2, 3, 0);
    const n0 = sim.norm();
    sim.step(1500);
    expect(Math.abs(sim.norm() - n0)).toBeLessThan(1e-9);
  });

  it('banks what a sponge removes: exactly if it damps everywhere alike, to a fraction of a percent if it ramps', () => {
    const grid = { nx: 96, ny: 96, dx: 0.25 };
    const run = (rate: (i: number) => number) => {
      const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, 4));
      sim.sponge = new Float64Array(96 * 96);
      for (let k = 0; k < 96 * 96; k++) sim.sponge[k] = rate(k % 96);
      sim.setGaussian(6, 12, 1.2, 3, 0);
      const n0 = sim.norm();
      sim.step(1500);
      return { absorbed: sim.absorbed, norm: sim.norm(), n0 };
    };
    const uniform = run(() => 0.3);
    expect(uniform.absorbed).toBeGreaterThan(0.5);
    expect(Math.abs(uniform.norm + uniform.absorbed - uniform.n0)).toBeLessThan(1e-9);
    const ramp = run((i) => (i < 64 ? 0 : 6 * ((i - 63) / 32) ** 2));
    expect(ramp.absorbed).toBeGreaterThan(0.1);
    expect(ramp.norm).toBeLessThan(ramp.n0 - 0.1);
    expect(Math.abs(ramp.norm + ramp.absorbed - ramp.n0)).toBeLessThan(0.01 * ramp.absorbed);
  });

  it('spreads a free Gaussian as σ₀√(1 + (ħt/2mσ₀²)²)', () => {
    const grid = { nx: 160, ny: 160, dx: 0.2 };
    const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, 0));
    const s0 = 1;
    sim.setGaussian(16, 16, s0, 2, 0);
    const t = 3;
    sim.step(Math.round(t / sim.dt));
    const m = sim.moments();
    expect(Math.abs(m.sy / freeSpreadWidth(s0, sim.time, particle) - 1)).toBeLessThan(0.005);
    // The centre moves at the lattice group velocity (ħ/m dx)·sin(k dx) → ħk/m as dx → 0.
    expect(m.x).toBeCloseTo(16 + (Math.sin(2 * grid.dx) / grid.dx) * sim.time, 1);
  });

  it('tunnels through a rectangular barrier with the analytic transmission probability', () => {
    const dx = 0.05;
    const grid = { nx: 3200, ny: 2, dx, periodicY: true };
    const k0 = 4, sigma = 8, V0 = 10, a = 0.6; // E = k²/2 = 8 < V0
    const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, V0));
    const x1 = 80, x2 = x1 + a;
    for (let i = 0; i < grid.nx; i++) {
      const x = i * dx;
      if (x >= x1 && x < x2 - 1e-9) for (let j = 0; j < 2; j++) sim.potential[j * grid.nx + i] = V0;
    }
    sim.setGaussian(40, 0, sigma, k0, 0);
    sim.step(Math.round(20 / sim.dt));
    const d = sim.density();
    let trans = 0, total = 0;
    for (let i = 0; i < grid.nx; i++) {
      const p = d[i] + d[grid.nx + i];
      total += p;
      if (i * dx >= x2) trans += p;
    }
    // Average the analytic T(E) over the packet's momentum distribution (σk = 1/(2σ)).
    const sk = 1 / (2 * sigma);
    let num = 0, den = 0;
    for (let q = -5; q <= 5; q += 0.01) {
      const k = k0 + q * sk;
      const w = Math.exp(-0.5 * q * q);
      num += w * barrierTransmission((k * k) / 2, V0, a, particle);
      den += w;
    }
    const expected = num / den;
    expect(expected).toBeGreaterThan(0.01);
    expect(Math.abs(trans / total - expected) / expected).toBeLessThan(0.05);
  });
});

describe('fourth-order stencil (used by the GPU courtyard)', () => {
  it('conserves probability with two-cell walls', () => {
    const grid = { nx: 96, ny: 96, dx: 0.25, stencil: 4 as const };
    const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, 4));
    for (let j = 0; j < 96; j++) {
      for (const i of [60, 61]) sim.open[j * 96 + i] = j > 40 && j < 56 ? 1 : 0;
      sim.potential[j * 96 + 30] = 4;
    }
    sim.setGaussian(6, 12, 1.2, 3, 0);
    const n0 = sim.norm();
    sim.step(1500);
    expect(Math.abs(sim.norm() - n0)).toBeLessThan(1e-9);
  });

  it('moves a coarse packet (k·dx = 1) at nearly ħk/m, unlike the five-point stencil', () => {
    const speedError = (stencil: 2 | 4) => {
      const grid = { nx: 400, ny: 2, dx: 0.25, periodicY: true, stencil };
      const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, 0));
      sim.setGaussian(20, 0, 3, 4, 0);
      sim.step(Math.round(10 / sim.dt));
      return Math.abs((sim.moments().x - 20) / (4 * sim.time) - 1);
    };
    const e4 = speedError(4);
    expect(e4).toBeLessThan(0.04);
    expect(e4).toBeLessThan(speedError(2) / 3);
  });

  it('tunnels with the analytic transmission at k·dx = 0.6', () => {
    const dx = 0.15;
    const grid = { nx: 1067, ny: 2, dx, periodicY: true, stencil: 4 as const };
    const k0 = 4, sigma = 8, V0 = 10, a = 0.6;
    const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, V0));
    const i1 = Math.round(80 / dx), cells = Math.round(a / dx);
    for (let i = i1; i < i1 + cells; i++) for (let j = 0; j < 2; j++) sim.potential[j * grid.nx + i] = V0;
    sim.setGaussian(40, 0, sigma, k0, 0);
    sim.step(Math.round(20 / sim.dt));
    const d = sim.density();
    let trans = 0, total = 0;
    for (let i = 0; i < grid.nx; i++) {
      const p = d[i] + d[grid.nx + i];
      total += p;
      if (i >= i1 + cells) trans += p;
    }
    const sk = 1 / (2 * sigma);
    let num = 0, den = 0;
    for (let q = -5; q <= 5; q += 0.01) {
      const w = Math.exp(-0.5 * q * q);
      num += w * barrierTransmission(((k0 + q * sk) ** 2) / 2, V0, cells * dx, particle);
      den += w;
    }
    expect(Math.abs(trans / total / (num / den) - 1)).toBeLessThan(0.05);
  });

  it('tunnels through a two-cell barrier at k·dx = 1.2 at the analytic rate once its steps are corrected', () => {
    const dx = 0.3, k0 = 4, sigma = 8, V0 = 10, a = 0.6;
    const grid = { nx: Math.round(200 / dx), ny: 2, dx, periodicY: true, stencil: 4 as const };
    const i1 = Math.round(80 / dx), cells = Math.round(a / dx);
    const transmitted = (corrected: boolean) => {
      const sim = new Schrodinger2D(grid, particle, stableTimeStep(grid, particle, V0));
      for (let i = i1; i < i1 + cells; i++) for (let j = 0; j < 2; j++) sim.potential[j * grid.nx + i] = V0;
      if (corrected) sim.potential.set(correctSteps(sim.potential, sim.open, grid.nx, grid.ny));
      sim.setGaussian(40, 0, sigma, k0, 0);
      sim.step(Math.round(20 / sim.dt));
      const d = sim.density();
      let trans = 0, total = 0;
      for (let i = 0; i < grid.nx; i++) {
        total += d[i] + d[grid.nx + i];
        if (i >= i1 + cells) trans += d[i] + d[grid.nx + i];
      }
      return trans / total;
    };
    let num = 0, den = 0;
    for (let q = -5; q <= 5; q += 0.01) {
      const w = Math.exp(-0.5 * q * q);
      num += w * barrierTransmission(((k0 + q / (2 * sigma)) ** 2) / 2, V0, a, particle);
      den += w;
    }
    // The raw steps let through a fifth too little; corrected, the grid agrees with the analytic value.
    expect(transmitted(false) / (num / den) - 1).toBeLessThan(-0.15);
    expect(Math.abs(transmitted(true) / (num / den) - 1)).toBeLessThan(0.05);
  });

  it('corrects only the open cells beside a step, and keeps the total potential', () => {
    const v = Float64Array.from({ length: 12 }, (_, i) => (i === 5 || i === 6 ? 96 : 0));
    const open = new Float64Array(12).fill(1);
    const out = correctSteps(v, open, 12, 1);
    [0, 0, 0, -1, 7, 90, 90, 7, -1, 0, 0, 0].forEach((x, i) => expect(out[i]).toBeCloseTo(x, 12));
    expect(out.reduce((a, x) => a + x, 0)).toBeCloseTo(96 * 2, 12);
    // A wall cell keeps its zero.
    open[8] = 0;
    expect(correctSteps(v, open, 12, 1)[8]).toBe(0);
  });
});

/** A seeded uniform generator (mulberry32), so the sampling statistics are repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Born-rule sampling', () => {
  it('draws each cell as often as its weight says', () => {
    const weights = [0, 1, 3, 0, 2, 0.5, 0, 1.5];
    const cdf = cumulative(weights.length, (k) => weights[k]);
    const rand = seeded(7);
    const draws = 200_000;
    const counts = weights.map(() => 0);
    for (let s = 0; s < draws; s++) counts[sampleIndex(cdf, rand())]++;
    weights.forEach((w, k) => {
      const p = w / 8;
      // Within 4.5 standard deviations of the binomial expectation, which for a weightless cell means never.
      expect(Math.abs(counts[k] - draws * p)).toBeLessThanOrEqual(4.5 * Math.sqrt(draws * p * (1 - p)));
    });
  });

  it('never draws a weightless cell, at either end of the unit interval', () => {
    const cdf = cumulative(5, (k) => [0, 1, -2, 3, 0][k]);
    expect(Array.from(cdf)).toEqual([0, 1, 1, 4, 4]);
    expect(sampleIndex(cdf, 0)).toBe(1);
    expect(sampleIndex(cdf, 0.25 - 1e-12)).toBe(1);
    expect(sampleIndex(cdf, 0.25)).toBe(3);
    expect(sampleIndex(cdf, 1 - Number.EPSILON / 2)).toBe(3);
    expect(sampleIndex(cdf, 1)).toBe(3);
    expect(sampleIndex(cumulative(1, () => 2), 0.6)).toBe(0);
  });
});

describe('momentum read off ψ', () => {
  it('reads a plane wave’s wavevector exactly, even with only five cells to a wavelength', () => {
    // k·dx = 1.2, as for the courtyard ball on the coarsest grid, where a central-difference current reads sin(k dx)/dx: 22% short.
    const grid = { nx: 40, ny: 30, dx: 0.1875 }, kx = 6.4, ky = -2.1;
    const phase = (k: number) => kx * (k % grid.nx) * grid.dx + ky * Math.floor(k / grid.nx) * grid.dx;
    const [gx, gy] = meanWavevector(grid, (k) => Math.cos(phase(k)), (k) => Math.sin(phase(k)), () => true);
    expect(gx).toBeCloseTo(kx, 10);
    expect(gy).toBeCloseTo(ky, 10);
  });

  it('reads only the cells it is given: two packets heading opposite ways, one in each half', () => {
    const grid = { nx: 300, ny: 1, dx: 0.1 };
    const packet = (x: number, x0: number, k: number): [number, number] => {
      const a = Math.exp(-((x - x0) ** 2) / 4);
      return [a * Math.cos(k * x), a * Math.sin(k * x)];
    };
    const psi = (k: number) => {
      const x = k * grid.dx, a = packet(x, 5, 3), b = packet(x, 25, -5);
      return [a[0] + b[0], a[1] + b[1]];
    };
    const read = (inside: (i: number) => boolean) => meanWavevector(grid, (k) => psi(k)[0], (k) => psi(k)[1], inside)[0];
    expect(read((i) => i < 150)).toBeCloseTo(3, 9);
    expect(read((i) => i >= 150)).toBeCloseTo(-5, 9);
  });
});

describe('averages over a packet', () => {
  it('weights wavenumbers as a packet of width σ carries them: about k₀, spread 1/(2σ)', () => {
    expect(packetAverage(6.4, 2, (k) => k)).toBeCloseTo(6.4, 12);
    expect(packetAverage(6.4, 2, (k) => (k - 6.4) ** 2)).toBeCloseTo(1 / 16, 9);
    expect(packetAverage(6.4, 2, (k) => k ** 3)).toBeCloseTo(6.4 ** 3 + (3 * 6.4) / 16, 9);
  });
});
