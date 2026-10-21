import { describe, expect, it } from 'vitest';
import { buildReflectionLUT, reflectionTransform } from '../src/physics/reflection';
import { dopplerColorTransform } from '../src/physics/spectrum';

const apply = (m: number[], c: number[]) => [0, 1, 2].map((r) => m[r * 3] * c[0] + m[r * 3 + 1] * c[1] + m[r * 3 + 2] * c[2]);
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe('light reflected deep in a gravity well', () => {
  it('reduces to the one-factor Doppler shift when surface and illumination shift together', () => {
    for (const D of [0.5, 0.8, 1, 1.3, 2]) {
      const a = reflectionTransform(D, D);
      const b = dopplerColorTransform(D).matrix;
      a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    }
  });
  it('keeps a white surface lit from infinity white, however deep it sits', () => {
    for (const dR of [0.4, 0.7, 1.5]) apply(reflectionTransform(dR, 1), [1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 9));
  });
  it('darkens a red surface near the hole: its red is reflected into the infrared', () => {
    const red = [0.8, 0.05, 0.03];
    expect(lum(apply(reflectionTransform(0.75, 1), red))).toBeLessThan(0.5 * lum(red));
  });
  it('builds a finite lookup table', () => {
    const lut = buildReflectionLUT(8);
    expect(lut.length).toBe(8 * 8 * 3 * 4);
    expect(lut.every(Number.isFinite)).toBe(true);
  });
});
