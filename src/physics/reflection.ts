// Colour of starlit surfaces deep in a gravity well. Light from infinity falls in, is reflected at r_e and
// climbs back out to the observer: the reflectance's spectral features shift by the surface→eye factor D_R,
// but the illumination's spectrum by the full infinity→eye factor D_S. One combined Doppler factor
// (spectrum.ts) cannot say that, so this is the two-factor version of the same spectral model. A white
// surface stays white for any D_R; a red one deep in the well turns dark, its red reflected into the infrared.

import { SAMPLES, SAMPLE_RGB, STEP, basisSpectra, invert3, mul3, sun } from './spectrum';

function integrate(dR: number, dS: number): number[] {
  const a = new Array(9).fill(0);
  SAMPLES.forEach((lo, i) => {
    const s = sun(lo * dS);
    const b = basisSpectra(lo * dR);
    const rgb = SAMPLE_RGB[i];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) a[j * 3 + k] += rgb[j] * b[k] * s * STEP;
  });
  return a;
}

const NORMALISE = invert3(integrate(1, 1));

/** Row-major 3×3: observed linear RGB = M · surface RGB, before the D_S⁵ intensity factor. */
export function reflectionTransform(dR: number, dS: number): number[] {
  return mul3(NORMALISE, integrate(dR, dS));
}

export const REFLECTION_LOG_RANGE = Math.log(8);

/**
 * size × size table over ln D_R (x) and ln D_S (y) ∈ [−REFLECTION_LOG_RANGE, +REFLECTION_LOG_RANGE].
 * Texel (x, y + k·size) holds the contribution of surface channel k to the observed RGB.
 */
export function buildReflectionLUT(size: number): Float32Array {
  const data = new Float32Array(size * size * 3 * 4);
  const at = (i: number) => Math.exp(-REFLECTION_LOG_RANGE + (2 * REFLECTION_LOG_RANGE * i) / (size - 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = reflectionTransform(at(x), at(y));
      for (let k = 0; k < 3; k++) {
        const o = ((y + k * size) * size + x) * 4;
        data[o] = m[k];
        data[o + 1] = m[3 + k];
        data[o + 2] = m[6 + k];
        data[o + 3] = 1;
      }
    }
  }
  return data;
}

/**
 * Sunlight on a moving surface: in the surface's own frame the sun's spectrum arrives shifted by D while the
 * reflectance stays put (D_R = 1, D_S = D). Table over ln D ∈ [−logRange, +logRange], laid out like the Doppler
 * LUT: row k holds the contribution of surface channel k to the reflected RGB, before the D³ flux factor.
 */
export function buildIlluminationLUT(size: number, logRange: number): Float32Array {
  const data = new Float32Array(size * 3 * 4);
  for (let i = 0; i < size; i++) {
    const m = reflectionTransform(1, Math.exp(-logRange + (2 * logRange * i) / (size - 1)));
    for (let k = 0; k < 3; k++) {
      const o = (k * size + i) * 4;
      data[o] = m[k];
      data[o + 1] = m[3 + k];
      data[o + 2] = m[6 + k];
      data[o + 3] = 1;
    }
  }
  return data;
}

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

/** Midpoint samples of the sky at rapidity η > 0, uniform in ln D: each has its D, its ring cos μ and its dμ. */
function skySamples(eta: number, steps: number) {
  const beta = Math.tanh(eta);
  const gamma = Math.cosh(eta);
  const dl = (2 * eta) / steps;
  return Array.from({ length: steps }, (_, i) => {
    const D = Math.exp(-eta + (i + 0.5) * dl);
    return { D, mu: (1 - 1 / (gamma * D)) / beta, dmu: dl / (beta * gamma * D) };
  });
}

/**
 * Light from a uniform sky on a surface moving at rapidity η, in the surface's own frame, relative to the surface at
 * rest: a 3×3 colour matrix. Sky light from cos μ to the motion arrives with D = 1/(γ(1 − βμ)), so the sky ahead is
 * bluer and brighter and the sky behind redder and dimmer. `colour(D)` is the colour matrix for one D and `power` the
 * intensity exponent per unit wavelength (5 with the searchlight on, 0 with it off).
 */
export function skyLight(x: number, eta: number, power: number, colour: (D: number) => number[], steps = 128): number[] {
  if (eta < 1e-6) return colour(1);
  const out = new Array(9).fill(0);
  for (const { D, mu, dmu } of skySamples(eta, steps)) {
    const w = hemisphereWeight(x, mu) * D ** power * dmu;
    if (w === 0) continue;
    const m = colour(D);
    for (let k = 0; k < 9; k++) out[k] += w * m[k];
  }
  return out;
}

/** Fastest mover the sky table covers: the tram at the slowest c, γβ = 6, is η ≈ 2.5. */
export const SKY_RAPIDITY_MAX = 3;

/**
 * nx × ne table of skyLight over cos x ∈ [−1, 1] and η ∈ [0, SKY_RAPIDITY_MAX], one block per switch setting:
 * texel (i, e + r·ne) holds row r, where rows 0–2 are colour shift and searchlight (laid out like the Doppler LUT),
 * rows 3–5 colour shift only, and row 6 the searchlight factor alone in its red channel. Each rapidity's samples
 * and colour matrices are shared by every x.
 */
export function buildSkyLUT(nx: number, ne: number, steps = 64): Float32Array {
  // reflectionTransform(1, D) on a fine ln D grid (odd, so D = 1 is a node), interpolated for each sample.
  const N = 257;
  const range = SKY_RAPIDITY_MAX;
  const grid = Array.from({ length: N }, (_, i) => reflectionTransform(1, Math.exp(-range + (2 * range * i) / (N - 1))));
  const colour = (D: number) => {
    const f = ((Math.log(D) + range) / (2 * range)) * (N - 1);
    const i = Math.min(N - 2, Math.max(0, Math.floor(f)));
    return grid[i].map((v, k) => v + (grid[i + 1][k] - v) * (f - i));
  };
  const data = new Float32Array(nx * ne * 7 * 4);
  const put = (row: number, i: number, e: number, r: number, g: number, b: number) => data.set([r, g, b, 1], ((row * ne + e) * nx + i) * 4);
  for (let e = 0; e < ne; e++) {
    const eta = (SKY_RAPIDITY_MAX * e) / (ne - 1);
    const samples = eta > 0 ? skySamples(eta, steps).map((p) => ({ ...p, m: colour(p.D), d5: p.D ** 5 * p.dmu })) : [];
    for (let i = 0; i < nx; i++) {
      const x = -1 + (2 * i) / (nx - 1);
      let both = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      let shift = both;
      let beam = 1;
      if (samples.length) {
        both = new Array(9).fill(0);
        shift = new Array(9).fill(0);
        beam = 0;
        for (const p of samples) {
          const w = hemisphereWeight(x, p.mu);
          if (w === 0) continue;
          for (let k = 0; k < 9; k++) {
            both[k] += w * p.d5 * p.m[k];
            shift[k] += w * p.dmu * p.m[k];
          }
          beam += w * p.d5;
        }
      }
      for (let k = 0; k < 3; k++) {
        put(k, i, e, both[k], both[3 + k], both[6 + k]);
        put(3 + k, i, e, shift[k], shift[3 + k], shift[6 + k]);
      }
      put(6, i, e, beam, 0, 0);
    }
  }
  return data;
}
