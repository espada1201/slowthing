import { describe, expect, it } from 'vitest';
import { Schrodinger2D, correctSteps, meanWavevector, stableTimeStep } from '../src/physics/schrodinger';
import { BALL, BLOCKS, GLASS_SIGMA, GLASS_THICKNESS, GLASS_V0, HBAR, OBSTACLE_Z, absorberOf, cellCentre, cellIndex, glassTheory, rasterize, spongeRate } from '../src/worlds/courtyard';

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

    it(`lets the ball tunnel through the glass at the analytic rate on a ${n}² grid, and come out no slower`, () => {
      // The potential across the glass as the solver sees it (steps corrected), laid along a long line.
      const f = rasterize(n);
      const v = correctSteps(f.potential, f.open, n, n);
      const col = cellIndex(16, f.dx, n), j0 = cellIndex(OBSTACLE_Z, f.dx, n) - 4;
      const profile = Array.from({ length: GLASS_THICKNESS / f.dx + 8 }, (_, q) => v[(j0 + q) * n + col]);
      const p = { mass: BALL.mass, hbar: HBAR }, k0 = (BALL.mass * BALL.speed) / p.hbar;
      const grid = { nx: Math.round(100 / f.dx), ny: 2, dx: f.dx, periodicY: true, stencil: 4 as const };
      const sim = new Schrodinger2D(grid, p, stableTimeStep(grid, p, GLASS_V0));
      const i0 = Math.round(40 / f.dx), past = i0 + profile.length;
      profile.forEach((u, q) => (sim.potential[i0 + q] = sim.potential[grid.nx + i0 + q] = u));
      sim.setGaussian(20, 0, GLASS_SIGMA, k0, 0);
      // Speed from the mean momentum of ψ (Im ψ taken midway between its two half steps), over the cells asked for.
      const speed = (inside: (i: number) => boolean) =>
        (p.hbar * Math.hypot(...meanWavevector(grid, (k) => sim.re[k], (k) => 0.5 * (sim.im[k] + sim.imPrev[k]), inside))) / BALL.mass;
      expect(speed(() => true)).toBeCloseTo(BALL.speed, 9);
      sim.step(Math.round(11 / sim.dt));
      const d = sim.density();
      let through = 0, total = 0;
      for (let i = 0; i < grid.nx; i++) {
        total += d[i] + d[grid.nx + i];
        if (i >= past) through += d[i] + d[grid.nx + i];
      }
      const theory = glassTheory(p.hbar);
      expect(Math.abs(through / total / theory.through - 1)).toBeLessThan(0.03);
      // What got through lost no energy: the faster parts of the packet tunnel more easily, so it is if anything faster.
      const out = speed((i) => i >= past);
      expect(out).toBeGreaterThan(BALL.speed);
      expect(Math.abs(out - theory.speedThrough)).toBeLessThan(0.004);
    });
  }

  it('rolls the glass lane a packet whose energy lies almost all below the glass, so what gets through has tunnelled', () => {
    const t = glassTheory(HBAR);
    expect(t.below).toBeGreaterThanOrEqual(0.95);
    // Narrow enough in energy that the packet lets through about what a plane wave at the ball's speed would.
    expect(Math.abs(t.through / t.planeWave - 1)).toBeLessThan(0.02);
    expect(t.speedThrough).toBeGreaterThan(BALL.speed);
    expect(t.speedThrough).toBeLessThan(1.01 * BALL.speed);
  });

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
