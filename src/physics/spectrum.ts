// Spectral colour model used for Doppler shifting.
// An sRGB surface colour is lifted to a full spectrum (a smooth reflectance lit by 5778 K sunlight, which
// reaches into the ultraviolet and infrared, plus the surface's own 300 K thermal glow), Doppler-shifted,
// then re-integrated against the CIE 1931 observer. At D = 1 the round trip returns the original colour.

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

function xyzToLinearSRGB([x, y, z]: Vec3): Vec3 {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
}

/**
 * Linear-sRGB colour of unit-radiance monochromatic light at λ nm (the CIE observer in sRGB primaries):
 * what every spectral integration here sums. Spectral colours lie outside the sRGB gamut, so a channel
 * can be negative; only a whole spectrum's sum need be displayable.
 */
export function wavelengthToRGB(lambda: number): Vec3 {
  return xyzToLinearSRGB(cieXYZ(lambda));
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
const SUN_T = 5778;
const SUN_550 = planck(550, SUN_T);
/** Sunlight, normalised to 1 at 550 nm. Surfaces are sunlit reflectors. */
export const sun = (lambda: number) => planck(lambda, SUN_T) / SUN_550;
/**
 * Thermal emission of a 300 K surface relative to sunlit reflection: for an albedo-1 surface the
 * reflected solar radiance at 550 nm is ≈0.57 W·m⁻²·sr⁻¹·nm⁻¹, a 300 K black body peaks at ≈0.0099.
 */
const thermal = (lambda: number) => (0.0099 / 0.57) * (planck(lambda, 300) / planck(THERMAL_PEAK_NM, 300));
const logistic = (lambda: number, mid: number, width: number) => 1 / (1 + Math.exp(-(lambda - mid) / width));

/**
 * Reflectance basis for the red, green and blue channels: smooth windows that sum to 1 at every
 * wavelength, so a white surface reflects a flat spectrum that extends into the ultraviolet and infrared.
 */
export function basisSpectra(lambda: number): Vec3 {
  const r = logistic(lambda, 585, 12);
  const b = 1 - logistic(lambda, 495, 12);
  return [r, Math.max(0, 1 - r - b), b];
}

// The visible band sampled every STEP nm, and the linear-sRGB colour matching functions at each sample.
export const STEP = 5;
export const SAMPLES: number[] = [];
for (let l = 380; l <= 780; l += STEP) SAMPLES.push(l);
export const SAMPLE_RGB = SAMPLES.map(wavelengthToRGB);

function integrate(D: number): { a: number[]; t: Vec3 } {
  const a = new Array(9).fill(0);
  const t: Vec3 = [0, 0, 0];
  SAMPLES.forEach((lo, i) => {
    const le = lo * D;
    const sl = sun(le);
    const b = basisSpectra(le).map((v) => v * sl);
    const th = thermal(le);
    const rgb = SAMPLE_RGB[i];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) a[j * 3 + k] += rgb[j] * b[k] * STEP;
      t[j] += rgb[j] * th * STEP;
    }
  });
  return { a, t };
}

export function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), Cc, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

export function mul3(m: number[], n: number[]): number[] {
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

const LUM_TABLE = (() => {
  const n = 256;
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = applyDoppler([1, 1, 1], Math.exp(-LUT_LOG_D_RANGE + (2 * LUT_LOG_D_RANGE * i) / (n - 1)));
    t[i] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  return t;
})();

/**
 * Luminance of a white surface seen with Doppler factor D (colour shift only, no beaming). Beyond the
 * table it holds the edge value, as the shaders' lookup (common.glsl dopplerShift) does.
 */
export function whiteLuminance(D: number): number {
  const x = Math.min(1, Math.max(0, (Math.log(D) + LUT_LOG_D_RANGE) / (2 * LUT_LOG_D_RANGE))) * (LUM_TABLE.length - 1);
  const i = Math.min(LUM_TABLE.length - 2, Math.floor(x));
  return LUM_TABLE[i] + (LUM_TABLE[i + 1] - LUM_TABLE[i]) * (x - i);
}
