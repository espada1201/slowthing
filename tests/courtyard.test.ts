import { describe, expect, it } from 'vitest';
import { Schrodinger2D, correctSteps, meanWavevector, stableTimeStep } from '../src/physics/schrodinger';
import { BALL, BLOCKS, DETECTOR_RESOLUTION, DETECTOR_SIGMA, GLASS_SIGMA, GLASS_THICKNESS, GLASS_V0, HBAR, OBSTACLE_Z, absorberOf, cellCentre, cellIndex, glassTheory, rasterize, spongeRate } from '../src/worlds/courtyard';

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

describe('the floor detector', () => {
  it('leaves a lump no wider than its resolution, which spreads faster than the wave did and never turns back into it', () => {
    // The tour's measurement on open floor: a ball rolled at the courtyard's ħ, caught 1.2 s out, and the same roll uncaught.
    const p = { mass: BALL.mass, hbar: HBAR }, grid = { nx: 128, ny: 128, dx: 0.1875, stencil: 4 as const };
    const roll = () => {
      const sim = new Schrodinger2D(grid, p, stableTimeStep(grid, p, 0));
      sim.setGaussian(5, 12, 0.8, (BALL.mass * BALL.speed) / HBAR, 0);
      sim.step(Math.round(1.2 / sim.dt));
      return sim;
    };
    const wave = roll(), caught = roll();
    // The detector fires 0.4 m off the middle and multiplies |ψ|² by its Gaussian there, as hbar-copy.frag does to ψ.
    const at = wave.moments(), fx = at.x + 0.4, fy = at.y;
    const cells = grid.nx * grid.ny, xy = (k: number) => [(k % grid.nx) * grid.dx, Math.floor(k / grid.nx) * grid.dx];
    const states = [caught.re, caught.im, caught.imPrev];
    for (let k = 0; k < cells; k++) {
      const [x, y] = xy(k), w = Math.exp(-((x - fx) ** 2 + (y - fy) ** 2) / (4 * DETECTOR_SIGMA ** 2));
      for (const s of states) s[k] *= w;
    }
    const scale = 1 / Math.sqrt(caught.norm());
    for (const s of states) for (let k = 0; k < cells; k++) s[k] *= scale;
    // Spread as the panel measures it, and |⟨wave|caught⟩|² (Im ψ midway between its half steps).
    const spread = (sim: Schrodinger2D) => Math.hypot(sim.moments().sx, sim.moments().sy);
    const overlap = () => {
      let re = 0, im = 0;
      for (let k = 0; k < cells; k++) {
        const a = wave.re[k], b = 0.5 * (wave.im[k] + wave.imPrev[k]), c = caught.re[k], d = 0.5 * (caught.im[k] + caught.imPrev[k]);
        re += a * c + b * d;
        im += a * d - b * c;
      }
      return (re * re + im * im) * grid.dx ** 4;
    };
    // One step on, Im ψ half a step behind is the solver's own again rather than a windowed copy.
    wave.step(1);
    caught.step(1);
    const was = { wave: spread(wave), caught: spread(caught), overlap: overlap() };
    expect(was.caught).toBeLessThanOrEqual(DETECTOR_RESOLUTION);
    expect(was.overlap).toBeLessThan(0.5);
    wave.step(Math.round(1.2 / wave.dt));
    caught.step(Math.round(1.2 / caught.dt));
    expect(spread(caught) - was.caught).toBeGreaterThan(2 * (spread(wave) - was.wave));
    // Both evolve by the same Schrödinger equation, which keeps their overlap: the lump never becomes the wave again.
    expect(overlap()).toBeCloseTo(was.overlap, 4);
  });
});
