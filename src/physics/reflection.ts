// Colour of starlit surfaces deep in a gravity well. Light from infinity falls in, is reflected at r_e and
// climbs back out to the observer: the reflectance's spectral features shift by the surface→eye factor D_R,
// but the illumination's spectrum by the full infinity→eye factor D_S. One combined Doppler factor
// (spectrum.ts) cannot say that, so this is the two-factor version of the same spectral model. A white
// surface stays white for any D_R; a red one deep in the well turns dark, its red reflected into the infrared.

import { basisSpectra, cieXYZ, planck, xyzToLinearSRGB } from './spectrum';

const SUN_T = 5778; // the sunlight of spectrum.ts
const STEP = 5;
const SAMPLES = Array.from({ length: 81 }, (_, i) => 380 + i * STEP);
const SAMPLE_RGB = SAMPLES.map((l) => xyzToLinearSRGB(cieXYZ(l)));
const sun = (l: number) => planck(l, SUN_T) / planck(550, SUN_T);

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

function invert3([a, b, c, d, e, f, g, h, i]: number[]): number[] {
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map((v) => v / det);
}

const NORMALISE = invert3(integrate(1, 1));

/** Row-major 3×3: observed linear RGB = M · surface RGB, before the D_S⁵ intensity factor. */
export function reflectionTransform(dR: number, dS: number): number[] {
  const a = integrate(dR, dS);
  const m = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) m[i * 3 + j] += NORMALISE[i * 3 + k] * a[k * 3 + j];
  return m;
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
