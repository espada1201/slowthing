import * as THREE from 'three';
import { SKY_BEAM, SKY_ETA, SKY_X, buildSkyLUT } from './physics/skylight';
import { KNOTS, LUT_LOG_D_RANGE, LUT_SIZE, buildDopplerLUT, buildKnotLUT } from './physics/spectrum';

let doppler: THREE.DataTexture | null = null;
let knots: THREE.DataTexture | null = null;
let sky: THREE.DataTexture | null = null;

function table(data: Float32Array, width: number, height: number) {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Uniforms for shaders/common.glsl. The table is built once (≈30 ms) and shared. */
export function lutUniforms() {
  doppler ??= table(buildDopplerLUT(), LUT_SIZE, 3);
  return { uLut: { value: doppler }, uLutSize: { value: LUT_SIZE }, uLutRange: { value: LUT_LOG_D_RANGE } };
}

/** Uniforms for shaders/reflect.glsl, on the Doppler LUT's grid (add lutUniforms too). Built once (≈40 ms). */
export function knotUniforms() {
  knots ??= table(buildKnotLUT(), LUT_SIZE, KNOTS.length * 3);
  return { uKnots: { value: knots } };
}

/** Uniforms for the sky light on moving surfaces in shaders/slow-surface.frag. Built once (≈60 ms). */
export function skyUniforms() {
  sky ??= table(buildSkyLUT(), SKY_BEAM + 1, SKY_X * SKY_ETA);
  return { uSky: { value: sky } };
}
