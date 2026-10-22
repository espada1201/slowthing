// Spectral colour model used for Doppler shifting.
// An sRGB surface colour is lifted to a full spectrum (a smooth reflectance lit by 5778 K sunlight, which
// reaches into the ultraviolet and infrared, plus the surface's own 300 K thermal glow), Doppler-shifted,
// then re-integrated against the CIE 1931 observer. At D = 1 the round trip returns the original colour.
// The reflectance and the sunlight it reflects can be shifted by different factors (reflectionTransform).

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
const SAMPLE_RGB = SAMPLES.map(wavelengthToRGB);

/** The surface's three reflectance windows at each sample, for its own light shifted by D on the way to the eye. */
const surfaceAt = (D: number) => SAMPLES.map((l) => basisSpectra(l * D));
/** Sunlight at each sample, shifted by D overall on the way to the eye. */
const sunAt = (D: number) => SAMPLES.map((l) => sun(l * D));

/** Σ colour matching × reflectance window k × light: row j (output channel) by column k (surface channel). */
function sum(surface: Vec3[], light: number[]): number[] {
  const a = new Array(9).fill(0);
  SAMPLES.forEach((_, i) => {
    const rgb = SAMPLE_RGB[i];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) a[j * 3 + k] += rgb[j] * surface[i][k] * light[i] * STEP;
  });
  return a;
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

const NORMALISE = invert3(sum(surfaceAt(1), sunAt(1)));

/**
 * Colour of a sunlit surface whose own light is shifted by D_R on its way to the eye while the sunlight it
 * reflects is shifted by D_S overall: observed linear RGB = M · surface RGB, row-major, before any intensity
 * factor. D_R = D_S = D is a surface seen with Doppler factor D. They differ deep in a gravity well (World III:
 * starlight falls in, then climbs out) and on a moving tram (World I: sunlight reaches it shifted by D_in, so
 * D_S = D_in·D_R). A white surface stays white whenever D_S = 1, whatever D_R.
 */
export function reflectionTransform(dR: number, dS: number): number[] {
  return mul3(NORMALISE, sum(surfaceAt(dR), sunAt(dS)));
}

/** A 300 K surface's own thermal glow, seen with Doppler factor D, in linear RGB. */
function thermalGlow(D: number): Vec3 {
  const t = [0, 0, 0];
  SAMPLES.forEach((l, i) => {
    const th = thermal(l * D);
    for (let j = 0; j < 3; j++) t[j] += SAMPLE_RGB[i][j] * th * STEP;
  });
  return [0, 1, 2].map((r) => NORMALISE[r * 3] * t[0] + NORMALISE[r * 3 + 1] * t[1] + NORMALISE[r * 3 + 2] * t[2]) as Vec3;
}

/**
 * Colour transform for a Doppler factor D = ν_observed / ν_emitted (no intensity beaming).
 * Observed linear RGB = matrix · rgb + thermal. `matrix` is row-major 3×3.
 */
export function dopplerColorTransform(D: number): { matrix: number[]; thermal: Vec3 } {
  return { matrix: reflectionTransform(D, D), thermal: thermalGlow(D) };
}

export function applyDoppler(rgb: Vec3, D: number): Vec3 {
  const { matrix: m, thermal: t } = dopplerColorTransform(D);
  return [0, 1, 2].map((r) => m[r * 3] * rgb[0] + m[r * 3 + 1] * rgb[1] + m[r * 3 + 2] * rgb[2] + t[r]) as Vec3;
}

/** Writes a colour matrix as three RGBA texels: texel k holds column k (surface channel k's R, G, B) and alpha[k]. */
export function packColumns(data: Float32Array, texel: (k: number) => number, m: ArrayLike<number>, alpha: readonly number[] = [1, 1, 1]) {
  for (let k = 0; k < 3; k++) data.set([m[k], m[3 + k], m[6 + k], alpha[k]], texel(k) * 4);
}

export const LUT_LOG_D_RANGE = Math.log(60);

/**
 * Lookup table over ln D ∈ [−LUT_LOG_D_RANGE, +LUT_LOG_D_RANGE], 3 rows of RGBA texels.
 * Row k holds the contribution of input channel k (rgb) and, in alpha, thermal glow of output channel k.
 */
export function buildDopplerLUT(size: number): Float32Array {
  const data = new Float32Array(size * 3 * 4);
  for (let i = 0; i < size; i++) {
    const { matrix, thermal: th } = dopplerColorTransform(Math.exp(-LUT_LOG_D_RANGE + (2 * LUT_LOG_D_RANGE * i) / (size - 1)));
    packColumns(data, (k) => k * size + i, matrix, th);
  }
  return data;
}

/**
 * The shaders carry light as its spectrum at the eye, relative to sunlight at rest, sampled at eight knots
 * λ_p = 380·e^{KNOT_STEP·(p − 1)} nm (327–935 nm) and joined by a Catmull-Rom spline in ln λ. For the town's paints,
 * under any shift that leaves them at least a tenth as bright as at rest, that is within 1 % of the full spectral sums
 * (tests/spectrum.test.ts), so a shader can mix and shift light freely.
 */
export const KNOT_STEP = 0.15;
export const KNOTS = Array.from({ length: 8 }, (_, p) => 380 * Math.exp(KNOT_STEP * (p - 1)));

/** Catmull-Rom weight of knot p in the light at λ ∈ [380, 804] nm. */
function knotWeight(p: number, lambda: number): number {
  const u = Math.log(lambda / 380) / KNOT_STEP;
  const seg = Math.min(KNOTS.length - 4, Math.max(0, Math.floor(u)));
  const t = u - seg;
  switch (p - seg) {
    case 0: return ((-t + 2) * t - 1) * t / 2;
    case 1: return ((3 * t - 5) * t * t + 2) / 2;
    case 2: return ((-3 * t + 4) * t + 1) * t / 2;
    case 3: return (t - 1) * t * t / 2;
    default: return 0;
  }
}

const KNOT_LIGHT = KNOTS.map((_, p) => SAMPLES.map((l) => knotWeight(p, l)));
const knotSums = (dR: number) => {
  const surface = surfaceAt(dR);
  return KNOT_LIGHT.map((light) => sum(surface, light));
};
const KNOT_NORMALISE = invert3(knotSums(1).reduce((acc, m, p) => acc.map((v, k) => v + sun(KNOTS[p]) * m[k]), new Array(9).fill(0)));

/**
 * Reflection off a surface whose reflectance is shifted by D_R on its way to the eye, one row-major 3×3 per knot:
 * observed linear RGB = Σ_p L_p · K_p · surface RGB, where L_p is the light at the eye at knot p relative to sunlight
 * at rest, sun(λ_p·D_S) for sunlight shifted by D_S overall (then Σ_p L_p·K_p ≈ reflectionTransform(D_R, D_S)).
 */
export function reflectionKnots(dR: number): number[][] {
  return knotSums(dR).map((m) => mul3(KNOT_NORMALISE, m));
}

/** reflectionKnots over ln D_R ∈ ±LUT_LOG_D_RANGE for shaders/reflect.glsl: texel (i, 3p + k) holds column k of K_p. */
export function buildKnotLUT(size: number): Float32Array {
  const data = new Float32Array(size * KNOTS.length * 3 * 4);
  for (let i = 0; i < size; i++) {
    reflectionKnots(Math.exp(-LUT_LOG_D_RANGE + (2 * LUT_LOG_D_RANGE * i) / (size - 1))).forEach((m, p) => packColumns(data, (k) => (3 * p + k) * size + i, m));
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
