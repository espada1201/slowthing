// World III — turn G up until a granite boulder becomes a black hole. Every pixel is a light ray marched
// through Schwarzschild spacetime (shaders/big-g.frag, same maths as physics/schwarzschild.ts); the
// observer hovers, so the readouts are a static observer's clock rate and frequency shift.

import * as THREE from 'three';
import { tick } from '../audio';
import { REAL, formatSI } from '../constants';
import type { InputState } from '../input';
import { knotUniforms } from '../lut';
import { TABLES_GLSL } from '../physics/skylight';
import { CRITICAL_IMPACT, PHOTON_SPHERE, asymptoticDirection, einsteinRingRadius, gravitationalShift, rsFromShadow, schwarzschildRadius, shadowAngularRadius, timeDilation, traceRay } from '../physics/schwarzschild';
import { type Vec3, dot, normalize } from '../physics/vec';
import rayFrag from '../shaders/big-g.frag?raw';
import reflect from '../shaders/reflect.glsl?raw';
import { cameraRotation, facing, fullscreenPass, viewRay } from './shared';
import type { Pose, Quality, Readout, Toggle, TourStop, View, World, WorldContext } from './types';

/** A granite boulder: 2 m radius, 2700 kg/m³. */
const MASS = 9.0e4;
const ROCK_R = 2;
/** Buchdahl's theorem: no static ball of matter can be smaller than 9/8 of its Schwarzschild radius. */
const COLLAPSE_RS = (8 / 9) * ROCK_R;
const DECK: [number, number] = [12, 48];
/** The shader works in units where rs ≤ this, so r⁵ never overflows. */
const MAX_SCENE_RS = 20;
const SUN = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
const PLANET_DIR = new THREE.Vector3(0.55, 0.28, -1).normalize();
const PLANET_AXIS = new THREE.Vector3(0.35, 1, 0.25).normalize();
const GALAXY = new THREE.Vector3(0.25, 0.9, 0.36).normalize();
const FOV = 75;
const MIN_WIDE_FOV = 60;
const QUALITY: Record<Quality, { k: number; steps: number }> = {
  low: { k: 0.08, steps: 200 },
  medium: { k: 0.05, steps: 350 },
  high: { k: 0.03, steps: 600 },
};

/** G that gives the boulder a Schwarzschild radius rs (at the real c). */
const gFor = (rs: number) => (rs * REAL.c ** 2) / (2 * MASS);

const LAMPS: { pos: THREE.Vector3; color: THREE.Color; radius: number }[] = [
  // Buoys hovering close to the hole: their light climbs out visibly redshifted.
  ...[0, 1, 2, 3].map((i) => ({
    pos: new THREE.Vector3(Math.cos((i + 0.5) * (Math.PI / 2)) * 7.5, 0, Math.sin((i + 0.5) * (Math.PI / 2)) * 7.5),
    color: new THREE.Color(0xfff1d6),
    radius: 0.45,
  })),
  // Coloured beacons above the deck.
  ...[0xd2442b, 0xe0a458, 0x2f7f79, 0xefe7d6, 0x5b6c8f, 0xa77b2c].map((hex, i) => ({
    pos: new THREE.Vector3(Math.cos(i * (Math.PI / 3) + 0.26) * 30, 2.5, Math.sin(i * (Math.PI / 3) + 0.26) * 30),
    color: new THREE.Color(hex),
    radius: 1.2,
  })),
];

const frag = `${TABLES_GLSL}\n${reflect}\n${rayFrag}`;

/** Uniforms for shaders/big-g.frag; per-frame values are filled in by the world (or the proof). */
function rayUniforms(): Record<string, THREE.IUniform> {
  return {
    ...knotUniforms(),
    uCamPos: { value: new THREE.Vector3() },
    uCamRot: { value: new THREE.Matrix3() },
    uTan: { value: new THREE.Vector2(1, 1) },
    uScale: { value: 1 },
    uRs: { value: 0 },
    uBend: { value: 1 },
    uHorizon: { value: 0 },
    uRock: { value: ROCK_R },
    uDeck: { value: new THREE.Vector2(...DECK) },
    uLamps: { value: LAMPS.map(() => new THREE.Vector3()) },
    uLampColors: { value: LAMPS.map((l) => l.color) },
    uLampRadii: { value: LAMPS.map((l) => l.radius) },
    uLampDist: { value: LAMPS.map((l) => l.pos.length()) },
    uSteps: { value: 350 },
    uK: { value: 0.05 },
    uFar: { value: 200 },
    uRedshift: { value: 1 },
    uGuide: { value: 0 },
    uShadow: { value: -1 },
    uPixel: { value: 0.001 },
    uSun: { value: SUN },
    uPlanetDir: { value: PLANET_DIR },
    uPlanetAxis: { value: PLANET_AXIS },
    uPlanetSize: { value: THREE.MathUtils.degToRad(5) },
    uGalaxy: { value: GALAXY },
    uDebug: { value: 0 },
  };
}

const START = facing([0, 6, 38]);
/**
 * Weighing the hole: 80 m (20 rs) from a 4 m hole, high above the deck so that none of it hides the shadow's edge,
 * looking a little below the hole so that on a phone the shadow sits clear of the tour card.
 */
const WEIGH_RS = 4;
const WEIGH = facing([0, 76.8, 22.4], [0, 0, 15]);
/** The Einstein ring: 20 rs from a 10 m hole, with the gas giant right behind it. */
const RING = { r: 200, rs: 10 };
const EINSTEIN = facing(PLANET_DIR.clone().multiplyScalar(-RING.r).toArray() as [number, number, number]);

const degrees = (radians: number, digits = 1) => `${THREE.MathUtils.radToDeg(radians).toFixed(digits)}°`;

/** What weighing the hole works from: your distance from its centre and its Schwarzschild radius, in metres. */
interface HoleState {
  r: number;
  rs: number;
}

export class BigGWorld implements World<HoleState> {
  readonly id = 'big-g';
  readonly title = 'Big G';
  readonly dials = ['G' as const];
  readonly preset = { G: gFor(4.5) };
  readonly start = START;
  readonly actions = [{ id: 'face', label: 'Face the hole', key: 'KeyF' }];
  readonly toggles: Toggle[] = [
    { id: 'lensing', label: 'Light bending', hint: 'Off: draw light in straight lines, for comparison', value: true },
    { id: 'redshift', label: 'Gravitational shift', hint: 'Light changes colour and brightness climbing in or out of the well', value: true },
    { id: 'guide', label: 'Shadow edge', hint: 'Dashed circle: where light just grazes the photon sphere at 1.5 rs', value: false },
  ];
  readonly tour: TourStop<HoleState>[] = [
    {
      title: 'A black hole from a boulder',
      text: 'This was a 90-tonne granite boulder. With G turned up 3.4×10²² times it has collapsed into a black hole 9 m across, and everything around it is light bent by its gravity.',
      pose: START,
      constants: { G: gFor(4.5) },
      toggles: { guide: false },
    },
    {
      title: 'The real universe',
      text: 'The same boulder with the real G. Light passes it dead straight, and a clock on its surface loses one second in a million billion years.',
      pose: facing([2.5, 1.5, 8]),
      constants: { G: REAL.G },
      predict: {
        question: 'With the real G, how big is this boulder’s Schwarzschild radius?',
        options: ['About a millimetre', 'About the size of an atom', 'Far smaller than a proton'],
        answer: 2,
        reveal: 'rs = 2GM/c² = 1.3×10⁻²² m. Gravity is so weak that a whole boulder would need squeezing six million times smaller than a proton to become a black hole.',
      },
    },
    {
      title: 'Gravity you can see',
      text: 'At rs = 0.9 m the rock bends light around itself. It looks bigger than it is, you can see round to its far side, and stars behind it smear into arcs.',
      pose: facing([2.5, 1.5, 8]),
      constants: { G: gFor(0.9) },
    },
    {
      title: 'Collapse',
      text: 'Past rs = 1.78 m (Buchdahl’s limit, R = 9/8 rs) no material can hold the rock up. It falls inside its own horizon, and all that is left to see is its shadow.',
      pose: facing([3, 2, 13]),
      constants: { G: gFor(1.9) },
      toggles: { guide: true },
      predict: {
        question: 'Seen from far away, how wide is a black hole’s shadow?',
        options: ['Exactly the size of the horizon', 'About 2.6 times wider', 'Smaller than the horizon'],
        answer: 1,
        reveal: 'Any light aimed within b = 3√3/2 rs ≈ 2.6 rs of the centre spirals in, so the shadow is about 2.6 times wider than the horizon. The dashed circle marks its edge.',
      },
    },
    {
      title: 'Weigh the hole',
      text: 'Astronomers weigh real black holes like this. In 2019 the Event Horizon Telescope imaged the shadow of the black hole in the galaxy M87; its size and distance gave a mass of 6.5 billion Suns.',
      pose: WEIGH,
      constants: { G: gFor(WEIGH_RS) },
      toggles: { guide: false },
      measure: {
        question: 'How heavy is this black hole?',
        steps: [
          'Turn on the Ruler and mark opposite edges of the shadow, the black disc with no stars in it. Half the angle between the marks is its radius α.',
          'Solve sin α = (3√3/2)(rs/r)√(1 − rs/r) for rs, with your distance r from the instruments. Leave the square root out at first, then put that rs into the square root and solve again.',
          // shortcut: prints the G this stop sets, which is stale once the visitor turns the G dial here; build this step from the live G if it should follow the dial.
          `Then M = rs c²/(2G), with c = 3.00×10⁸ m/s and G = ${formatSI(gFor(WEIGH_RS))} m³/kg·s².`,
        ],
        given: ['Your distance r'],
        asks: [
          { symbol: 'rs', unit: 'm' },
          { symbol: 'M', unit: 'kg' },
        ],
        answer: ({ r, rs }) => {
          const alpha = shadowAngularRadius(r, rs);
          return {
            values: [rs, MASS],
            reveal: `The hole has rs = ${formatSI(rs)} m and M = rs c²/(2G) = ${formatSI(MASS)} kg: the 90-tonne boulder you started with. At ${formatSI(r)} m its shadow’s radius is ${degrees(alpha, 2)}, which gives rs = ${formatSI(rsFromShadow(alpha, r, 1))} m with the square root left out and ${formatSI(rsFromShadow(alpha, r))} m with it put back.`,
          };
        },
      },
    },
    {
      title: 'Einstein ring',
      text: `Line the gas giant up behind the hole and its light comes round every side at once, into a ring ${degrees(einsteinRingRadius(RING.r, RING.rs))} out from the middle of the shadow. The usual formula √(2rs/r) gives only ${degrees(Math.sqrt((2 * RING.rs) / RING.r))}: it assumes light bends just a little, which is true only far from a hole.`,
      pose: EINSTEIN,
      constants: { G: gFor(RING.rs) },
      toggles: { guide: false },
    },
    {
      title: 'Over the top',
      text: 'From just above the deck, the far side of the platform appears lifted over the hole: its light climbs over the top to reach you. The buoys near the hole glow redder than the beacons further out.',
      pose: facing([0, 2.2, 27], [0, 1.5, 0]),
      constants: { G: gFor(4.5) },
    },
    {
      title: 'The photon sphere',
      text: 'At 1.5 rs light can orbit the hole. Hovering at 2 rs the shadow already covers 30% of your whole sky; look sideways and its edge is light that has circled the hole.',
      pose: facing([0, 0.8, 9], [10, 0.8, 9]),
      constants: { G: gFor(4.5) },
      toggles: { guide: true },
    },
    {
      title: 'Slow clocks, blue sky',
      text: 'At 1.2 rs your clock runs at 41% of a distant one, so a far-off beacon pulsing once a second ticks 2.4 times a second here (turn Sound on). Looking outward, the whole universe is squeezed into a window ahead; the shadow fills almost three-quarters of your sky.',
      pose: facing([0, 0.6, 5.4], [0, 0.6, 30]),
      constants: { G: gFor(4.5) },
      toggles: { guide: false },
      predict: {
        question: 'Hovering just outside the horizon, how does starlight from far away look to you?',
        options: ['Redder and dimmer', 'Unchanged', 'Bluer and brighter'],
        answer: 2,
        reveal: 'Light gains energy falling into the well: at 1.2 rs its frequency is 2.4 times higher, the same factor by which your clock runs slow.',
      },
    },
  ];

  private pass = fullscreenPass(frag, rayUniforms());
  private pos = new THREE.Vector3(...START.position);
  private rs = 0;
  private faceHole = false;
  /** Phase of a far-away beacon that pulses once per second of its own time. */
  private beacon = 0;

  private toggle(id: string) {
    return this.toggles.find((t) => t.id === id)!.value;
  }

  private get collapsed() {
    return this.rs >= COLLAPSE_RS;
  }

  setPose(p: Pose) {
    this.pos.set(...p.position);
  }

  runAction(id: string) {
    if (id === 'face') this.faceHole = true;
  }

  setQuality() {
    // The step budget is read from ctx.quality every frame.
  }

  /** Keep the observer outside the horizon (or the rock), off the deck surface and out of the lamps. */
  private constrain() {
    if (this.pos.lengthSq() < 1e-12) this.pos.set(0, 0, 1);
    const minR = this.collapsed ? 1.05 * this.rs : ROCK_R + 0.5;
    const maxR = Math.max(800, 60 * this.rs);
    const r = this.pos.length();
    if (r < minR) this.pos.setLength(minR);
    if (r > maxR) this.pos.setLength(maxR);
    const flat = Math.hypot(this.pos.x, this.pos.z);
    if (flat > DECK[0] - 0.3 && flat < DECK[1] + 0.3 && Math.abs(this.pos.y) < 0.3) this.pos.y = this.pos.y < 0 ? -0.3 : 0.3;
    for (const l of LAMPS) {
      const d = this.pos.clone().sub(l.pos);
      if (d.length() < l.radius + 0.4) this.pos.copy(l.pos).add(d.setLength(l.radius + 0.4));
    }
  }

  frame(dt: number, input: InputState, ctx: WorldContext) {
    const { G, c } = ctx.constants;
    this.rs = schwarzschildRadius(G, MASS, c);
    if (this.faceHole) {
      const f = facing(this.pos.toArray() as [number, number, number]);
      input.yaw = f.yaw;
      input.pitch = f.pitch;
      this.faceHole = false;
    }
    const rot = cameraRotation(input.yaw, input.pitch);
    const wish = new THREE.Vector3(input.move.x, 0, -input.move.z).applyMatrix3(rot);
    wish.y += input.move.y;
    if (wish.lengthSq() > 0) {
      // Fly speed grows with distance so the far tour stops are reachable; near the hole it is a walk.
      const speed = (input.sprint ? 24 : 6) * Math.max(1, (this.pos.length() - this.rs) / 30);
      this.pos.addScaledVector(wish.normalize(), speed * dt);
    }
    this.constrain();
    // A beacon far away pulses once a second; hovering deep in the well you receive the pulses faster and higher.
    const rate = Math.max(1e-3, timeDilation(this.pos.length(), this.rs));
    this.beacon += dt / rate;
    if (this.beacon >= 1) {
      this.beacon %= 1;
      tick(660 / rate, 0.6);
    }

    const S = Math.max(1, this.rs / MAX_SCENE_RS);
    const r = this.pos.length();
    const q = QUALITY[ctx.quality];
    const u = this.pass.material.uniforms;
    const size = ctx.renderer.getDrawingBufferSize(new THREE.Vector2());
    const aspect = size.x / Math.max(1, size.y);
    // A portrait phone keeps at least a 60° wide view, so the shadow and the light ring round it still fit.
    const tanX = Math.max(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * aspect, Math.tan(THREE.MathUtils.degToRad(MIN_WIDE_FOV / 2)));
    const tanY = tanX / aspect;
    u.uTan.value.set(tanX, tanY);
    u.uPixel.value = (2 * tanY) / size.y;
    u.uCamRot.value.copy(rot);
    u.uCamPos.value.copy(this.pos).divideScalar(S);
    u.uScale.value = S;
    u.uRs.value = this.rs / S;
    u.uBend.value = this.toggle('lensing') ? 1 : 0;
    u.uHorizon.value = this.collapsed ? this.rs / S : 0;
    u.uRock.value = this.collapsed ? 0 : ROCK_R / S;
    u.uDeck.value.set(DECK[0] / S, DECK[1] / S);
    LAMPS.forEach((l, i) => {
      u.uLamps.value[i].copy(l.pos).divideScalar(S);
      u.uLampRadii.value[i] = l.pos.length() > this.rs * 1.02 ? l.radius / S : -1;
      u.uLampDist.value[i] = l.pos.length() / S;
    });
    u.uSteps.value = q.steps;
    u.uK.value = q.k;
    u.uFar.value = Math.max(30 * this.rs, 1.2 * r, 60) / S;
    u.uRedshift.value = this.toggle('redshift') ? 1 : 0;
    u.uGuide.value = this.toggle('guide') ? 1 : 0;
    u.uShadow.value = this.collapsed ? shadowAngularRadius(r, this.rs) : -1;
    ctx.renderer.setRenderTarget(null);
    ctx.renderer.render(this.pass.scene, this.pass.camera);
  }

  readouts(): Readout[] {
    const rs = this.rs;
    const r = this.pos.length();
    const rate = timeDilation(r, rs);
    const alpha = shadowAngularRadius(r, rs);
    const pct = (100 * (1 - Math.cos(alpha))) / 2;
    const sky = pct >= 10 ? pct.toFixed(0) : pct >= 0.1 ? pct.toFixed(1) : '<0.1';
    const shadow = !this.collapsed ? 'no horizon' : alpha < Math.PI / 2 ? `${degrees(2 * alpha)} · ${sky}% of sky` : `${sky}% of sky`;
    return [
      { label: 'Schwarzschild radius', value: `${formatSI(rs)} m` },
      { label: 'Your distance r', value: `${formatSI(r)} m` },
      { label: 'r / rs', value: formatSI(r / rs), gauge: Math.min(1, rs / r) },
      { label: 'Your clock rate', value: rate.toFixed(4), gauge: rate },
      { label: '1 min here', value: `${formatSI(1 / rate)} min far away` },
      { label: 'Starlight', value: `×${gravitationalShift(Infinity, r, rs).toFixed(3)} frequency` },
      { label: 'Shadow', value: shadow },
    ];
  }

  status() {
    const rs = this.rs;
    if (rs < 1e-6) return `rs is ${formatSI(ROCK_R / rs, 2)} times smaller than the boulder: nothing visibly bends.`;
    if (!this.collapsed) return `Still a rock: rs is ${Math.round((100 * rs) / ROCK_R)}% of its radius. It collapses past rs = ${COLLAPSE_RS.toFixed(2)} m.`;
    if (rs > DECK[1]) return 'The horizon has swallowed the whole scene. Only the sky is left outside.';
    return `Black hole. Light can orbit at 1.5 rs = ${formatSI(PHOTON_SPHERE * rs)} m.`;
  }

  view(): View {
    const u = this.pass.material.uniforms;
    return { rot: u.uCamRot.value, tan: u.uTan.value };
  }

  measureState(): HoleState {
    return { r: this.pos.length(), rs: this.rs };
  }

  dispose() {
    this.pass.dispose();
  }
}

/**
 * In-browser proof that the GPU ray-marcher bends light like the CPU reference: render a 48×32 debug image
 * from a fixed pose at 5 rs, decode each pixel's escape direction and compare with traceRay +
 * asymptoticDirection (physics/schwarzschild.ts, itself tested against the exact orbit integral).
 */
export async function proveRays(renderer: THREE.WebGLRenderer): Promise<{ pass: boolean; measured: string; expected: string }> {
  const W = 48, H = 32, rs = 4.5, steps = 2000;
  const { k } = QUALITY.medium;
  const cam: Vec3 = [4, 3, 22];
  const pose = facing(cam, [0.6, 0.3, 0]);
  const rot = cameraRotation(pose.yaw, pose.pitch);
  const tanY = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const tanX = (tanY * W) / H;
  const view = { rot, tan: new THREE.Vector2(tanX, tanY) };
  const r = Math.hypot(...cam);
  const far = Math.max(30 * rs, 1.2 * r, 60);

  const pass = fullscreenPass(frag, rayUniforms());
  const u = pass.material.uniforms;
  u.uDebug.value = 1;
  u.uCamPos.value.set(...cam);
  u.uCamRot.value.copy(rot);
  u.uTan.value.set(tanX, tanY);
  u.uRs.value = rs;
  u.uHorizon.value = rs;
  u.uRock.value = 0;
  u.uDeck.value.set(0, 0);
  u.uLampRadii.value = LAMPS.map(() => -1);
  u.uSteps.value = steps;
  u.uK.value = k;
  u.uFar.value = far;
  const target = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false });
  const pixels = new Float32Array(W * H * 4);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(pass.scene, pass.camera);
    renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
  } finally {
    renderer.setRenderTarget(previous);
    target.dispose();
    pass.dispose();
  }

  let considered = 0, agree = 0, compared = 0, maxErr = 0, maxBend = 0;
  const bc = CRITICAL_IMPACT * rs;
  const rhat = normalize(cam);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const v = viewRay(view, (i + 0.5) / W, (j + 0.5) / H);
      const n: Vec3 = [v.x, v.y, v.z];
      // Rays within a hair of the critical impact parameter wind round the photon sphere and amplify any
      // rounding; they are left out (b is conserved, so this is decided before tracing).
      const radial = dot(n, rhat);
      const b = (Math.sqrt(Math.max(0, 1 - radial * radial)) * r) / Math.sqrt(1 - rs / r);
      if (Math.abs(b / bc - 1) < 0.01) continue;
      const ray = traceRay(cam, n, rs, { stepScale: k, rFar: far, maxSteps: steps });
      const o = (j * W + i) * 4;
      const alpha = pixels[o + 3];
      const gpuState = alpha < 0.25 ? 'captured' : alpha < 0.75 ? 'unfinished' : 'escaped';
      considered++;
      if ((gpuState === 'captured') === ray.captured && gpuState !== 'unfinished') agree++;
      if (gpuState === 'escaped' && !ray.captured) {
        const cpu = asymptoticDirection(ray.position, ray.direction, rs);
        const gpu = normalize([(pixels[o] - 0.4) / 0.3, (pixels[o + 1] - 0.4) / 0.3, (pixels[o + 2] - 0.4) / 0.3]);
        maxErr = Math.max(maxErr, THREE.MathUtils.radToDeg(Math.acos(Math.min(1, dot(cpu, gpu)))));
        maxBend = Math.max(maxBend, THREE.MathUtils.radToDeg(Math.acos(Math.min(1, dot(cpu, n)))));
        compared++;
      }
    }
  }
  const agreement = considered ? (100 * agree) / considered : 0;
  return {
    pass: compared > 0 && maxErr <= 0.5 && agreement >= 99.9,
    measured: `${maxErr.toFixed(3)}° worst direction error over ${compared} escaping rays (bent by up to ${maxBend.toFixed(0)}°); ${agreement.toFixed(1)}% agree on capture (${considered} rays)`,
    expected: '≤ 0.5° and ≥ 99.9% agreement (rays within 1% of the critical impact parameter 3√3/2 rs excluded)',
  };
}
