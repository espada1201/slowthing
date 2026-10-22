import { describe, expect, it } from 'vitest';
import { SKY_BEAM, SKY_HALF, SKY_LAMBDAS, SKY_STEP, SKY_TEXELS, buildSkyLUT, hemisphereWeight, skyLambda, skyLight } from '../src/physics/skylight';
import { KNOTS, apply3, luminance, reflectionTransform, sun } from '../src/physics/spectrum';
import { reflectKnots, skyBeam, skyKnots } from './shaderLookups';

const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const eta = (b: number) => Math.atanh(b);

describe('sky light on a moving surface, in its own frame', () => {
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
  it('is the unshifted sky at rest', () => {
    for (const x of [-1, 0, 0.4, 1]) skyLight(x, 0, 5, identity).forEach((v, k) => expect(v).toBeCloseTo(k % 4 === 0 ? 1 : 0, 4));
  });
  it('lights a fast tram from ahead: front bright and blue, side as bright as at rest but bluer, back dark', () => {
    const colour = (D: number) => reflectionTransform(1, D);
    const [front, side, back] = [1, 0, -1].map((x) => apply3(skyLight(x, eta(0.9), 5, colour), [1, 1, 1]));
    expect(luminance(front)).toBeGreaterThan(5);
    expect(front[2] / front[0]).toBeGreaterThan(2);
    expect(luminance(side)).toBeGreaterThan(0.8);
    expect(luminance(side)).toBeLessThan(1.3);
    expect(side[2] / side[0]).toBeGreaterThan(1.5);
    expect(luminance(back)).toBeLessThan(0.01);
  });
});

describe('sky light reflected on to the eye, as the shader looks it up', () => {
  const shaded = (x: number, eta: number, dOut: number, rgb: number[], searchlight: boolean) =>
    reflectKnots(dOut, skyKnots(dOut, x, eta, searchlight).map((v) => rgb.map((c) => c * v)));
  // What the display shows: out-of-gamut channels clipped at zero, as the shaders do.
  const exact = (x: number, eta: number, dOut: number, rgb: number[], power: number) =>
    apply3(skyLight(x, eta, power, (D) => reflectionTransform(dOut, D * dOut), 128), rgb).map((v) => Math.max(v, 0));

  it('is the sky at rest, unshifted, for a face at rest seen at rest', () => {
    for (const x of [1, 0.3, -1]) shaded(x, 0, 1, [0.9, 0.82, 0.62], true).forEach((v, j) => expect(v).toBeCloseTo([0.9, 0.82, 0.62][j], 2));
  });
  it('matches the exact sky light seen from the town: within 3 % where it is bright, 6 % where dim', () => {
    // Faces of every orientation at speeds up to the tram at the slowest c (γβ = 6), seen with D_out from 0.2 to 5.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const colours = [[1, 1, 1], [0.9, 0.82, 0.62], [0.75, 0.12, 0.08], [0.1, 0.3, 0.8], [0.13, 0.19, 0.23]];
    const worst = { bright: 0, dim: 0 };
    for (let n = 0; n < 200; n++) {
      const b = 0.3 + 0.6864 * rnd(), x = -1 + 2 * rnd(), dOut = Math.exp(-1.7 + 3.4 * rnd()), rgb = colours[n % 5];
      for (const searchlight of [true, false]) {
        const want = exact(x, eta(b), dOut, rgb, searchlight ? 5 : 0);
        const seen = luminance(want) * (searchlight ? dOut ** 5 : 1);
        if (seen < 0.01) continue;
        const got = shaded(x, eta(b), dOut, rgb, searchlight);
        const err = Math.max(...[0, 1, 2].map((j) => Math.abs(got[j] - want[j]) / luminance(want)));
        if (seen >= 0.2) worst.bright = Math.max(worst.bright, err);
        else worst.dim = Math.max(worst.dim, err);
      }
    }
    expect(worst.bright).toBeLessThan(0.03);
    expect(worst.dim).toBeLessThan(0.06);
  });
  it('gives the searchlight alone as the total of the light, for when the colour shift is off', () => {
    for (const [x, b] of [[1, 0.894], [0.2, 0.5], [-0.7, 0.95]]) {
      expect(Math.abs(skyBeam(x, eta(b)) / skyLight(x, eta(b), 5, () => [1], 256)[0] - 1)).toBeLessThan(0.005);
    }
  });
  it('builds a finite table, with the sky at rest equal to sunlight', () => {
    const table = buildSkyLUT(5, 4);
    expect(table.length).toBe((SKY_BEAM + 1) * 5 * 4 * 4);
    expect(table.every(Number.isFinite)).toBe(true);
    // Row e = 0 (at rest), face ix = 2: texel n holds ln sun at λ_n…λ_{n+3}, floored far below anything visible, and
    // the last texel ln of the total, which at rest is the sky itself.
    const row = 2 * (SKY_BEAM + 1);
    for (const n of [0, 40, 100]) {
      for (let k = 0; k < 4; k++) expect(table[(row + n) * 4 + k]).toBeCloseTo(Math.log(Math.max(sun(skyLambda(n + k)), 1e-30)), 3);
    }
    expect(table[(row + SKY_BEAM) * 4]).toBeCloseTo(0, 3);
    // The shader reads knot p of a face seen with D_out = e^{(i − SKY_HALF)·SKY_STEP} at λ_{2p+i}.
    for (const i of [0, SKY_HALF, 2 * SKY_HALF]) KNOTS.forEach((l, p) => expect(skyLambda(2 * p + i) / (l * Math.exp((i - SKY_HALF) * SKY_STEP))).toBeCloseTo(1, 12));
    expect(SKY_LAMBDAS).toBe(SKY_TEXELS + 3);
  });
});
