// World I's GPU checks for the Proofs page: the shaders the world draws with, run on this GPU and held to the
// independent CPU physics. proofs.ts lists them and loads this file only when the page runs.

import * as THREE from 'three';
import { dopplerFactor, lorentzFactor, observerToWorldDirection, retardedTime, sourceDopplerFactor } from '../physics/relativity';
import { simultaneousTime } from '../physics/simultaneity';
import { skyLight } from '../physics/skylight';
import { applyDoppler, reflectionTransform } from '../physics/spectrum';
import { type Vec3, add, dot, len, normalize, scale, sub } from '../physics/vec';
import { type ProofResult, deg, fmt, within } from '../proofs';
import { cameraRotation, fullscreenPass } from './shared';
import { compositeFragment, movingFragment, movingUniforms, movingVertex } from './slowShaders';

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

  const pass = fullscreenPass(compositeFragment, {
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

/**
 * Draw each row's points with its material, point i of row j on pixel (i, j) of a float target `width` wide (the
 * material puts it there from aReadout), and read the target back.
 */
function readPoints(renderer: THREE.WebGLRenderer, width: number, rows: { attributes: Record<string, number[][]>; material: THREE.ShaderMaterial }[]): Float32Array {
  const scene = new THREE.Scene();
  rows.forEach(({ attributes, material }, j) => {
    const geometry = new THREE.BufferGeometry();
    for (const [name, values] of Object.entries(attributes)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(values.flat(), values[0].length));
    geometry.setAttribute('aReadout', new THREE.Float32BufferAttribute(attributes.position.flatMap((_, i) => [((i + 0.5) / width) * 2 - 1, ((j + 0.5) / rows.length) * 2 - 1]), 2));
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    scene.add(cloud);
  });
  const target = new THREE.WebGLRenderTarget(width, rows.length, { type: THREE.FloatType, depthBuffer: false });
  const pixels = new Float32Array(width * rows.length * 4);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, new THREE.Camera());
    renderer.readRenderTargetPixels(target, 0, 0, width, rows.length, pixels);
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
  /** The eye's velocity / c, which decides its now when light delay is off. */
  eyeBeta?: Vec3;
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
  // Light delay switched off: drawn where it is at the eye's now, standing, cruising past at 0.9 c and sprinting at 0.98 c.
  { c: 12, beta: 0.894, radius: 45, dir: 1, eye: [0, 100], angle: 4.0, delay: false, points: CAR },
  { c: 12, beta: 0.894, radius: 45, dir: 1, eye: [4, 30], eyeBeta: [0, 0, -0.9], angle: 1.2, delay: false, points: CAR },
  { c: 12, beta: 0.894, radius: 45, dir: 1, eye: [4, 200], eyeBeta: [0, 0, -0.9], angle: 4.9, delay: false, points: CAR },
  { c: 12, beta: 0.735, radius: 7, dir: -1, eye: [10, -4], eyeBeta: [-0.9, 0, 0], angle: -2.0, delay: false, points: LAMP },
  { c: 4, beta: 0.95, radius: 45, dir: 1, eye: [200, -4], eyeBeta: [0.3, 0, -0.93], angle: 3.7, delay: false, points: CAR },
];
const MW = Math.max(...MOVERS.map((m) => m.points.length));

/** slow-moving.vert's pathPos, independently: where test point `local` of a mover is at town time s (now = 0). */
function moverPath({ c, beta, radius, dir, angle, centre = [0, 0], contract = true }: Mover, local: Vec3) {
  const omega = (dir * beta * c) / radius, squash = contract ? Math.sqrt(1 - beta * beta) : 1;
  return (s: number): Vec3 => {
    const a = angle + omega * s;
    const radial: Vec3 = [Math.cos(a), 0, Math.sin(a)], forward: Vec3 = [-dir * Math.sin(a), 0, dir * Math.cos(a)];
    return add(add([centre[0], local[1], centre[1]], scale(radial, radius + local[2])), scale(forward, local[0] * squash));
  };
}

/** Run the real slow-moving.vert on every test point and read back where it put them. */
function runMovers(renderer: THREE.WebGLRenderer) {
  const rows = MOVERS.map(({ c, beta, radius, dir, eye, eyeBeta = [0, 0, 0], angle, centre = [0, 0], contract = true, delay = true, points }) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: movingVertex,
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
        uObsBeta: { value: new THREE.Vector3(...eyeBeta) },
      },
    });
    return { attributes: { position: points }, material };
  });
  return readPoints(renderer, MW, rows);
}

// ---------- GPU harness for World I's moving surfaces ----------

/** One face of a tram, as slow-moving.vert hands it to slow-moving.frag. */
interface TramFace {
  colour: Vec3;
  normal: Vec3;
  at: Vec3;
  /** A head or tail lamp (pattern 2), which glows instead of reflecting. */
  lamp?: boolean;
}

/** The faces of a tram moving at `velocity`, seen by an eye at `eye` moving at `eyeBeta`, under one pair of switches. */
interface TramDraw {
  velocity: Vec3;
  eye: Vec3;
  eyeBeta: Vec3;
  colourOn: boolean;
  beamOn: boolean;
  faces: TramFace[];
}

const TRAM_SUN = normalize([0.45, 0.62, -0.64]);
const TRAM_PAINTS = [0xc8553d, 0xf0e6cf].map((h) => new THREE.Color(h).toArray() as Vec3);
/** The colours of the tram's head and tail lamps. */
const TRAM_LAMPS = [0xfff2c0, 0xff3b1f].map((h) => new THREE.Color(h).toArray() as Vec3);

/** Tram faces and lamps at three speeds, seen from ahead, beside and behind, standing and cruising, under each pair of switches. */
function tramDraws(): TramDraw[] {
  const draws: TramDraw[] = [];
  const a = 0.7;
  const radial: Vec3 = [Math.cos(a), 0, Math.sin(a)], forward: Vec3 = [-Math.sin(a), 0, Math.cos(a)];
  const centre = scale(radial, 45);
  for (const beta of [0.6, 0.894, 0.986])
    for (const eye of [add(centre, add(scale(forward, 30), scale(radial, -6))), add(centre, scale(radial, 12)), sub(centre, scale(forward, 25))])
      for (const eyeBeta of [[0, 0, 0], [-0.5, 0, 0.33]] as Vec3[])
        for (const [colourOn, beamOn] of [[true, true], [true, false], [false, true]]) {
          const faces: TramFace[] = [];
          for (const normal of [forward, scale(forward, -1), radial, scale(radial, -1), [0, 1, 0]] as Vec3[])
            for (const [k, colour] of TRAM_PAINTS.entries()) faces.push({ colour, normal, at: add(add(centre, scale(normal, 1.3)), [0, k ? 3 : 1.2, 0]) });
          for (const [k, colour] of TRAM_LAMPS.entries()) {
            const normal = scale(forward, k ? -1 : 1);
            faces.push({ colour, normal, at: add(add(centre, scale(normal, 3.62)), [0, 1.3, 0]), lamp: true });
          }
          draws.push({ velocity: scale(forward, beta), eye: [eye[0], 1.7, eye[2]], eyeBeta, colourOn, beamOn, faces });
        }
  return draws;
}

/** What slow-moving.vert works out for a face at `at`: the sun's direction and Doppler factor in the tram's frame, and
 * the factors its light picks up on the way to the eye (the tram's own, the eye's own, and both). */
function tramShifts({ velocity, eye, eyeBeta }: TramDraw, at: Vec3) {
  const toEye = normalize(sub(eye, at));
  const dSrc = sourceDopplerFactor(velocity, toEye), dObs = dopplerFactor(scale(toEye, -1), eyeBeta);
  return { sunLocal: observerToWorldDirection(TRAM_SUN, scale(velocity, -1)), dIn: dopplerFactor(TRAM_SUN, velocity), dSrc, dObs, dOut: dSrc * dObs };
}
type TramShifts = ReturnType<typeof tramShifts>;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const apply3 = (m: number[], c: Vec3): Vec3 => [0, 1, 2].map((r) => m[r * 3] * c[0] + m[r * 3 + 1] * c[1] + m[r * 3 + 2] * c[2]) as Vec3;
const luminance = (c: Vec3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * The colour a tram face sends to the eye, from the full spectral sums: sunlight aberrated into the tram's frame and
 * shifted by D_in, sky light integrated over the half of the sky the face sees, each reflected and shifted by D_out on
 * the way to the eye, plus the face's 300 K glow. The face's lighting (diffuse sun, tinted sky, ground shadow) is
 * slow-surface.glsl's. A lamp glows at 2.4 times its colour, and only its own light is shifted, by D_out.
 */
function exactTramColour({ velocity, colourOn, beamOn }: TramDraw, f: TramFace, { sunLocal, dIn, dOut }: TramShifts): Vec3 {
  const seen = (col: Vec3) => col.map((v) => Math.min(v * (beamOn ? dOut ** 5 : 1), 6e4)) as Vec3;
  if (f.lamp) {
    const glow = scale(f.colour, 2.4);
    return seen(colourOn ? (applyDoppler(glow, dOut).map((v) => Math.max(v, 0)) as Vec3) : glow);
  }
  const ao = 0.72 + 0.28 * smoothstep(0, 2.5, f.at[1]);
  const hemi = 0.5 + 0.5 * f.normal[1];
  const sunlit = f.colour.map((c, k) => c * Math.max(dot(f.normal, sunLocal), 0) * [1, 0.95, 0.86][k] * 0.9 * ao) as Vec3;
  const skylit = f.colour.map((c, k) => c * ([0.32, 0.28, 0.24][k] + ([0.55, 0.66, 0.82][k] - [0.32, 0.28, 0.24][k]) * hemi) * 0.42 * ao) as Vec3;
  const beta = len(velocity), x = dot(f.normal, scale(velocity, 1 / beta)), eta = Math.atanh(beta);
  const sunGain = beamOn ? dIn ** 3 : 1;
  let col: Vec3;
  if (colourOn) {
    const sun = apply3(reflectionTransform(dOut, dIn * dOut), sunlit);
    const sky = apply3(skyLight(x, eta, beamOn ? 5 : 0, (D) => reflectionTransform(dOut, D * dOut), 128), skylit);
    const glow = applyDoppler([0, 0, 0], dOut);
    col = [0, 1, 2].map((k) => Math.max(sunGain * sun[k] + sky[k], 0) + Math.max(glow[k], 0)) as Vec3;
  } else {
    const beam = skyLight(x, eta, 5, () => [1], 128)[0];
    col = [0, 1, 2].map((k) => sunlit[k] * sunGain + skylit[k] * beam) as Vec3;
  }
  return seen(col);
}

/** Run the real slow-moving.frag on every face, handed the shifts slow-moving.vert would, and read back its colour. */
function runTramFaces(renderer: THREE.WebGLRenderer, draws: TramDraw[], shifts: TramShifts[][]) {
  const width = Math.max(...draws.map((d) => d.faces.length));
  const tables = movingUniforms();
  const rows = draws.map(({ velocity, eye, eyeBeta, colourOn, beamOn, faces }, j) => ({
    attributes: {
      position: faces.map((f) => f.at),
      normal: faces.map((f) => f.normal),
      aColor: faces.map((f) => f.colour),
      aPattern: faces.map((f) => [f.lamp ? 2 : 0]),
      aVelocity: faces.map(() => velocity),
      aSunLocal: shifts[j].map((s) => s.sunLocal),
      aShift: shifts[j].map((s) => [s.dSrc, s.dIn]),
    },
    material: new THREE.ShaderMaterial({
      vertexShader: `attribute vec3 aColor; attribute float aPattern; attribute vec3 aVelocity; attribute vec3 aSunLocal; attribute vec2 aShift; attribute vec2 aReadout;
        varying vec3 vColor; varying vec3 vNormal; varying vec3 vWorld; varying float vPattern;
        varying float vDsrc; varying float vTau; varying float vDin; varying vec3 vSunLocal; varying vec3 vVelocity;
        void main() {
          vColor = aColor; vNormal = normal; vWorld = position; vPattern = aPattern;
          vDsrc = aShift.x; vTau = 0.0; vDin = aShift.y; vSunLocal = aSunLocal; vVelocity = aVelocity;
          gl_Position = vec4(aReadout, 0.0, 1.0);
          gl_PointSize = 1.0;
        }`,
      fragmentShader: movingFragment,
      uniforms: {
        ...tables,
        uBlinkPeriod: { value: 1 },
        uBeta: { value: len(velocity) },
        uObs: { value: new THREE.Vector3(...eye) },
        uObsBeta: { value: new THREE.Vector3(...eyeBeta) },
        uDopplerOn: { value: colourOn ? 1 : 0 },
        uBeamingOn: { value: beamOn ? 1 : 0 },
      },
    }),
  }));
  return { pixels: readPoints(renderer, width, rows), width };
}

/** The composite shader's aberration: each pixel's scenery direction against observerToWorldDirection. */
export function proveAberration(r: THREE.WebGLRenderer): ProofResult {
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
}

/** The composite shader's colour shift: every third pixel's colour against the spectral integration at its Doppler factor. */
export function proveDoppler(r: THREE.WebGLRenderer): ProofResult {
  const px = runComposite(r, 'gl_FragColor = vec4(0.3, 0.3, 0.3, 1.0);', { doppler: 1 });
  const errors: number[] = [];
  for (let j = 0; j < H; j += 3)
    for (let i = 0; i < W; i += 3) {
      const o = (j * W + i) * 4;
      const cpu = applyDoppler([0.3, 0.3, 0.3], pixelDirections(i, j).D);
      for (let k = 0; k < 3; k++) errors.push(Math.abs(srgbToLinear(px[o + k]) - cpu[k]));
    }
  return within(errors, 0.01);
}

/** slow-moving.vert's light delay, and its now with delay off: each test point's position and clock against the CPU light-cone and simultaneity solvers. */
export function proveRetarded(r: THREE.WebGLRenderer): ProofResult {
  const px = runMovers(r);
  const offBy: number[] = [], late: number[] = [];
  MOVERS.forEach((m, j) =>
    m.points.forEach((local, i) => {
      const path = moverPath(m, local);
      const vel = (s: number) => scale(sub(path(s + 1e-4), path(s - 1e-4)), 5e3);
      const eye: Vec3 = [m.eye[0], 1.7, m.eye[1]];
      const tr = m.delay === false ? simultaneousTime(path, vel, { x: eye, t: 0, beta: m.eyeBeta ?? [0, 0, 0] }, m.c, 40) : retardedTime(path, vel, eye, 0, m.c, 40);
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
}

/** slow-moving.frag: each face's colour against exactTramColour, and the 1 / D_obs it hands the composite. */
export function proveTramColour(r: THREE.WebGLRenderer): ProofResult {
  const draws = tramDraws();
  const shifts = draws.map((d) => d.faces.map((f) => tramShifts(d, f.at)));
  const { pixels, width } = runTramFaces(r, draws, shifts);
  let worst = 0, worstLamp = 0, handOff = 0, checked = 0, lamps = 0;
  draws.forEach((d, j) =>
    d.faces.forEach((f, i) => {
      const o = (j * width + i) * 4;
      // The composite multiplies by its own D_obs, so the face must hand it 1 / D_obs.
      handOff = Math.max(handOff, Math.abs(pixels[o + 3] * shifts[j][i].dObs - 1));
      const want = exactTramColour(d, f, shifts[j][i]);
      // Faces too dark to see (under 2 % of a white wall in sunshine) are not held to a relative error.
      if (luminance(want) < 0.02) return;
      const error = Math.max(...want.map((v, k) => Math.abs(pixels[o + k] - v) / luminance(want)));
      if (f.lamp) {
        worstLamp = Math.max(worstLamp, error);
        lamps++;
      } else {
        worst = Math.max(worst, error);
        checked++;
      }
    }),
  );
  return {
    pass: Math.max(worst, worstLamp) <= 0.03 && handOff <= 1e-4 && checked > 100 && lamps > 30,
    measured: `${checked} faces and ${lamps} lamps, worst colour error ${fmt(worst * 100)} % and ${fmt(worstLamp * 100)} % of their brightness, 1 / D_obs handed on within ${fmt(handOff)}`,
    expected: '≤ 3 % (the shader carries light at eight wavelengths and looks the sky up in tables) and ≤ 1e-4',
  };
}
