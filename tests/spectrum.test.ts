import { describe, expect, it } from 'vitest';
import { applyDoppler, buildDopplerLUT, cieXYZ, planck, wavelengthToRGB } from '../src/physics/spectrum';

describe('CIE 1931 colour matching fit', () => {
  it('reproduces tabulated values within 3%', () => {
    // CIE 1931 2° observer table values.
    const table: [number, number, number, number][] = [
      [450, 0.3362, 0.038, 1.7721],
      [500, 0.0049, 0.323, 0.272],
      [555, 0.5121, 1.0, 0.0057],
      [600, 1.0622, 0.631, 0.0008],
      [650, 0.2835, 0.107, 0.0],
    ];
    for (const [l, x, y, z] of table) {
      const [fx, fy, fz] = cieXYZ(l);
      expect(Math.abs(fx - x)).toBeLessThan(0.03 * Math.max(1, x));
      expect(Math.abs(fy - y)).toBeLessThan(0.03 * Math.max(1, y));
      expect(Math.abs(fz - z)).toBeLessThan(0.03 * Math.max(1, z));
    }
  });
});

describe('wavelength → RGB', () => {
  const dominant = (rgb: number[]) => rgb.indexOf(Math.max(...rgb));
  it('maps the spectrum to the right hues', () => {
    expect(dominant(wavelengthToRGB(680))).toBe(0);
    expect(dominant(wavelengthToRGB(530))).toBe(1);
    expect(dominant(wavelengthToRGB(450))).toBe(2);
  });
  it('is invisible outside 380–780 nm', () => {
    expect(Math.max(...wavelengthToRGB(300))).toBeLessThan(1e-3);
    expect(Math.max(...wavelengthToRGB(900))).toBeLessThan(1e-3);
  });
});

describe('Planck law', () => {
  it('peaks at Wien wavelength for the Sun', () => {
    const peak = 2.897771955e6 / 5772;
    expect(planck(peak, 5772)).toBeGreaterThan(planck(peak * 0.95, 5772));
    expect(planck(peak, 5772)).toBeGreaterThan(planck(peak * 1.05, 5772));
  });
});

describe('Doppler colour shift', () => {
  it('is the identity at D = 1', () => {
    for (const c of [[1, 0, 0], [0, 1, 0], [0.2, 0.5, 0.9]] as [number, number, number][]) {
      const out = applyDoppler(c, 1);
      out.forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
    }
  });
  it('blueshift moves green light toward blue, redshift toward red', () => {
    const g: [number, number, number] = [0, 1, 0];
    const blue = applyDoppler(g, 1.15);
    const red = applyDoppler(g, 0.87);
    expect(blue[2]).toBeGreaterThan(g[2] + 0.2);
    expect(red[0]).toBeGreaterThan(g[0] + 0.2);
  });
  it('strong blueshift reveals room-temperature thermal glow (infrared made visible)', () => {
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(applyDoppler([0, 0, 0], 1))).toBeLessThan(1e-9);
    expect(lum(applyDoppler([0, 0, 0], 18))).toBeGreaterThan(0.002);
  });
  it('keeps white white (just dimmer) under a small shift', () => {
    const c = applyDoppler([1, 1, 1], 1.05);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThan(0.15);
  });
  it('builds a lookup table without NaNs', () => {
    const lut = buildDopplerLUT(64);
    expect(lut.length).toBe(64 * 3 * 4);
    expect(lut.every(Number.isFinite)).toBe(true);
  });
});
