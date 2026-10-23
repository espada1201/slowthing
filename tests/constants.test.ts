import { describe, expect, it } from 'vitest';
import { DIALS, REAL, SLIDER_STEPS, formatSI, fromSlider, keyedSlider, parseNumber, ratioLabel, toSlider } from '../src/constants';

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
    // A mantissa that rounds up to 10 carries into the exponent.
    expect(formatSI(9.996e12)).toBe('1.00×10¹³');
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

describe('the G dial from the keyboard', () => {
  // The boulder's hole sits at step 960 of 1000, where a native step of 1 is a 5% change, one Page key jumps to the maximum,
  // and a tester who pressed ArrowRight saw nothing change.
  const rsAt = (step: number) => (fromSlider(DIALS.G, step) * 9.0e4 * 2) / REAL.c ** 2;

  it('moves a visible step with an arrow and a larger one with Page Up, from the world preset', () => {
    const arrow = keyedSlider(DIALS.G, 'ArrowRight', false, 960)!;
    const page = keyedSlider(DIALS.G, 'PageUp', false, 960)!;
    expect(rsAt(arrow) / rsAt(960)).toBeGreaterThan(1.2);
    expect(rsAt(arrow) / rsAt(960)).toBeLessThan(1.5);
    expect(page).toBeGreaterThan(arrow);
    expect(page).toBeLessThan(SLIDER_STEPS);
    expect(rsAt(page) / rsAt(960)).toBeGreaterThan(1.8);
  });

  it('goes both ways, clamps at the ends, and keeps a fine step on Shift', () => {
    expect(keyedSlider(DIALS.G, 'ArrowLeft', false, 960)).toBeLessThan(960);
    expect(keyedSlider(DIALS.G, 'ArrowUp', false, 960)).toBe(keyedSlider(DIALS.G, 'ArrowRight', false, 960));
    expect(keyedSlider(DIALS.G, 'PageDown', false, 960)).toBeLessThan(keyedSlider(DIALS.G, 'ArrowLeft', false, 960)!);
    expect(keyedSlider(DIALS.G, 'ArrowRight', false, 998)).toBe(SLIDER_STEPS);
    expect(keyedSlider(DIALS.G, 'PageDown', false, 3)).toBe(0);
    expect(keyedSlider(DIALS.G, 'ArrowRight', true, 960)).toBe(961);
  });

  it('leaves Home, End and the other dials to the browser', () => {
    expect(keyedSlider(DIALS.G, 'End', false, 960)).toBeNull();
    expect(keyedSlider(DIALS.G, 'a', false, 960)).toBeNull();
    expect(keyedSlider(DIALS.c, 'ArrowRight', false, 500)).toBeNull();
  });
});
