import * as THREE from 'three';
import { SKY_RAPIDITY_MAX, buildIlluminationLUT, buildSkyLUT } from './physics/reflection';
import { LUT_LOG_D_RANGE, buildDopplerLUT } from './physics/spectrum';

const SIZE = 512;
let texture: THREE.DataTexture | null = null;
let illumination: THREE.DataTexture | null = null;
let sky: THREE.DataTexture | null = null;
const SKY_X = 17;
const SKY_ETA = 32;

function table(data: Float32Array, width: number, height = 3) {
  const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Uniforms for shaders/common.glsl. The table is built once (≈20 ms) and shared. */
export function lutUniforms() {
  texture ??= table(buildDopplerLUT(SIZE), SIZE);
  return { uLut: { value: texture }, uLutSize: { value: SIZE }, uLutRange: { value: LUT_LOG_D_RANGE } };
}

/** Uniforms for the tables of shifted sunlight and sky light that light moving surfaces (shaders/slow-surface.frag). */
export function illuminationUniforms() {
  illumination ??= table(buildIlluminationLUT(256, LUT_LOG_D_RANGE), 256);
  sky ??= table(buildSkyLUT(SKY_X, SKY_ETA), SKY_X, SKY_ETA * 7);
  return {
    uIllum: { value: illumination },
    uIllumSize: { value: 256 },
    uIllumRange: { value: LUT_LOG_D_RANGE },
    uSky: { value: sky },
    uSkySize: { value: new THREE.Vector3(SKY_X, SKY_ETA, SKY_RAPIDITY_MAX) },
  };
}
