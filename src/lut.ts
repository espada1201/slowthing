import * as THREE from 'three';
import { SKY_HALF, SKY_RAPIDITY_MAX, SKY_STEP, SKY_TEXELS, buildSkyLUT } from './physics/skylight';
import { KNOTS, LUT_LOG_D_RANGE, buildDopplerLUT, buildKnotLUT } from './physics/spectrum';

/** Shifts in the Doppler and reflection tables, over ln D ∈ ±LUT_LOG_D_RANGE: fine enough for the 12 nm edges of
 * the reflectance windows. */
export const LUT_SIZE = 1024;
/** Face directions and rapidities in the sky-light table. */
export const SKY_X = 33;
export const SKY_ETA = 32;
let doppler: THREE.DataTexture | null = null;
let knots: THREE.DataTexture | null = null;
let sky: { spectrum: THREE.DataTexture; beam: THREE.DataTexture } | null = null;

function table(data: Float32Array, width: number, height: number) {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Uniforms for shaders/common.glsl. The table is built once (≈30 ms) and shared. */
export function lutUniforms() {
  doppler ??= table(buildDopplerLUT(LUT_SIZE), LUT_SIZE, 3);
  return { uLut: { value: doppler }, uLutSize: { value: LUT_SIZE }, uLutRange: { value: LUT_LOG_D_RANGE } };
}

/** Uniforms for shaders/reflect.glsl, on the Doppler LUT's grid (add lutUniforms too). Built once (≈40 ms). */
export function knotUniforms() {
  knots ??= table(buildKnotLUT(LUT_SIZE), LUT_SIZE, KNOTS.length * 3);
  return { uKnots: { value: knots } };
}

/** Uniforms for the sky light on moving surfaces in shaders/slow-surface.frag. Built once (≈60 ms). */
export function skyUniforms() {
  if (!sky) {
    const { spectrum, beam } = buildSkyLUT(SKY_X, SKY_ETA);
    sky = { spectrum: table(spectrum, 2 * SKY_TEXELS, SKY_X * SKY_ETA), beam: table(beam, SKY_X, SKY_ETA) };
  }
  return {
    uSky: { value: sky.spectrum },
    uSkyBeam: { value: sky.beam },
    uSkySize: { value: new THREE.Vector4(SKY_X, SKY_ETA, SKY_RAPIDITY_MAX, SKY_TEXELS) },
    uSkyGrid: { value: new THREE.Vector2(SKY_STEP, SKY_HALF) },
  };
}
