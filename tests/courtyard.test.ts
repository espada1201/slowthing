import { describe, expect, it } from 'vitest';
import { BLOCKS, GLASS_THICKNESS, OBSTACLE_Z, absorberOf, cellCentre, cellIndex, rasterize, spongeRate } from '../src/worlds/courtyard';

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
