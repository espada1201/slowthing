// What the courtyard's detectors leave for the eye: a dot on the walls where each ball was caught, with a brief glow,
// and a mark and a fading flash on the floor where the floor detector fired.

import * as THREE from 'three';
import { DETECTOR_SIGMA, DIVIDER, HALF } from './courtyard';
import { gaussian } from './shared';

const MAX_DOTS = 6000;
const INK = 0x15171c;
/** The detector's flash is a cold cyan, which nothing else in the courtyard shows. */
const DETECTOR_GLOW = new THREE.Color(0.2, 0.9, 1);
const FLASH_TIME = 1.5;
const BEAM_H = 2.4;

/** Soft round glow for the detector dots: overlapping dots add up to bright bands. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.25)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * The detector's response, the Gaussian it multiplies |ψ|² by, as alpha over ±3σ: a round spot for the floor or, for
 * the beam standing over it, across and fading with height.
 */
function detectorTexture(beam: boolean) {
  const data = new Uint8Array(64 * 64 * 4).fill(255);
  for (let row = 0; row < 64; row++) {
    for (let col = 0; col < 64; col++) {
      const u = (col + 0.5) / 32 - 1, v = (row + 0.5) / 32 - 1;
      data[(row * 64 + col) * 4 + 3] = 255 * (beam ? Math.exp(-4.5 * u * u) * (1 - (row + 0.5) / 64) : Math.exp(-4.5 * (u * u + v * v)));
    }
  }
  const t = new THREE.DataTexture(data, 64, 64);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * The detectors' record, built into the world's scene. The world decides what gets recorded; dispose frees what
 * disposing the scene's meshes does not: the textures.
 */
export class DetectorRecord {
  /** Where the floor detector last fired: a spot on the floor and a beam standing over it, as wide as its resolution. */
  private flashSpot: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private flashBeam: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** A brief glow where the latest ball was caught, so a landing reads from across the courtyard. */
  private pulse: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private pulseAge = 1;
  private dots: THREE.InstancedMesh;
  private marks: THREE.InstancedMesh;
  private textures: THREE.Texture[] = [];
  private dotCount = 0;
  private markCount = 0;
  private flashAge = FLASH_TIME;

  constructor(scene: THREE.Scene) {
    const detectorGlow = (beam: boolean) => {
      const map = detectorTexture(beam);
      this.textures.push(map);
      return new THREE.MeshBasicMaterial({ map, color: DETECTOR_GLOW, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    };
    const across = 6 * DETECTOR_SIGMA;
    this.flashSpot = new THREE.Mesh(new THREE.PlaneGeometry(across, across).rotateX(-Math.PI / 2), detectorGlow(false));
    this.flashBeam = new THREE.Mesh(new THREE.PlaneGeometry(across, BEAM_H).translate(0, BEAM_H / 2, 0), detectorGlow(true));
    // Drawn after the wave's sheet, which writes no depth, so the flash shows over the lump it leaves.
    this.flashSpot.renderOrder = this.flashBeam.renderOrder = 3;
    this.pulse = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 32),
      new THREE.MeshBasicMaterial({ color: 0xffb27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    const glow = glowTexture();
    this.textures.push(glow);
    this.dots = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.32, 0.32),
      new THREE.MeshBasicMaterial({ map: glow, color: new THREE.Color(1, 0.42, 0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      MAX_DOTS,
    );
    this.marks = new THREE.InstancedMesh(
      new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      64,
    );
    for (const m of [this.flashSpot, this.flashBeam, this.pulse]) m.visible = false;
    for (const m of [this.dots, this.marks]) {
      m.count = 0;
      m.frustumCulled = false;
    }
    scene.add(this.flashSpot, this.flashBeam, this.pulse, this.dots, this.marks);
  }

  /** A ball caught at (x, z) by the back screen or a side absorber: draw its dot there, glowing. Returns where the dot is. */
  dot(x: number, z: number, where: 'screen' | 'side'): THREE.Vector3 {
    const o = new THREE.Object3D();
    // The floor is two-dimensional, so the height on the plate is free: dots gather in a band at eye level.
    const y = THREE.MathUtils.clamp(1.6 + 0.45 * gaussian(), 0.3, 3.6);
    if (where === 'screen') {
      o.position.set(x, y, -HALF + 0.12);
      o.lookAt(x, y, 0);
    } else {
      const faces = [-HALF, -DIVIDER.outer, -DIVIDER.inner, DIVIDER.inner, DIVIDER.outer, HALF];
      const face = faces.reduce((best, f) => (Math.abs(f - x) < Math.abs(best - x) ? f : best));
      const into = x > face ? 1 : -1;
      o.position.set(face + into * 0.12, y, z);
      o.lookAt(face + into * 2, y, z);
    }
    o.updateMatrix();
    this.pulse.position.copy(o.position).add(new THREE.Vector3(0, 0, 0.01).applyQuaternion(o.quaternion));
    this.pulse.quaternion.copy(o.quaternion);
    this.pulseAge = 0;
    this.dots.setMatrixAt(this.dotCount % MAX_DOTS, o.matrix);
    this.dotCount++;
    this.dots.count = Math.min(this.dotCount, MAX_DOTS);
    this.dots.instanceMatrix.needsUpdate = true;
    return o.position;
  }

  /** The floor detector fired at (x, z): flash there and leave a mark. Returns where the flash is. */
  fire(x: number, z: number): THREE.Vector3 {
    this.flashAge = 0;
    this.flashSpot.position.set(x, 0.03, z);
    this.flashBeam.position.set(x, 0, z);
    this.mark(x, z);
    return this.flashSpot.position.clone();
  }

  clearDots() {
    this.dotCount = 0;
    this.dots.count = 0;
  }

  clearMarks() {
    this.marks.count = this.markCount = 0;
  }

  /** Fade the glow and the flash by dt; the flash's beam faces a viewer looking along `yaw`. */
  update(dt: number, yaw: number) {
    this.pulseAge += dt;
    this.pulse.visible = this.pulseAge < 0.5;
    if (this.pulse.visible) {
      this.pulse.scale.setScalar(0.3 + this.pulseAge * 2);
      this.pulse.material.opacity = 1 - this.pulseAge / 0.5;
    }
    this.flashAge += dt;
    this.flashSpot.visible = this.flashBeam.visible = this.flashAge < FLASH_TIME;
    if (this.flashSpot.visible) {
      // The flash keeps the detector's width while it fades: the tour compares the lump with it.
      this.flashBeam.rotation.y = yaw;
      this.flashSpot.material.opacity = this.flashBeam.material.opacity = 1 - this.flashAge / FLASH_TIME;
    }
  }

  dispose() {
    this.textures.forEach((t) => t.dispose());
  }

  private mark(x: number, z: number) {
    this.marks.setMatrixAt(this.markCount % 64, new THREE.Matrix4().makeTranslation(x, 0.012, z));
    this.markCount++;
    this.marks.count = Math.min(this.markCount, 64);
    this.marks.instanceMatrix.needsUpdate = true;
  }
}
