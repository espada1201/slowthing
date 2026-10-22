import { describe, expect, it } from 'vitest';
import { DIALS, REAL, formatSI, fromSlider, parseNumber, ratioLabel, toSlider } from '../src/constants';

describe('dial labels', () => {
  it('give the factor from reality with its mantissa, not a rounded power of ten', () => {
    const G = (4.5 * REAL.c ** 2) / (2 * 9.0e4); // the boulder black hole of World III
    expect(ratioLabel('G', G)).toBe('×3.4×10²²');
    expect(ratioLabel('hbar', 0.25)).toBe('×2.4×10³³');
    expect(ratioLabel('c', 12)).toBe('÷2.5×10⁷');
    expect(ratioLabel('c', REAL.c)).toBe('real');
    expect(ratioLabel('c', REAL.c / 1.5)).toBe('÷1.5');
    expect(ratioLabel('G', REAL.G * 9.96e22)).toBe('×1.0×10²³');
  });

  it('format SI values for people', () => {
    expect(formatSI(4.1378e-34)).toBe('4.14×10⁻³⁴');
    expect(formatSI(REAL.c)).toBe('299 792 458');
    expect(formatSI(12)).toBe('12');
  });

  it('map sliders logarithmically between the dial limits', () => {
    for (const d of Object.values(DIALS)) {
      expect(fromSlider(d, 0)).toBeCloseTo(d.min, 12);
      expect(fromSlider(d, toSlider(d, d.max)) / d.max).toBeCloseTo(1, 9);
      const mid = Math.sqrt(d.min * d.max);
      expect(toSlider(d, mid)).toBe(500);
    }
  });
});

describe('numbers typed as answers', () => {
  it('read decimal points or commas, digit groups and powers of ten however they are written', () => {
    const cases: [string, number][] = [
      ['4.1', 4.1], ['4,1', 4.1], [' 3.99 ', 3.99], ['.5', 0.5], ['−2', -2],
      ['90 000', 9e4], ['90,000', 9e4], ['1,234,567.5', 1234567.5],
      ['9e4', 9e4], ['9.0E+4', 9e4], ['9×10^4', 9e4], ['9 x 10^4', 9e4], ['8.99*10^4', 8.99e4], ['9·10⁴', 9e4], ['1.3 × 10⁻²²', 1.3e-22],
    ];
    for (const [text, v] of cases) expect(parseNumber(text), text).toBe(v);
  });

  it('refuse anything else', () => {
    for (const text of ['', 'four', '4.1 m', '4..1', '9e', '1,2,3', '×10^4', '1e999']) expect(parseNumber(text), text).toBeNull();
  });
});
