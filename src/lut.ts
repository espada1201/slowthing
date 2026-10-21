import * as THREE from 'three';
import { LUT_LOG_D_RANGE, buildDopplerLUT } from './physics/spectrum';

const SIZE = 512;
let texture: THREE.DataTexture | null = null;

/** Uniforms for shaders/common.glsl. The table is built once (≈20 ms) and shared. */
export function lutUniforms() {
  if (!texture) {
    texture = new THREE.DataTexture(buildDopplerLUT(SIZE), SIZE, 3, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
  }
  return { uLut: { value: texture }, uLutSize: { value: SIZE }, uLutRange: { value: LUT_LOG_D_RANGE } };
}
