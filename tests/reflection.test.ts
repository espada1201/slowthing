import { describe, expect, it } from 'vitest';
import { SKY_RAPIDITY_MAX, buildIlluminationLUT, buildReflectionLUT, buildSkyLUT, hemisphereWeight, reflectionTransform, skyLight } from '../src/physics/reflection';
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

describe('sunlight seen from a moving surface', () => {
  it('turns a white tram blue when it drives into the sun and red when it drives away', () => {
    const white = [1, 1, 1];
    const into = apply(reflectionTransform(1, 2), white);
    const away = apply(reflectionTransform(1, 0.6), white);
    expect(into[2] / into[0]).toBeGreaterThan(1.2);
    expect(away[0] / away[2]).toBeGreaterThan(1.2);
  });
  it('tabulates the shift with the unshifted sun in the middle', () => {
    const n = 9;
    const lut = buildIlluminationLUT(n, Math.log(60));
    expect(lut.every(Number.isFinite)).toBe(true);
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) expect(lut[(k * n + 4) * 4 + j]).toBeCloseTo(j === k ? 1 : 0, 9);
  });
});


describe('sky light on a moving surface', () => {
  const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const eta = (b: number) => Math.atanh(b);
  // Bolometric irradiance from a uniform sky on a plate facing straight ahead or straight back (D⁴ per unit solid angle).
  const head = (b: number) => (2 * (1 - b * b) ** 2 / (b * b)) * (1 / 6 + (1 - b) ** -3 / 3 - (1 - b) ** -2 / 2);

  it('splits a hemisphere into rings that add up to the whole', () => {
    for (const x of [-1, -0.6, 0, 0.3, 1]) {
      let s = 0;
      for (let i = 0; i < 4000; i++) s += hemisphereWeight(x, -1 + (i + 0.5) / 2000) / 2000;
      expect(s).toBeCloseTo(1, 4);
    }
  });
  it('matches the exact irradiance of a plate moving through isotropic light', () => {
    for (const b of [0.5, 0.9]) {
      expect(skyLight(1, eta(b), 4, identity, 2000)[0]).toBeCloseTo(head(b), 3);
      expect(skyLight(-1, eta(b), 4, identity, 2000)[0]).toBeCloseTo(head(-b), 4);
      expect(skyLight(0, eta(b), 4, identity, 2000)[0]).toBeCloseTo(1 / Math.sqrt(1 - b * b), 3);
      // Front minus back is the radiation flux through the plate, (16/3)γ²βx.
      const x = 0.3;
      const flux = skyLight(x, eta(b), 4, identity, 2000)[0] - skyLight(-x, eta(b), 4, identity, 2000)[0];
      expect(flux).toBeCloseTo((16 / 3) * (x * b) / (1 - b * b), 3);
    }
  });
  it('lights a fast tram from ahead: front bright and blue, side as bright as at rest but bluer, back dark', () => {
    const white = [1, 1, 1];
    const colour = (D: number) => reflectionTransform(1, D);
    const [front, side, back] = [1, 0, -1].map((x) => apply(skyLight(x, eta(0.9), 5, colour), white));
    expect(lum(front)).toBeGreaterThan(5);
    expect(front[2] / front[0]).toBeGreaterThan(2);
    expect(lum(side)).toBeGreaterThan(0.8);
    expect(lum(side)).toBeLessThan(1.3);
    expect(side[2] / side[0]).toBeGreaterThan(1.5);
    expect(lum(back)).toBeLessThan(0.01);
  });
  it('tabulates every switch combination, unshifted at rest', () => {
    const nx = 5, ne = 4;
    const lut = buildSkyLUT(nx, ne, 128);
    expect(lut.length).toBe(nx * ne * 7 * 4);
    expect(lut.every(Number.isFinite)).toBe(true);
    // At rapidity 0 (texel row e = 0) each block is the identity: rows 0–2 colour and searchlight, 3–5 colour only, 6 searchlight only.
    for (let i = 0; i < nx; i++) {
      for (const base of [0, 3]) for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) expect(lut[((base + k) * ne * nx + i) * 4 + j]).toBeCloseTo(j === k ? 1 : 0, 6);
      expect(lut[(6 * ne * nx + i) * 4]).toBeCloseTo(1, 6);
    }
    // Elsewhere it holds skyLight: a side face (i = 2) at the top rapidity (e = 3).
    const colour = (D: number) => reflectionTransform(1, D);
    const at = (row: number) => [0, 1, 2].map((j) => lut[((row * ne + 3) * nx + 2) * 4 + j]);
    const both = skyLight(0, SKY_RAPIDITY_MAX, 5, colour);
    const shift = skyLight(0, SKY_RAPIDITY_MAX, 0, colour);
    for (let k = 0; k < 3; k++) {
      at(k).forEach((v, j) => expect(v).toBeCloseTo(both[j * 3 + k], 2));
      at(3 + k).forEach((v, j) => expect(v).toBeCloseTo(shift[j * 3 + k], 2));
    }
    expect(at(6)[0]).toBeCloseTo(skyLight(0, SKY_RAPIDITY_MAX, 5, () => [1, 0, 0, 0, 1, 0, 0, 0, 1])[0], 2);
  });
});
