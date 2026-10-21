import { describe, expect, it } from 'vitest';
import {
  Schrodinger2D,
  barrierTransmission,
  freeSpreadWidth,
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

describe('measurement sampling', () => {
  it('draws indices in proportion to the density', () => {
    const density = [0, 1, 3, 0];
    expect(sampleIndex(density, 0.1)).toBe(1);
    expect(sampleIndex(density, 0.5)).toBe(2);
    expect(sampleIndex(density, 0.999)).toBe(2);
  });
});
