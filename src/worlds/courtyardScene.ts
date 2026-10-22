// The Big ħ courtyard as the visitor sees and walks it: sky and sun, courtyard.ts's walls in stone, the terrace and
// galleries to watch from, the floor and the raised sheet that draw the wave, and the ball.

import * as THREE from 'three';
import floorGlsl from '../shaders/hbar-floor.glsl?raw';
import paletteGlsl from '../shaders/hbar-palette.glsl?raw';
import skyFrag from '../shaders/hbar-sky.frag?raw';
import surfaceFrag from '../shaders/hbar-surface.frag?raw';
import surfaceVert from '../shaders/hbar-surface.vert?raw';
import { BALL, BLOCKS, ENERGY, GLASS_V0, HALF, LANES, type Lane, OBSTACLE_Z, PORCH_Z } from './courtyard';
import { seeded } from './shared';
import type { Quality } from './types';

export const TERRACE_H = 4.4;
const TERRACE_Z0 = 24.4;
const STAIR_Z1 = 31;
/** The two stairs run up the ends of the terrace, inside x = ±STAIR_X … ±HALF, leaving its middle clear for the view. */
const STAIR_X = 21;
export const TERRACE_Z1 = 33;
/** Galleries at terrace height run along both sides, above the outer walls, out to x = ±GALLERY_X. */
export const GALLERY_X = HALF + 3;
const RAIL_H = 1;
/** Launch marks at the head of each lane: the tour rolls its balls from these, straight down the lane. */
export const LAUNCH_Z = 9.75;
const MARKS = [-16.125, 0, 2.625, 16.125];
const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.43).normalize();
const VERMILION = new THREE.Color(0xd2442b);

/** Height of the floor a visitor stands on: the courtyard, a stair at each end of the terrace, the terrace and galleries. */
export function floorHeight(x: number, z: number) {
  if (Math.abs(x) > HALF) return TERRACE_H;
  if (z < TERRACE_Z0) return 0;
  if (Math.abs(x) > STAIR_X && z < STAIR_Z1) return (TERRACE_H * (z - TERRACE_Z0)) / (STAIR_Z1 - TERRACE_Z0);
  return TERRACE_H;
}

/** Footprints a visitor walks around, [x0, x1, z0, z1]. */
export const SOLIDS: [number, number, number, number][] = [
  ...BLOCKS.map((b): [number, number, number, number] => [b.x0, b.x1, b.z0, b.z1]),
  [-STAIR_X, STAIR_X, TERRACE_Z0 - 0.2, TERRACE_Z0 + 0.2],
  [-STAIR_X - 0.15, -STAIR_X + 0.15, TERRACE_Z0 - 0.2, STAIR_Z1],
  [STAIR_X - 0.15, STAIR_X + 0.15, TERRACE_Z0 - 0.2, STAIR_Z1],
  // The gallery edges: a wall seen from the floor, a railing seen from above.
  [-HALF - 0.2, -HALF + 0.05, -HALF - 1, STAIR_Z1],
  [HALF - 0.05, HALF + 0.2, -HALF - 1, STAIR_Z1],
];

/** Box whose UVs are in units of 2 m, so one stone texture tiles at the same scale on every face. */
function stoneBox(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[face][0]) / 2, (uv.getY(i) * dims[face][1]) / 2);
    }
  }
  return g;
}

function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rand = seeded(11);
  g.fillStyle = '#b9ab8e';
  g.fillRect(0, 0, 512, 512);
  for (let r = 0; r < 8; r++) {
    const y = r * 64;
    for (let x = r % 2 ? -64 : 0; x < 512; x += 128) {
      const l = 196 + Math.floor(rand() * 30);
      g.fillStyle = `rgb(${l}, ${l - 10}, ${l - 34})`;
      g.fillRect(x + 3, y + 3, 122, 58);
      for (let s = 0; s < 40; s++) {
        g.fillStyle = `rgba(90, 76, 52, ${rand() * 0.08})`;
        g.fillRect(x + 3 + rand() * 118, y + 3 + rand() * 56, 2 + rand() * 6, 1 + rand() * 3);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Dark absorbing cloth for the detector walls: fine fibres and a seam every metre (texture spans 2 m). */
function feltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(7);
  g.fillStyle = '#48484e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    const l = 30 + Math.floor(rand() * 50);
    g.fillStyle = `rgba(${l}, ${l - 3}, ${l - 1}, 0.5)`;
    g.fillRect(rand() * 256, rand() * 256, 1, 2 + rand() * 5);
  }
  g.fillStyle = 'rgba(8, 8, 10, 0.7)';
  for (const x of [0, 128]) g.fillRect(x, 0, 3, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Text cut into the floor. */
function engraving(lines: string[], width: number) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(28, 26, 22, 0.8)';
    g.font = 'italic 112px "Instrument Serif", Georgia, serif';
    g.fillText(lines[0], 512, 120);
    g.font = '500 40px "IBM Plex Mono", Menlo, monospace';
    g.fillText(lines[1], 512, 204);
    texture.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw).catch(() => {});
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 4).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  mesh.receiveShadow = true;
  return { mesh, texture };
}

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe7d6';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#d2442b';
  g.fillRect(0, 50, 256, 28);
  g.fillStyle = '#15171c';
  for (let i = 0; i < 4; i++) g.fillRect(i * 64 + 30, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The courtyard, built into the world's scene. The world moves the ball, its ghost and the ring, and shows or hides the
 * surface. dispose frees what disposing the scene's meshes does not: the textures and the sun's shadow map.
 */
export class CourtyardScene {
  /** The wave's |ψ|² raised off the floor as a glowing sheet, with a vertex per cell up to 384². */
  surface: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  /** The ball when it is a classical point. */
  readonly ballMesh: THREE.Mesh;
  /** At a wave, a ghost ball at its mean and a ring as wide as its spread. */
  readonly ghost: THREE.Mesh;
  readonly spreadRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  private textures: THREE.Texture[] = [];

  /** The floor and the surface draw the wave from `waveUniforms`, on a grid of n² cells. */
  constructor(private scene: THREE.Scene, private waveUniforms: Record<string, THREE.IUniform>, n: number, quality: Quality) {
    this.buildEnvironment(quality);
    this.surface = this.buildSurface(n);
    scene.add(this.surface);

    const ballTex = ballTexture();
    this.textures.push(ballTex);
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 32, 16), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.55 }));
    this.ballMesh.castShadow = true;
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: VERMILION, emissiveIntensity: 0.6, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.spreadRing = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: VERMILION, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    for (const m of [this.ballMesh, this.ghost, this.spreadRing]) m.visible = false;
    scene.add(this.ballMesh, this.ghost, this.spreadRing);
  }

  /** A new grid of n² cells at a new quality: remake the surface, and size the sun's shadow map. */
  regrid(n: number, quality: Quality) {
    const old = this.surface;
    this.scene.remove(old);
    old.geometry.dispose();
    old.material.dispose();
    this.surface = this.buildSurface(n);
    this.scene.add(this.surface);
    this.setShadowSize(quality);
  }

  dispose() {
    this.sun.shadow.map?.dispose();
    this.textures.forEach((t) => t.dispose());
  }

  private buildEnvironment(quality: Quality) {
    const s = this.scene;
    s.fog = new THREE.Fog(0xd8d3c6, 90, 520);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: skyFrag,
        uniforms: { uSun: { value: SUN_DIR } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    sky.renderOrder = -1;
    sky.onBeforeRender = (_r, _s, cam) => sky.position.copy(cam.position);
    s.add(sky);

    s.add(new THREE.HemisphereLight(0xd6e4f2, 0x8b7b62, 0.9));
    this.sun.position.copy(SUN_DIR).multiplyScalar(80);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -36;
    sc.right = sc.top = 36;
    sc.near = 10;
    sc.far = 180;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.setShadowSize(quality);
    s.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9b927c }));
    // Well below the courtyard floor, so the two never fight for depth when seen from far off.
    ground.position.y = -0.3;
    ground.receiveShadow = true;
    s.add(ground);

    // Courtyard floor: stone paving with the wave drawn into it. Matte (Lambert) surfaces keep their
    // brightness at grazing angles, where a rough standard material with no environment goes dull.
    const floorMat = new THREE.MeshLambertMaterial({ color: 0xe6d8bb });
    floorMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.waveUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFieldPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFieldPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${paletteGlsl}\n${floorGlsl}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloorPattern(diffuseColor.rgb);\nvec3 wave = waveSample();\nwaveInk(wave, diffuseColor.rgb);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += waveLight(wave);');
    };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF).rotateX(-Math.PI / 2), floorMat);
    floor.receiveShadow = true;
    s.add(floor);

    const stoneTex = stoneTexture();
    this.textures.push(stoneTex);
    const stone = new THREE.MeshLambertMaterial({ map: stoneTex });
    const stoneDark = new THREE.MeshLambertMaterial({ color: 0xe2d6bf, map: stoneTex });
    const feltTex = feltTexture();
    this.textures.push(feltTex);
    const felt = new THREE.MeshLambertMaterial({ map: feltTex });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd6cf, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const brass = new THREE.MeshStandardMaterial({ color: 0xa77b2c, roughness: 0.45, metalness: 0.6 });

    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      s.add(m);
      return m;
    };
    const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, mat: THREE.Material, shadow = true) =>
      add(stoneBox(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, shadow);

    // Walls from the same floor plan the wave sees.
    for (const b of BLOCKS) {
      if (b.kind === 'glass') {
        box(b.x0, b.x1, b.z0, b.z1, 0, b.height, glass, false);
        box(b.x0, b.x1, b.z0 - 0.02, b.z1 + 0.02, b.height, b.height + 0.08, brass);
        box(b.x0, b.x1, b.z0 - 0.02, b.z1 + 0.02, 0, 0.06, brass);
      } else {
        box(b.x0, b.x1, b.z0, b.z1, 0, b.height, b.height > 2 ? stone : stoneDark);
      }
    }
    // Columns flanking the two openings, pilasters and a lintel at the doorway (all inside wall footprints).
    const zc = OBSTACLE_Z + 0.1875;
    for (const x of [-3.56, -1.69, 1.69, 3.56]) {
      add(new THREE.CylinderGeometry(0.17, 0.18, 2.6, 20), stone, x, 1.3, zc);
      add(stoneBox(0.42, 0.14, 0.42), stone, x, 2.67, zc);
    }
    for (const x of [-17.065, -15.185]) box(x - 0.18, x + 0.18, OBSTACLE_Z, OBSTACLE_Z + 0.375, 0, 2.6, stone);
    box(-17.25, -15, OBSTACLE_Z - 0.02, OBSTACLE_Z + 0.395, 2.6, 3.0, stone);

    // Galleries along both sides and a back wall; past the obstacles the inner faces are dark absorbers
    // that double as detector plates.
    for (const sx of [-1, 1]) box(sx < 0 ? -GALLERY_X : HALF, sx < 0 ? -HALF : GALLERY_X, -HALF - 0.75, TERRACE_Z1, 0, TERRACE_H, stoneDark);
    box(-GALLERY_X, GALLERY_X, -HALF - 1.25, -HALF - 0.75, 0, TERRACE_H + RAIL_H, stone);
    box(-HALF, HALF, -HALF - 0.75, -HALF, 0, TERRACE_H, stone);
    for (const l of LANES) box(l.x0 + 0.02, l.x1 - 0.02, -HALF, -HALF + 0.04, 0.05, 4, felt, false);
    box(-HALF, -HALF + 0.04, -HALF, PORCH_Z - 0.2, 0.05, 4, felt, false);
    box(HALF - 0.04, HALF, -HALF, PORCH_Z - 0.2, 0.05, 4, felt, false);
    for (const x of [-8.25, 7.875]) {
      box(x - 0.04, x, -HALF, OBSTACLE_Z, 0.05, 3.1, felt, false);
      box(x + 0.375, x + 0.415, -HALF, OBSTACLE_Z, 0.05, 3.1, felt, false);
    }

    // The viewing terrace, with a stair up each end.
    box(-STAIR_X, STAIR_X, TERRACE_Z0, TERRACE_Z1, 0, TERRACE_H, stoneDark);
    const steps = 22;
    for (const sx of [-1, 1]) {
      const [x0, x1] = sx < 0 ? [-HALF, -STAIR_X] : [STAIR_X, HALF];
      box(x0, x1, STAIR_Z1, TERRACE_Z1, 0, TERRACE_H, stoneDark);
      for (let i = 0; i < steps; i++) {
        const z0 = TERRACE_Z0 + ((STAIR_Z1 - TERRACE_Z0) * i) / steps;
        box(x0, x1, z0, STAIR_Z1, 0, (TERRACE_H * (i + 1)) / steps, stone);
      }
      box(sx * STAIR_X - 0.15, sx * STAIR_X + 0.15, TERRACE_Z0, STAIR_Z1, 0, TERRACE_H + 0.9, stone);
    }
    box(-GALLERY_X, GALLERY_X, TERRACE_Z1, TERRACE_Z1 + 0.5, 0, TERRACE_H + 3, stone);

    // Brass railings along the terrace front and the gallery edges.
    const rails: [number, number, number, number][] = [
      [-STAIR_X, STAIR_X, TERRACE_Z0 + 0.06, TERRACE_Z0 + 0.06],
      [-HALF - 0.1, -HALF - 0.1, -HALF - 0.75, STAIR_Z1],
      [HALF + 0.1, HALF + 0.1, -HALF - 0.75, STAIR_Z1],
    ];
    const posts: THREE.Vector3[] = [];
    for (const [x0, x1, z0, z1] of rails) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (const y of [TERRACE_H + RAIL_H, TERRACE_H + 0.5 * RAIL_H]) {
        box(Math.min(x0, x1) - 0.02, Math.max(x0, x1) + 0.02, Math.min(z0, z1) - 0.02, Math.max(z0, z1) + 0.02, y - 0.02, y + 0.02, brass, false);
      }
      const count = Math.round(len / 1.5);
      for (let i = 0; i <= count; i++) posts.push(new THREE.Vector3(x0 + ((x1 - x0) * i) / count, TERRACE_H + RAIL_H / 2, z0 + ((z1 - z0) * i) / count));
    }
    const postMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, RAIL_H, 8), brass, posts.length);
    posts.forEach((p, i) => postMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
    postMesh.castShadow = true;
    s.add(postMesh);

    // Lane names cut into the porch floor.
    const names: Record<Lane, [string, string]> = {
      doorway: ['I · The doorway', 'one opening, 1.5 m'],
      slits: ['II · Two openings', '1.5 m wide, 5.25 m apart'],
      glass: ['III · The glass', `barrier ${GLASS_V0.toFixed(2)} J · ball ${ENERGY.toFixed(2)} J`],
    };
    for (const l of LANES) {
      const e = engraving(names[l.id], 7);
      e.mesh.position.set((l.x0 + l.x1) / 2, 0.004, 16.5);
      s.add(e.mesh);
      this.textures.push(e.texture);
    }

    // Brass launch marks on the porch.
    for (const x of MARKS) add(new THREE.CylinderGeometry(0.24, 0.26, 0.02, 32), brass, x, 0.01, LAUNCH_Z, false);

    // Cypresses beyond the walls.
    const rand = seeded(5);
    const leaf = new THREE.MeshLambertMaterial({ color: 0x55703f });
    for (let i = 0; i < 18; i++) {
      const sx = i % 2 ? 1 : -1;
      const h = 6 + rand() * 3;
      add(new THREE.ConeGeometry(0.9 + rand() * 0.4, h, 10), leaf, sx * (GALLERY_X + 3 + rand() * 3), h / 2 - 0.3, -28 + Math.floor(i / 2) * 5.5 + rand() * 2);
    }
  }

  private buildSurface(n: number) {
    const segs = Math.min(n, 384);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * HALF, 2 * HALF, segs, segs).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        vertexShader: `${paletteGlsl}\n${surfaceVert}`,
        fragmentShader: `${paletteGlsl}\n${surfaceFrag}`,
        uniforms: this.waveUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  }

  private setShadowSize(quality: Quality) {
    const size = quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
}
