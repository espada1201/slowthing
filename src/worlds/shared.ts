import * as THREE from 'three';
import common from '../shaders/common.glsl?raw';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import { lutUniforms } from '../lut';
import type { Pose, View } from './types';

/** Rotation from camera space (−z forward) to world space for a yaw/pitch pair. */
export function cameraRotation(yaw: number, pitch: number): THREE.Matrix3 {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  return new THREE.Matrix3().setFromMatrix4(m);
}

/** The ray a shader casts through point (u, v) of the view, counted from its bottom-left corner in [0, 1]². */
export function viewRay({ rot, tan }: View, u: number, v: number): THREE.Vector3 {
  return new THREE.Vector3((2 * u - 1) * tan.x, (2 * v - 1) * tan.y, -1).applyMatrix3(rot).normalize();
}

/** The point (u, v) of the view that looks along direction d, or null if d is behind the camera. */
export function viewPoint({ rot, tan }: View, d: THREE.Vector3): THREE.Vector2 | null {
  // A rotation's transpose is its inverse: back from world to camera space, where the view looks along −z.
  const c = d.clone().applyMatrix3(rot.clone().transpose());
  return c.z < 0 ? new THREE.Vector2(0.5 - c.x / (2 * c.z * tan.x), 0.5 - c.y / (2 * c.z * tan.y)) : null;
}

/** A pose at `position` looking at `target`. */
export function facing(position: [number, number, number], target: [number, number, number] = [0, 0, 0]): Pose {
  const d = new THREE.Vector3(target[0] - position[0], target[1] - position[1], target[2] - position[2]).normalize();
  return { position, yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(d.y) };
}

export function forwardFlat(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function rightFlat(yaw: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** A full-screen triangle drawn with the given fragment shader (common.glsl is prepended). */
export function fullscreenPass(fragment: string, uniforms: Record<string, THREE.IUniform>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: `${common}\n${fragment}`,
    uniforms: { ...lutUniforms(), ...uniforms },
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, camera: new THREE.Camera(), material, dispose: () => (geometry.dispose(), material.dispose()) };
}

/** Give a geometry a flat colour and a surface pattern id (see slow-surface.glsl). */
export function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, pattern = 0): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  g.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aPattern', new THREE.BufferAttribute(new Float32Array(n).fill(pattern), 1));
  g.deleteAttribute('uv');
  return g;
}

/** Deterministic pseudo-random numbers so the town is the same every visit. */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format seconds as h:mm:ss.s for clocks. */
export function clockString(seconds: number): string {
  const s = ((seconds % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
}
