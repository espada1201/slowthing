// Checks that run in the visitor's own browser: the physics core against textbook results, and the GPU
// shaders the worlds actually use against that independent CPU physics.

import * as THREE from 'three';
import { aberrationAngle, dopplerFactor, lorentzFactor, observerToWorldDirection, retardedTime } from './physics/relativity';
import { Schrodinger2D, barrierTransmission, freeSpreadWidth, stableTimeStep } from './physics/schrodinger';
import { CRITICAL_IMPACT, exactDeflection, traceRay, tracedDeflection } from './physics/schwarzschild';
import { applyDoppler, cieXYZ } from './physics/spectrum';
import { type Vec3, add, dot, len, scale, sub } from './physics/vec';
import compositeFrag from './shaders/slow-composite.frag?raw';
import movingVert from './shaders/slow-moving.vert?raw';
import { cameraRotation, fullscreenPass } from './worlds/shared';

export interface ProofResult {
  pass: boolean;
  measured: string;
  expected: string;
}

export interface Proof {
  id: string;
  world: 'I' | 'II' | 'III';
  gpu: boolean;
  title: string;
  claim: string;
  run: (renderer: THREE.WebGLRenderer) => Promise<ProofResult> | ProofResult;
}

const fmt = (x: number) => (x === 0 ? '0' : Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4 ? x.toExponential(1) : Math.abs(x) < 1 ? x.toPrecision(2) : x.toFixed(2));
const deg = Math.PI / 180;

function within(errors: number[], tol: number, unit = ''): ProofResult {
  const worst = Math.max(...errors);
  return { pass: worst <= tol, measured: `max error ${fmt(worst)}${unit}`, expected: `≤ ${fmt(tol)}${unit}` };
}

// ---------- GPU harness for World I's composite shader ----------

const AB_BETA = new THREE.Vector3(0.3, 0.1, -0.7);
const AB_YAW = 0.4, AB_PITCH = 0.2, W = 48, H = 32;

/** Fill a cube map like the world does, render the real composite shader into a float target, read it back. */
function runComposite(renderer: THREE.WebGLRenderer, cubeFrag: string, uniforms: Record<string, number>) {
  const cube = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter });
  const scene = new THREE.Scene();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vDir; void main() { vec3 d = normalize(vDir); ${cubeFrag} }`,
      side: THREE.BackSide,
    }),
  );
  scene.add(sphere);
  const cam = new THREE.CubeCamera(0.1, 100, cube);
  cam.update(renderer, scene);

  const pass = fullscreenPass(compositeFrag, {
    uCube: { value: cube.texture },
    uBeta: { value: AB_BETA.clone() },
    uCamRot: { value: cameraRotation(AB_YAW, AB_PITCH) },
    uTan: { value: new THREE.Vector2(Math.tan(37.5 * deg) * (W / H), Math.tan(37.5 * deg)) },
    uAberration: { value: 1 },
    uDoppler: { value: uniforms.doppler },
    uBeaming: { value: 0 },
    uExposure: { value: 1 },
  });
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(pass.scene, pass.camera);
  const pixels = new Float32Array(W * H * 4);
  renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
  renderer.setRenderTarget(previous);
  target.dispose();
  pass.dispose();
  cube.dispose();
  sphere.geometry.dispose();
  (sphere.material as THREE.Material).dispose();
  return pixels;
}

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The observer-frame and scenery-frame directions the CPU physics predicts for pixel (i, j). */
function pixelDirections(i: number, j: number) {
  const R = cameraRotation(AB_YAW, AB_PITCH).elements;
  const tx = Math.tan(37.5 * deg) * (W / H), ty = Math.tan(37.5 * deg);
  const x = (((i + 0.5) / W) * 2 - 1) * tx, y = (((j + 0.5) / H) * 2 - 1) * ty;
  const l = Math.hypot(x, y, 1);
  const nObs: Vec3 = [(R[0] * x + R[3] * y - R[6]) / l, (R[1] * x + R[4] * y - R[7]) / l, (R[2] * x + R[5] * y - R[8]) / l];
  const beta: Vec3 = [AB_BETA.x, AB_BETA.y, AB_BETA.z];
  const nW = observerToWorldDirection(nObs, beta);
  return { nObs, nW, D: dopplerFactor(nW, beta) };
}

// ---------- GPU harness for World I's moving objects ----------

/** Test points of a tram car and of a carousel lamp: (along the track, up, outward), as slow-moving.vert takes them. */
const CAR: Vec3[] = [[0, 0, 0], [3.7, 0, 0], [-3.7, 0, 0], [0, 3.5, 0], [0, 0, 1.35], [0, 0, -1.35], [3.7, 3.5, 1.35], [-3.7, 0.3, -1.35], [1.8, 1.2, 0.6]];
const LAMP: Vec3[] = [[0, 3, 0], [0.5, 3, 0], [-0.5, 3, 0], [0, 3.5, 0], [0, 2.5, 0], [0, 3, 0.5], [0, 3, -0.5], [0.35, 3.35, 0.35], [-0.35, 2.65, -0.35]];

/** An object on a circle (centre and eye given as ground-plane x, z; angle = where it is now, in radians). */
interface Mover {
  c: number;
  beta: number;
  radius: number;
  dir: 1 | -1;
  eye: [number, number];
  angle: number;
  centre?: [number, number];
  contract?: boolean;
  delay?: boolean;
  points: Vec3[];
}

const MOVERS: Mover[] = [
  // The tram at the default c, seen from inside its loop and from 200 m out (where unguarded Newton put it 90 m astray).
  { c: 12, beta: 0.894, radius: 45, dir: 1, eye: [0, 30], angle: 1.2, points: CAR },
  { c: 12, beta: 0.894, radius: 45, dir: 1, eye: [4, 200], angle: 4.9, points: CAR },
  // Near light speed down to the slowest c, beside the track and far out, with and without contraction.
  { c: 8, beta: 0.95, radius: 45, dir: 1, eye: [25, 0], angle: 6.0, points: CAR },
  { c: 4, beta: 0.95, radius: 45, dir: 1, eye: [200, -4], angle: 3.7, points: CAR },
  { c: 6, beta: 0.9, radius: 45, dir: -1, eye: [-46.5, 3], angle: -3.3, contract: false, points: CAR },
  // Slower, off-centre loops, seen from up to 260 m.
  { c: 30, beta: 0.3, radius: 45, dir: -1, centre: [3, -2], eye: [-60, 250], angle: -5.5, points: CAR },
  { c: 20, beta: 0.6, radius: 45, dir: 1, centre: [-5, 8], eye: [40, 60], angle: 0.7, points: CAR },
  // Carousel lamps, from inside the ring, beside it and across town.
  { c: 4, beta: 0.9, radius: 7, dir: -1, eye: [2.5, -1], angle: -1.2, points: LAMP },
  { c: 6, beta: 0.9, radius: 7, dir: -1, eye: [0, 19], angle: -4.6, points: LAMP },
  { c: 8, beta: 0.85, radius: 7, dir: -1, eye: [-180, 160], angle: -1.0, points: LAMP },
  // Light delay switched off: drawn where it is now.
  { c: 12, beta: 0.894, radius: 45, dir: 1, eye: [0, 100], angle: 4.0, delay: false, points: CAR },
];
const MW = Math.max(...MOVERS.map((m) => m.points.length)), MH = MOVERS.length;

/** slow-moving.vert's pathPos, independently: where test point `local` of a mover is at town time s (now = 0). */
function moverPath({ c, beta, radius, dir, angle, centre = [0, 0], contract = true }: Mover, local: Vec3) {
  const omega = (dir * beta * c) / radius, squash = contract ? Math.sqrt(1 - beta * beta) : 1;
  return (s: number): Vec3 => {
    const a = angle + omega * s;
    const radial: Vec3 = [Math.cos(a), 0, Math.sin(a)], forward: Vec3 = [-dir * Math.sin(a), 0, dir * Math.cos(a)];
    return add(add([centre[0], local[1], centre[1]], scale(radial, radius + local[2])), scale(forward, local[0] * squash));
  };
}

/** Run the real slow-moving.vert on every test point, each drawn as a GL point on its own pixel, and read back where it put them. */
function runMovers(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  MOVERS.forEach(({ c, beta, radius, dir, eye, angle, centre = [0, 0], contract = true, delay = true, points }, j) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('aReadout', new THREE.Float32BufferAttribute(points.flatMap((_, i) => [((i + 0.5) / MW) * 2 - 1, ((j + 0.5) / MH) * 2 - 1]), 2));
    const material = new THREE.ShaderMaterial({
      vertexShader: movingVert,
      fragmentShader: 'varying vec3 vWorld; varying float vTau; void main() { gl_FragColor = vec4(vWorld, vTau); }',
      defines: { PROOF: '' },
      uniforms: {
        uObs: { value: new THREE.Vector3(eye[0], 1.7, eye[1]) },
        uC: { value: c },
        uPhase: { value: angle },
        uOmega: { value: (dir * beta * c) / radius },
        uRadius: { value: radius },
        uCenter: { value: new THREE.Vector3(centre[0], 0, centre[1]) },
        uGamma: { value: lorentzFactor(beta) },
        uBeta: { value: beta },
        uRetard: { value: delay ? 1 : 0 },
        uContract: { value: contract ? 1 : 0 },
        uTauNow: { value: 0 },
      },
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    scene.add(cloud);
  });
  const target = new THREE.WebGLRenderTarget(MW, MH, { type: THREE.FloatType, depthBuffer: false });
  const pixels = new Float32Array(MW * MH * 4);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, new THREE.Camera());
    renderer.readRenderTargetPixels(target, 0, 0, MW, MH, pixels);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    scene.traverse((o) => {
      if (o instanceof THREE.Points) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  return pixels;
}

export const PROOFS: Proof[] = [
  {
    id: 'lorentz',
    world: 'I',
    gpu: false,
    title: 'Lorentz factor, aberration, Doppler',
    claim: 'γ(0.6) = 1.25; a source at 90° appears at 60° when β = 0.5; head-on Doppler at β = 0.6 is exactly 2.',
    run: () =>
      within(
        [
          Math.abs(lorentzFactor(0.6) - 1.25),
          Math.abs(aberrationAngle(90 * deg, 0.5) / deg - 60),
          Math.abs(dopplerFactor([0, 0, 1], [0, 0, 0.6]) - 2),
        ],
        1e-9,
      ),
  },
  {
    id: 'retarded',
    world: 'I',
    gpu: false,
    title: 'Light-delay solver',
    claim: 'The CPU light-cone solver, which times the carousel bells and is the reference for the GPU light-delay check, matches the closed-form solution for straight-line motion.',
    run: () => {
      const c = 10, x0: Vec3 = [-30, 0, 5], u: Vec3 = [8, 0, 0], obs: Vec3 = [0, 1.7, 0], t = 4;
      const tr = retardedTime((s) => add(x0, scale(u, s)), () => u, obs, t, c);
      const d = sub(obs, x0);
      const A = dot(u, u) - c * c, B = -2 * dot(d, u) + 2 * c * c * t, C = dot(d, d) - c * c * t * t;
      const past = Math.min((-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A), (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A));
      return within([Math.abs(tr - past)], 1e-9, ' s');
    },
  },
  {
    id: 'cie',
    world: 'I',
    gpu: false,
    title: 'Colour vision',
    claim: 'The colour-matching functions used for every Doppler shift reproduce the CIE 1931 standard observer table.',
    run: () => {
      const table: [number, Vec3][] = [[450, [0.3362, 0.038, 1.7721]], [500, [0.0049, 0.323, 0.272]], [555, [0.5121, 1.0, 0.0057]], [600, [1.0622, 0.631, 0.0008]], [650, [0.2835, 0.107, 0.0]]];
      return within(table.flatMap(([l, ref]) => cieXYZ(l).map((v, k) => Math.abs(v - ref[k]))), 0.03);
    },
  },
  {
    id: 'gpu-aberration',
    world: 'I',
    gpu: true,
    title: 'GPU aberration shader',
    claim: 'The shader that bends your view at speed sends every pixel to the direction the Lorentz transformation predicts.',
    run: (r) => {
      const px = runComposite(r, 'gl_FragColor = vec4(0.4 + 0.3 * d, 1.0);', { doppler: 0 });
      const errors: number[] = [];
      for (let j = 0; j < H; j++)
        for (let i = 0; i < W; i++) {
          const o = (j * W + i) * 4;
          const gpu: Vec3 = [0, 1, 2].map((k) => (srgbToLinear(px[o + k]) - 0.4) / 0.3) as Vec3;
          const { nW } = pixelDirections(i, j);
          errors.push(Math.acos(Math.min(1, dot(gpu, nW) / len(gpu))) / deg);
        }
      return within(errors, 0.3, '°');
    },
  },
  {
    id: 'gpu-doppler',
    world: 'I',
    gpu: true,
    title: 'GPU spectral Doppler shader',
    claim: 'The colour each pixel shows matches a full spectral integration (sunlight, reflectance, 300 K glow, CIE observer) at that pixel’s Doppler factor.',
    run: (r) => {
      const px = runComposite(r, 'gl_FragColor = vec4(0.3, 0.3, 0.3, 1.0);', { doppler: 1 });
      const errors: number[] = [];
      for (let j = 0; j < H; j += 3)
        for (let i = 0; i < W; i += 3) {
          const o = (j * W + i) * 4;
          const cpu = applyDoppler([0.3, 0.3, 0.3], pixelDirections(i, j).D);
          for (let k = 0; k < 3; k++) errors.push(Math.abs(srgbToLinear(px[o + k]) - cpu[k]));
        }
      return within(errors, 0.01);
    },
  },
  {
    id: 'gpu-retarded',
    world: 'I',
    gpu: true,
    title: 'GPU light-delay shader',
    claim: 'The vertex shader that draws trams and lamps where they were when their light left puts every vertex where the CPU light-cone solver does, from inside the loop to 260 m away, at up to 0.95 c.',
    run: (r) => {
      const px = runMovers(r);
      const offBy: number[] = [], late: number[] = [];
      MOVERS.forEach((m, j) =>
        m.points.forEach((local, i) => {
          const path = moverPath(m, local);
          const vel = (s: number) => scale(sub(path(s + 1e-4), path(s - 1e-4)), 5e3);
          const tr = m.delay === false ? 0 : retardedTime(path, vel, [m.eye[0], 1.7, m.eye[1]], 0, m.c, 40);
          const o = (j * MW + i) * 4;
          offBy.push(len(sub([px[o], px[o + 1], px[o + 2]], path(tr))));
          // The shader's clock reading (uTauNow = 0) is the emission time in the object's own time.
          late.push(Math.abs(px[o + 3] * lorentzFactor(m.beta) - tr));
        }),
      );
      const pos = Math.max(...offBy), time = Math.max(...late);
      return {
        pass: pos <= 1e-3 && time <= 1e-4,
        measured: `${offBy.length} vertices at most ${fmt(pos * 1e3)} mm from the CPU, emission times within ${fmt(time * 1e3)} ms`,
        expected: '≤ 1 mm and ≤ 0.1 ms (float32 rounding at up to 260 m, amplified near head-on approach)',
      };
    },
  },
  {
    id: 'norm',
    world: 'II',
    gpu: false,
    title: 'Probability is conserved',
    claim: 'The leapfrog scheme keeps total probability fixed through walls and barriers, to rounding error.',
    run: () => {
      const p = { mass: 1, hbar: 1 }, grid = { nx: 64, ny: 64, dx: 0.25 };
      const sim = new Schrodinger2D(grid, p, stableTimeStep(grid, p, 4));
      for (let j = 0; j < 64; j++) {
        sim.open[j * 64 + 40] = j > 26 && j < 38 ? 1 : 0;
        sim.potential[j * 64 + 20] = 4;
      }
      sim.setGaussian(4, 8, 1, 3, 0);
      const n0 = sim.norm();
      sim.step(600);
      return within([Math.abs(sim.norm() - n0)], 1e-9);
    },
  },
  {
    id: 'spread',
    world: 'II',
    gpu: false,
    title: 'A free wave packet spreads',
    claim: 'A Gaussian packet widens as σ₀√(1 + (ħt/2mσ₀²)²), the textbook free-particle result.',
    run: () => {
      const p = { mass: 1, hbar: 1 }, grid = { nx: 128, ny: 128, dx: 0.2 };
      const sim = new Schrodinger2D(grid, p, stableTimeStep(grid, p, 0));
      sim.setGaussian(12.8, 12.8, 1, 0, 0);
      sim.step(Math.round(2 / sim.dt));
      const m = sim.moments();
      const expect = freeSpreadWidth(1, sim.time, p);
      return { ...within([Math.abs(m.sx / expect - 1), Math.abs(m.sy / expect - 1)], 0.01), expected: `σ = ${expect.toFixed(4)} within 1%` };
    },
  },
  {
    id: 'tunnel',
    world: 'II',
    gpu: false,
    title: 'Quantum tunnelling',
    claim: 'The fraction of a packet that leaks through a barrier it classically cannot cross matches the analytic transmission coefficient.',
    run: () => {
      const p = { mass: 1, hbar: 1 }, dx = 0.05, grid = { nx: 2400, ny: 2, dx, periodicY: true };
      const k0 = 4, sigma = 6, V0 = 10, a = 0.6, x1 = 60;
      const sim = new Schrodinger2D(grid, p, stableTimeStep(grid, p, V0));
      for (let i = 0; i < grid.nx; i++) if (i * dx >= x1 && i * dx < x1 + a - 1e-9) sim.potential[i] = sim.potential[grid.nx + i] = V0;
      sim.setGaussian(30, 0, sigma, k0, 0);
      sim.step(Math.round(15 / sim.dt));
      const d = sim.density();
      let through = 0, total = 0;
      for (let i = 0; i < grid.nx; i++) {
        total += d[i] + d[grid.nx + i];
        if (i * dx >= x1 + a) through += d[i] + d[grid.nx + i];
      }
      let num = 0, den = 0;
      for (let q = -5; q <= 5; q += 0.02) {
        const k = k0 + q / (2 * sigma), w = Math.exp(-0.5 * q * q);
        num += w * barrierTransmission((k * k) / 2, V0, a, p);
        den += w;
      }
      const T = num / den, got = through / total;
      return { pass: Math.abs(got / T - 1) < 0.05, measured: `T = ${got.toFixed(4)}`, expected: `${T.toFixed(4)} ± 5%` };
    },
  },
  {
    id: 'bending',
    world: 'III',
    gpu: false,
    title: 'Light bending',
    claim: 'Rays traced like the black-hole shader bend by the exact Schwarzschild integral, and by 4GM/c²b far from the hole.',
    run: () => {
      const errs = [3, 4, 8].map((b) => Math.abs(tracedDeflection(b, 1, 0.006) / exactDeflection(b, 1) - 1));
      errs.push(Math.abs(tracedDeflection(300, 1, 0.006) / (2 / 300) - 1));
      return { ...within(errs, 0.02), measured: `max relative error ${fmt(Math.max(...errs))}`, expected: '≤ 2%' };
    },
  },
  {
    id: 'capture',
    world: 'III',
    gpu: false,
    title: 'Photon sphere and shadow',
    claim: 'Rays with impact parameter below 3√3/2 rs fall in and rays above escape, which sets the size of the shadow.',
    run: () => {
      const bc = CRITICAL_IMPACT;
      const inside = traceRay([-400, bc * 0.98, 0], [1, 0, 0], 1, { stepScale: 0.01 }).captured;
      const outside = !traceRay([-400, bc * 1.02, 0], [1, 0, 0], 1, { stepScale: 0.01 }).captured;
      return { pass: inside && outside, measured: `0.98 b꜀ ${inside ? 'captured' : 'escaped'}, 1.02 b꜀ ${outside ? 'escaped' : 'captured'}`, expected: 'captured, escaped' };
    },
  },
];

/** GPU proofs that live with their world's shaders, loaded on demand. */
export async function worldProofs(): Promise<Proof[]> {
  const out: Proof[] = [];
  const [h, g] = await Promise.all([import('./worlds/bigHbar'), import('./worlds/bigG')]);
  const solver = (h as Record<string, unknown>).proveSolver as Proof['run'] | undefined;
  const rays = (g as Record<string, unknown>).proveRays as Proof['run'] | undefined;
  if (solver) out.push({ id: 'gpu-schrodinger', world: 'II', gpu: true, title: 'GPU Schrödinger solver', claim: 'The courtyard’s fragment-shader solver produces the same wavefunction as the CPU reference, step for step.', run: solver });
  if (rays) out.push({ id: 'gpu-geodesics', world: 'III', gpu: true, title: 'GPU black-hole ray-marcher', claim: 'Every pixel’s light path through the shader ends where the CPU geodesic integrator says it should.', run: rays });
  return out;
}
