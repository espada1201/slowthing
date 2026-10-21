// Spectral colour model used for Doppler shifting.
// An sRGB surface colour is lifted to a full emitted spectrum (three visible bands with ultraviolet and
// infrared shoulders, plus 300 K thermal glow), Doppler-shifted, then re-integrated against the CIE 1931
// observer. At D = 1 the round trip returns the original colour exactly.

import type { Vec3 } from './vec';

const lobe = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2° colour matching functions, multi-lobe fit of Wyman, Sloan & Shirley (JCGT 2013). λ in nm. */
export function cieXYZ(lambda: number): Vec3 {
  const x = 1.056 * lobe(lambda, 599.8, 37.9, 31.0) + 0.362 * lobe(lambda, 442.0, 16.0, 26.7) - 0.065 * lobe(lambda, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(lambda, 568.8, 46.9, 40.5) + 0.286 * lobe(lambda, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(lambda, 437.0, 11.8, 36.0) + 0.681 * lobe(lambda, 459.0, 26.0, 13.8);
  return [x, y, z];
}

export function xyzToLinearSRGB([x, y, z]: Vec3): Vec3 {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/** Displayable linear-sRGB colour of monochromatic light, out-of-gamut colours desaturated toward white. */
export function wavelengthToRGB(lambda: number): Vec3 {
  const rgb = xyzToLinearSRGB(cieXYZ(lambda));
  const lo = Math.min(0, ...rgb);
  return rgb.map((v) => Math.max(0, v - lo)) as Vec3;
}

const H = 6.62607015e-34;
const C = 299792458;
const KB = 1.380649e-23;
/** Planck spectral radiance B_λ(T) in W·sr⁻¹·m⁻³, λ in nm. */
export function planck(lambdaNm: number, T: number): number {
  const l = lambdaNm * 1e-9;
  return (2 * H * C * C) / l ** 5 / Math.expm1((H * C) / (l * KB * T));
}

const THERMAL_PEAK_NM = 2.897771955e6 / 300;
const thermal = (lambda: number) => (0.5 * planck(lambda, 300)) / planck(THERMAL_PEAK_NM, 300);
const nearIR = (lambda: number) => 0.35 * Math.min(1, Math.max(0, (lambda - 690) / 60)) * Math.exp(-Math.max(0, lambda - 1300) / 400);

/** Emitted (reflected) spectral basis for the red, green and blue channels of a surface colour. */
export function basisSpectra(lambda: number): Vec3 {
  return [
    lobe(lambda, 610, 40, 50) + nearIR(lambda) + 0.1 * lobe(lambda, 360, 25, 25),
    lobe(lambda, 545, 32, 32) + nearIR(lambda) + 0.1 * lobe(lambda, 360, 25, 25),
    lobe(lambda, 455, 25, 30) + nearIR(lambda) + 0.4 * lobe(lambda, 360, 25, 25),
  ];
}

const STEP = 5;
const SAMPLES: number[] = [];
for (let l = 380; l <= 780; l += STEP) SAMPLES.push(l);
const SAMPLE_RGB = SAMPLES.map((l) => xyzToLinearSRGB(cieXYZ(l)));

function integrate(D: number): { a: number[]; t: Vec3 } {
  const a = new Array(9).fill(0);
  const t: Vec3 = [0, 0, 0];
  SAMPLES.forEach((lo, i) => {
    const le = lo * D;
    const b = basisSpectra(le);
    const th = thermal(le);
    const rgb = SAMPLE_RGB[i];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) a[j * 3 + k] += rgb[j] * b[k] * STEP;
      t[j] += rgb[j] * th * STEP;
    }
  });
  return { a, t };
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), Cc, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

function mul3(m: number[], n: number[]): number[] {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += m[i * 3 + k] * n[k * 3 + j];
  return r;
}

const NORMALISE = invert3(integrate(1).a);

/**
 * Colour transform for a Doppler factor D = ν_observed / ν_emitted (no intensity beaming).
 * Observed linear RGB = matrix · rgb + thermal. `matrix` is row-major 3×3.
 */
export function dopplerColorTransform(D: number): { matrix: number[]; thermal: Vec3 } {
  const { a, t } = integrate(D);
  const matrix = mul3(NORMALISE, a);
  const th = [0, 1, 2].map((r) => NORMALISE[r * 3] * t[0] + NORMALISE[r * 3 + 1] * t[1] + NORMALISE[r * 3 + 2] * t[2]) as Vec3;
  return { matrix, thermal: th };
}

export function applyDoppler(rgb: Vec3, D: number): Vec3 {
  const { matrix: m, thermal: t } = dopplerColorTransform(D);
  return [0, 1, 2].map((r) => m[r * 3] * rgb[0] + m[r * 3 + 1] * rgb[1] + m[r * 3 + 2] * rgb[2] + t[r]) as Vec3;
}

export const LUT_LOG_D_RANGE = Math.log(60);

/**
 * Lookup table over ln D ∈ [−LUT_LOG_D_RANGE, +LUT_LOG_D_RANGE], 3 rows of RGBA texels.
 * Row k holds the contribution of input channel k (rgb) and, in alpha, thermal glow of output channel k.
 */
export function buildDopplerLUT(size: number): Float32Array {
  const data = new Float32Array(size * 3 * 4);
  for (let i = 0; i < size; i++) {
    const lnD = -LUT_LOG_D_RANGE + (2 * LUT_LOG_D_RANGE * i) / (size - 1);
    const { matrix, thermal: th } = dopplerColorTransform(Math.exp(lnD));
    for (let k = 0; k < 3; k++) {
      const o = (k * size + i) * 4;
      data[o] = matrix[k];
      data[o + 1] = matrix[3 + k];
      data[o + 2] = matrix[6 + k];
      data[o + 3] = th[k];
    }
  }
  return data;
}
