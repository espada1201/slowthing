import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import {
  KNOTS, KNOT_STEP, LUT_LOG_D_RANGE, SAMPLES, STEP, applyDoppler, buildDopplerLUT, buildKnotLUT, cieXYZ, planck, reflectionKnots,
  reflectionTransform, sun, wavelengthToRGB, whiteLuminance,
} from '../src/physics/spectrum';
import reflectGlsl from '../src/shaders/reflect.glsl?raw';
import { reflectKnots } from './shaderLookups';

const apply = (m: ArrayLike<number>, c: number[]) => [0, 1, 2].map((r) => m[r * 3] * c[0] + m[r * 3 + 1] * c[1] + m[r * 3 + 2] * c[2]);
const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

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

describe('wavelength → RGB, as every spectral integration sums it', () => {
  const dominant = (rgb: number[]) => rgb.indexOf(Math.max(...rgb));
  const integrate = (spectrum: (l: number) => number) =>
    SAMPLES.reduce((acc, l) => acc.map((v, k) => v + wavelengthToRGB(l)[k] * spectrum(l) * STEP), [0, 0, 0]);
  it('puts monochromatic red, green and blue light in the R, G and B channels', () => {
    expect(dominant(wavelengthToRGB(700))).toBe(0);
    expect(dominant(wavelengthToRGB(550))).toBe(1);
    expect(dominant(wavelengthToRGB(450))).toBe(2);
    // Spectral cyan is purer than any sRGB colour: it takes negative red.
    expect(wavelengthToRGB(500)[0]).toBeLessThan(0);
  });
  it('runs through the hues in spectral order, blue through cyan, green and yellow to red', () => {
    const hue = ([r, g, b]: number[]) => ((Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI + 360) % 360;
    const hues = [450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600].map((l) => hue(wavelengthToRGB(l)));
    hues.slice(1).forEach((h, i) => expect(h).toBeLessThan(hues[i]));
    expect(Math.abs(hues[0] - 240)).toBeLessThan(30);
    expect(hues[hues.length - 1]).toBeLessThan(15);
  });
  it('has the luminance of the eye’s sensitivity curve V(λ)', () => {
    for (const [l, v] of [[510, 0.503], [555, 1.0], [610, 0.503]]) expect(Math.abs(lum(wavelengthToRGB(l)) - v)).toBeLessThan(0.01);
  });
  it('integrates an equal-energy spectrum to the white of illuminant E, and 6500 K light to near-neutral', () => {
    // E (x = y = 1/3) in linear sRGB is R : G : B = 1.270 : 1 : 0.958, a touch warmer than the sRGB (D65) white.
    const e = integrate(() => 1);
    expect(Math.abs(e[0] / e[1] / 1.27 - 1)).toBeLessThan(0.02);
    expect(Math.abs(e[2] / e[1] / 0.958 - 1)).toBeLessThan(0.02);
    // A black body at D65's colour temperature.
    const d = integrate((l) => planck(l, 6504));
    expect(Math.max(...d) / Math.min(...d)).toBeLessThan(1.07);
  });
  it('is invisible outside 380–780 nm', () => {
    expect(Math.max(...wavelengthToRGB(300).map(Math.abs))).toBeLessThan(1e-3);
    expect(Math.max(...wavelengthToRGB(900).map(Math.abs))).toBeLessThan(1e-3);
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
  it('holds the table edge beyond its range instead of going black, as the shader lookup does', () => {
    for (const D of [0.5, 1, 2, 10]) expect(whiteLuminance(D) / lum(applyDoppler([1, 1, 1], D))).toBeCloseTo(1, 2);
    // Sprinting at an oncoming tram with c = 8 m/s gives D ≈ 93, past the table's 60: the edge colour, which
    // D⁵ beaming then makes blinding, not black.
    const edge = Math.exp(LUT_LOG_D_RANGE);
    expect(whiteLuminance(93)).toBeGreaterThan(0);
    expect(whiteLuminance(93)).toBe(whiteLuminance(edge));
    expect(whiteLuminance(1 / 93)).toBe(whiteLuminance(1 / edge));
  });
});

describe('light reflected with two Doppler factors', () => {
  // The surface's reflectance shifts by D_R on its way to the eye, the sunlight it reflects by D_S overall.
  it('keeps a white surface lit from infinity white, however deep in a gravity well it sits', () => {
    for (const dR of [0.4, 0.7, 1.5]) apply(reflectionTransform(dR, 1), [1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(1, 9));
  });
  it('darkens a red surface near the hole: its red is reflected into the infrared', () => {
    const red = [0.8, 0.05, 0.03];
    expect(lum(apply(reflectionTransform(0.75, 1), red))).toBeLessThan(0.5 * lum(red));
  });
  it('turns a white tram blue when it drives into the sun and red when it drives away', () => {
    const into = apply(reflectionTransform(1, 2), [1, 1, 1]);
    const away = apply(reflectionTransform(1, 0.6), [1, 1, 1]);
    expect(into[2] / into[0]).toBeGreaterThan(1.2);
    expect(away[0] / away[2]).toBeGreaterThan(1.2);
  });
});

describe('light carried at eight wavelengths, as the shaders carry it', () => {
  const sumKnots = (K: number[][], light: number[]) => K.reduce((acc, m, p) => acc.map((v, i) => v + light[p] * m[i]), new Array(9).fill(0));

  it('reflects sunlight at rest unchanged', () => {
    sumKnots(reflectionKnots(1), KNOTS.map(sun)).forEach((v, i) => expect(v).toBeCloseTo(i % 4 === 0 ? 1 : 0, 9));
  });
  it('matches the full spectral sums for shifted sunlight, through the shaders’ table: within 1 % where bright, 4 % where dim', () => {
    // The town's paints, as the scene stores them (linear RGB), under every pair of shifts the worlds reach.
    const paints = [0xc8553d, 0xf0e6cf, 0x22313a, 0x2f7f79, 0x5b6c8f, 0xe0a458, 0x3d6b35, 0xffffff].map((h) => new Color(h).toArray());
    const worst = { bright: 0, dim: 0 };
    for (let lnS = -2; lnS <= 3; lnS += 0.1) {
      for (let lnR = -1.6; lnR <= 1.6; lnR += 0.1) {
        for (const rgb of paints) {
          // What the display shows: out-of-gamut channels clipped at zero, as the shaders do.
          const want = apply(reflectionTransform(Math.exp(lnR), Math.exp(lnS)), rgb).map((v) => Math.max(v, 0));
          const brightness = lum(want) / lum(rgb);
          if (brightness < 0.01) continue;
          const got = reflectKnots(Math.exp(lnR), KNOTS.map((l) => rgb.map((c) => c * sun(l * Math.exp(lnS)))));
          const err = Math.max(...got.map((v, j) => Math.abs(v - want[j]) / lum(want)));
          if (brightness >= 0.1) worst.bright = Math.max(worst.bright, err);
          else worst.dim = Math.max(worst.dim, err);
        }
      }
    }
    expect(worst.bright).toBeLessThan(0.01);
    expect(worst.dim).toBeLessThan(0.04);
  });
  it('tabulates knot p’s matrix column by column on the Doppler table’s grid of shifts', () => {
    const size = 9;
    const lut = buildKnotLUT(size);
    expect(lut.length).toBe(size * KNOTS.length * 3 * 4);
    for (const [i, dR] of [[0, 1 / 60], [4, 1], [8, 60]]) {
      reflectionKnots(dR).forEach((m, p) => {
        for (let k = 0; k < 3; k++) {
          const texel = Array.from(lut.subarray(((3 * p + k) * size + i) * 4, ((3 * p + k) * size + i) * 4 + 4));
          [m[k], m[3 + k], m[6 + k], 1].forEach((v, j) => expect(texel[j]).toBeCloseTo(v, 5));
        }
      });
    }
  });
  it('uses the same knots and sunlight as shaders/reflect.glsl', () => {
    expect(Number(/const int KNOTS = (\d+);/.exec(reflectGlsl)?.[1])).toBe(KNOTS.length);
    const [, base, step] = /([\d.]+) \* exp\(([\d.]+) \* float\(p - 1\)\)/.exec(reflectGlsl) ?? [];
    expect(Number(base)).toBe(380);
    expect(Number(step)).toBe(KNOT_STEP);
    expect(KNOTS[1]).toBe(380);
    const [, scale, hcOverKT] = /r \* r \* r \* r \* r \* ([\d.]+) \/ \(exp\(min\(([\d.]+) \/ lambda/.exec(reflectGlsl) ?? [];
    const glslSun = (l: number) => (550 / l) ** 5 * Number(scale) / Math.expm1(Math.min(Number(hcOverKT) / l, 80));
    for (const l of [250, 400, 550, 700, 934, 3000]) expect(glslSun(l) / sun(l)).toBeCloseTo(1, 6);
  });
});
