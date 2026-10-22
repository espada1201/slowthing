import { describe, expect, it } from 'vitest';
import { Schrodinger2D, barrierTransmission, correctSteps, stableTimeStep } from '../src/physics/schrodinger';
import { BALL, BLOCKS, GLASS_THICKNESS, GLASS_V0, OBSTACLE_Z, absorberOf, cellCentre, cellIndex, rasterize, spongeRate } from '../src/worlds/courtyard';

describe('courtyard floor plan', () => {
  for (const n of [256, 384, 512]) {
    it(`rasterizes to the same physical geometry on a ${n}² grid`, () => {
      const f = rasterize(n);
      const row = cellIndex(OBSTACLE_Z + 0.1, f.dx, n);
      const openRun = (x0: number, x1: number) => {
        let c = 0;
        for (let i = cellIndex(x0, f.dx, n); i <= cellIndex(x1, f.dx, n); i++) c += f.open[row * n + i];
        return c * f.dx;
      };
      expect(openRun(-20, -12)).toBeCloseTo(1.5, 6); // the doorway
      expect(openRun(-4, 0)).toBeCloseTo(1.5, 6); // one of the two openings
      expect(openRun(0, 4)).toBeCloseTo(1.5, 6);
      const col = cellIndex(16, f.dx, n);
      let glass = 0;
      for (let j = 0; j < n; j++) if (f.potential[j * n + col] > 0) glass++;
      expect(glass * f.dx).toBeCloseTo(GLASS_THICKNESS, 6);
      // Walls must be at least two cells thick or the nine-point stencil would leak through them.
      const divider = BLOCKS[0];
      expect((divider.x1 - divider.x0) / f.dx).toBeGreaterThanOrEqual(2);
    });

    it(`lets the ball tunnel through the glass at the analytic rate on a ${n}² grid`, () => {
      // The potential across the glass as the solver sees it (steps corrected), laid along a long line.
      const f = rasterize(n);
      const v = correctSteps(f.potential, f.open, n, n);
      const col = cellIndex(16, f.dx, n), j0 = cellIndex(OBSTACLE_Z, f.dx, n) - 4;
      const profile = Array.from({ length: GLASS_THICKNESS / f.dx + 8 }, (_, q) => v[(j0 + q) * n + col]);
      const p = { mass: BALL.mass, hbar: 0.25 }, k0 = (BALL.mass * BALL.speed) / p.hbar, sigma = 3;
      const grid = { nx: Math.round(100 / f.dx), ny: 2, dx: f.dx, periodicY: true, stencil: 4 as const };
      const sim = new Schrodinger2D(grid, p, stableTimeStep(grid, p, GLASS_V0));
      const i0 = Math.round(40 / f.dx);
      profile.forEach((u, q) => (sim.potential[i0 + q] = sim.potential[grid.nx + i0 + q] = u));
      sim.setGaussian(20, 0, sigma, k0, 0);
      sim.step(Math.round(11 / sim.dt));
      const d = sim.density();
      let through = 0, total = 0;
      for (let i = 0; i < grid.nx; i++) {
        total += d[i] + d[grid.nx + i];
        if (i >= i0 + profile.length) through += d[i] + d[grid.nx + i];
      }
      let num = 0, den = 0;
      for (let q = -5; q <= 5; q += 0.01) {
        const w = Math.exp(-0.5 * q * q), k = k0 + q / (2 * sigma);
        num += w * barrierTransmission((p.hbar * k) ** 2 / (2 * BALL.mass), GLASS_V0, GLASS_THICKNESS, p);
        den += w;
      }
      expect(Math.abs(through / total / (num / den) - 1)).toBeLessThan(0.03);
    });
  }

  it('absorbs only at the rim and beside the dividers past the obstacles', () => {
    expect(spongeRate(0, 18)).toBe(0);
    expect(spongeRate(0, -10)).toBe(0);
    expect(spongeRate(0, -23.9)).toBeGreaterThan(10);
    expect(spongeRate(7.5, -10)).toBeGreaterThan(5);
    expect(spongeRate(7.5, 5)).toBe(0);
  });

  it('classifies absorption sites', () => {
    expect(absorberOf(-23)).toBe('screen');
    expect(absorberOf(-10)).toBe('side');
    expect(absorberOf(23)).toBe('back');
    expect(cellCentre(cellIndex(1.3, 0.125, 384), 0.125)).toBeCloseTo(1.3125, 9);
  });
});
