// Sky light on a moving surface (World I's trams). In the tram's own frame a uniform sky arrives from
// direction μ (cosine to the motion) with Doppler factor D = 1/(γ(1 − βμ)): from ahead bluer and brighter
// (D⁵ per unit wavelength), from behind redder and dimmer. Each face sees the half of that sky in front of it.

import { KNOTS, KNOT_STEP, SUN_HC_KT_NM, SUN_REF_NM, sun } from './spectrum';

/**
 * Share of a surface's cosine-weighted view of the sky that lies at cos μ to its direction of motion, per unit μ,
 * for a surface whose normal is at cos x to that direction: (1/π)∫ max(0, n·k) dφ around the ring. Sums to 1 over μ.
 */
export function hemisphereWeight(x: number, mu: number): number {
  const a = Math.sqrt(Math.max(0, (1 - x * x) * (1 - mu * mu)));
  const b = x * mu;
  if (b >= a) return 2 * b;
  if (b <= -a) return 0;
  const phi = Math.acos(-b / a);
  return (2 / Math.PI) * (a * Math.sin(phi) + b * phi);
}

/**
 * The sky seen by a face at cos x to the motion, at rapidity η, as `steps` midpoint samples uniform in ln D
 * (dμ = d ln D / (βγD)): visits each sample's ln D and its share of the light, weighted by D^power. At rest it
 * gives the limit η → 0, where every sample has D = 1 and the shares still split the sky by direction.
 */
function eachSkySample(x: number, rapidity: number, power: number, steps: number, visit: (lnD: number, share: number) => void) {
  const eta = Math.max(rapidity, 1e-6);
  const beta = Math.tanh(eta);
  const gamma = Math.cosh(eta);
  const dl = (2 * eta) / steps;
  for (let i = 0; i < steps; i++) {
    const lnD = -eta + (i + 0.5) * dl;
    const D = Math.exp(lnD);
    visit(lnD, (hemisphereWeight(x, (1 - 1 / (gamma * D)) / beta) * D ** (power - 1) * dl) / (beta * gamma));
  }
}

/**
 * Light from a uniform sky on a surface moving at rapidity η, in the surface's own frame, relative to the surface
 * at rest: Σ share · colour(D). `colour(D)` is a 3×3 colour matrix for one D, or any list of numbers linear in the
 * light, and the sum has as many entries; `power` is the intensity exponent per unit wavelength (5 with the searchlight
 * on, 0 with it off).
 */
export function skyLight(x: number, eta: number, power: number, colour: (D: number) => number[], steps = 512): number[] {
  const out: number[] = [];
  eachSkySample(x, eta, power, steps, (lnD, w) => {
    if (w !== 0) colour(Math.exp(lnD)).forEach((v, k) => (out[k] = (out[k] ?? 0) + w * v));
  });
  return out;
}

/** Fastest mover the sky table covers: the tram at the slowest c, γβ = 6, is η ≈ 2.5. */
export const SKY_RAPIDITY_MAX = 3;

/**
 * The sky light is tabulated as a spectrum on the wavelengths skyLambda(n), n < SKY_LAMBDAS. SKY_STEP is half the knot
 * spacing, so for a face whose light reaches the eye shifted by D_out = e^{(i − SKY_HALF)·SKY_STEP} knot p falls on
 * λ_{2p+i}: one wavelength grid serves every D_out over the Doppler LUT's range.
 */
export const SKY_STEP = KNOT_STEP / 2;
export const SKY_HALF = 55;
export const SKY_LAMBDAS = 2 * (KNOTS.length - 1) + 2 * SKY_HALF + 1;
export const skyLambda = (n: number) => KNOTS[0] * Math.exp((n - SKY_HALF) * SKY_STEP);
/** Sky Doppler grid steps per SKY_STEP: the sunlight arriving with each D is interpolated between them. */
const FINE = 2;
const SKY_FINE = SKY_STEP / FINE;
const FINE_REACH = Math.ceil(SKY_RAPIDITY_MAX / SKY_FINE);
/** Sunlight at λ_{(q − FINE_REACH)/FINE}: every λ_n shifted by every grid D. */
const SUN_FINE = Float64Array.from({ length: FINE * (SKY_LAMBDAS - 1) + 2 * FINE_REACH + 1 }, (_, q) => sun(skyLambda((q - FINE_REACH) / FINE)));

/**
 * Sky light on a face at cos x to the motion, at rapidity η, in its own frame, relative to sunlight at rest, at each λ_n:
 * Σ share · sun(λ_n·D), with intensity exponent `power` (as skyLight). The shares are eachSkySample's spread linearly
 * onto a grid of ln D FINE times finer than SKY_STEP, which makes the sum a convolution with SUN_FINE.
 */
export function skySpectrum(x: number, eta: number, power: number): Float64Array {
  const share = new Float64Array(2 * FINE_REACH + 1);
  eachSkySample(x, eta, power, 256, (lnD, w) => {
    const p = Math.min(2 * FINE_REACH, Math.max(0, lnD / SKY_FINE + FINE_REACH));
    const m = Math.min(2 * FINE_REACH - 1, Math.floor(p));
    share[m] += w * (m + 1 - p);
    share[m + 1] += w * (p - m);
  });
  const light = new Float64Array(SKY_LAMBDAS);
  for (let m = 0; m < share.length; m++) {
    if (share[m] === 0) continue;
    for (let n = 0, q = m; n < SKY_LAMBDAS; n++, q += FINE) light[n] += share[m] * SUN_FINE[q];
  }
  return light;
}

/** Texels per row of the sky table for one searchlight setting: texel n holds λ_n…λ_{n+3}. */
export const SKY_TEXELS = SKY_LAMBDAS - 3;
/** The sky table's last column: the total sky light with the searchlight on, for when the colour shift is off. */
export const SKY_BEAM = 2 * SKY_TEXELS;
/** Face directions and rapidities in the sky table. */
export const SKY_X = 33;
export const SKY_ETA = 32;

/**
 * The table for shaders/slow-moving.frag over nx face directions spaced evenly in angle from the motion,
 * x = cos(π·ix/(nx − 1)) (a face's view of the sky changes fastest edge-on to the bright sky ahead and near the back),
 * and ne rapidities η ∈ [0, SKY_RAPIDITY_MAX]: texel (n + SKY_TEXELS·s, ix + nx·e) holds ln of skySpectrum at
 * λ_n…λ_{n+3}, with the searchlight on (s = 0) or off (s = 1), and texel (SKY_BEAM, ix + nx·e) holds in red ln of the
 * total with the searchlight on. Logarithms, because they interpolate smoothly.
 */
export function buildSkyLUT(nx = SKY_X, ne = SKY_ETA): Float32Array {
  const width = SKY_BEAM + 1;
  const table = new Float32Array(width * nx * ne * 4);
  for (let e = 0; e < ne; e++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = Math.cos((Math.PI * ix) / (nx - 1)), eta = (SKY_RAPIDITY_MAX * e) / (ne - 1);
      const row = (ix + nx * e) * width;
      [5, 0].forEach((power, s) => {
        const light = skySpectrum(x, eta, power);
        for (let n = 0; n < SKY_LAMBDAS; n++) {
          // Far into the ultraviolet the sunlight underflows to 0. A floor far below anything visible keeps the logarithm
          // finite, so the shader's interpolation never meets an infinity (0 × ∞ is NaN).
          const v = Math.log(Math.max(light[n], 1e-30));
          // λ_n is component k of texel n − k.
          for (let k = 0; k < 4; k++) if (n - k >= 0 && n - k < SKY_TEXELS) table[(row + n - k + SKY_TEXELS * s) * 4 + k] = v;
        }
      });
      table.set([Math.log(skyLight(x, eta, 5, () => [1], 256)[0]), 0, 0, 1], (row + SKY_BEAM) * 4);
    }
  }
  return table;
}

const glsl = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/**
 * The numbers the shaders' lookups share with these tables and the knot table, as GLSL constants. Prepended wherever
 * shaders/reflect.glsl is, so the shaders cannot drift from the tables they read.
 */
export const TABLES_GLSL = `const int KNOTS = ${KNOTS.length};
const float KNOT_LAMBDA[KNOTS] = float[KNOTS](${KNOTS.map(glsl).join(', ')});
const float SUN_REF_NM = ${glsl(SUN_REF_NM)};
const float SUN_HC_KT_NM = ${glsl(SUN_HC_KT_NM)};
const float SUN_NORM = ${glsl(Math.expm1(SUN_HC_KT_NM / SUN_REF_NM))};
const int SKY_X = ${SKY_X};
const int SKY_ETA = ${SKY_ETA};
const float SKY_RAPIDITY_MAX = ${glsl(SKY_RAPIDITY_MAX)};
const float SKY_STEP = ${glsl(SKY_STEP)};
const int SKY_HALF = ${SKY_HALF};
const int SKY_TEXELS = ${SKY_TEXELS};
const int SKY_BEAM = ${SKY_BEAM};
`;
