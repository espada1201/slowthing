// World II — a courtyard where Planck's constant is big enough to see. A rolled ball is a wavepacket
// evolved by the time-dependent Schrödinger equation on the GPU; when its wavelength is too small to
// resolve (as it is at the real ħ) the ball is a classical point instead.

import * as THREE from 'three';
import { click } from '../audio';
import { REAL, formatSI } from '../constants';
import type { InputState } from '../input';
import { Schrodinger2D, barrierTransmission, cumulative, deBroglieWavelength, meanWavevector, sampleIndex, stableTimeStep } from '../physics/schrodinger';
import floorGlsl from '../shaders/hbar-floor.glsl?raw';
import paletteGlsl from '../shaders/hbar-palette.glsl?raw';
import skyFrag from '../shaders/hbar-sky.frag?raw';
import surfaceFrag from '../shaders/hbar-surface.frag?raw';
import surfaceVert from '../shaders/hbar-surface.vert?raw';
import {
  BALL,
  BLOCKS,
  DETECTOR_RESOLUTION,
  DETECTOR_SIGMA,
  ENERGY,
  type Field,
  GLASS_SIGMA,
  GLASS_THICKNESS,
  GLASS_V0,
  HALF,
  HBAR,
  LANES,
  type Lane,
  OBSTACLE_Z,
  PORCH_Z,
  SPONGE,
  absorberOf,
  cellCentre,
  cellIndex,
  glassTheory,
  laneOf,
  rasterize,
  spongeRate,
} from './courtyard';
import { GpuSchrodinger } from './hbarSolver';
import { forwardFlat, rightFlat, seeded } from './shared';
import type { Pose, Quality, Readout, Toggle, TourStop, World, WorldContext } from './types';

export { proveSolver } from './hbarSolver';

const GRID: Record<Quality, number> = { low: 256, medium: 384, high: 512 };
/** Leapfrog steps the GPU may take per frame before the wave falls behind real time. */
const MAX_STEPS: Record<Quality, number> = { low: 40, medium: 80, high: 120 };
/** A wavelength must span this many cells for the grid to carry the wave faithfully. */
const RESOLVE_CELLS = 5;
const EYE = 1.7;
const TERRACE_H = 4.4;
const TERRACE_Z0 = 24.4;
const STAIR_Z1 = 31;
/** The two stairs run up the ends of the terrace, inside x = ±STAIR_X … ±HALF, leaving its middle clear for the view. */
const STAIR_X = 21;
const TERRACE_Z1 = 33;
/** Galleries at terrace height run along both sides, above the outer walls, out to x = ±GALLERY_X. */
const GALLERY_X = HALF + 3;
const RAIL_H = 1;
/** Launch marks at the head of each lane: the tour rolls its balls from these, straight down the lane. */
const LAUNCH_Z = 9.75;
const MARKS = [-16.125, 0, 2.625, 16.125];
const MAX_DOTS = 6000;
const RAPID_RATE = 30;
const READ_INTERVAL = 0.2;
const SUN_DIR = new THREE.Vector3(-0.45, 0.78, 0.43).normalize();
const INK = 0x15171c;
const VERMILION = new THREE.Color(0xd2442b);
/** The detector's flash is a cold cyan, which nothing else in the courtyard shows. */
const DETECTOR_GLOW = new THREE.Color(0.2, 0.9, 1);
const FLASH_TIME = 1.5;
const BEAM_H = 2.4;
const VIEW = TERRACE_H + EYE;
const terrace = (x: number, pitch = -0.2): Pose => ({ position: [x, VIEW, 25.05], yaw: 0, pitch });
/** Standing just behind a launch mark, looking down the lane. */
const porch = (x: number): Pose => ({ position: [x, EYE, LAUNCH_Z + 3.3], yaw: 0, pitch: -0.3 });
/** On a side gallery, looking down at the floor of the outer lane beyond its obstacle. */
const gallery = (sx: -1 | 1): Pose => ({ position: [sx * 24.6, VIEW, -1], yaw: sx * 0.58, pitch: -0.45 });

interface Throw {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

interface WaveStats {
  inField: number;
  /** Probability the absorbing walls have taken so far. */
  absorbed: number;
  /** Highest |ψ|² on the floor (1/m²). */
  peak: number;
  x: number;
  z: number;
  spread: number;
  /** Share of the ball past the obstacle, on the floor or already absorbed there. */
  beyond: number;
  /** Probability on the floor past the obstacle, not yet absorbed. */
  beyondOnFloor: number;
}

/** What a stream of identical rolls lands on: a fixed point (classical), or the wave's absorbed distribution so far. */
type Source = { cdf: Float64Array; n: number; complete: boolean } | { point: [number, number] };
type Counts = Record<Lane, { through: number; back: number; dots: number }>;
const emptyCounts = (): Counts => ({ doorway: { through: 0, back: 0, dots: 0 }, slits: { through: 0, back: 0, dots: 0 }, glass: { through: 0, back: 0, dots: 0 } });

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

/** A standard normal deviate (Box–Muller). */
const gaussian = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
/** One decimal place, without a stray "-0.0". */
const fix1 = (v: number) => (Math.round(v * 10) / 10 || 0).toFixed(1);
const spot = (x: number, z: number) => `${fix1(x)}, ${fix1(z)} m`;
/** The ball's wavelength at a given ħ, written as the HUD writes it. */
const wavelength = (hbar: number) => `${formatSI(deBroglieWavelength({ mass: BALL.mass, hbar }, BALL.speed))} m`;
/** Shares, speeds and energies as the HUD and the tour both write them. */
const percent = (share: number) => `${(100 * share).toPrecision(2)}%`;
const speed = (v: number) => `${v.toFixed(2)} m/s`;
const joules = (e: number) => `${formatSI(e)} J`;
const GLASS = glassTheory(HBAR);

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

export class BigHbarWorld implements World {
  readonly id = 'big-hbar';
  readonly title = 'Big ħ';
  readonly dials = ['hbar' as const];
  readonly preset = { hbar: HBAR };
  readonly start: Pose = terrace(0);
  readonly actions = [
    { id: 'throw', label: 'Roll ball', key: 'KeyF' },
    { id: 'measure', label: 'Measure', key: 'KeyM' },
    { id: 'clear', label: 'Clear dots', key: 'KeyR' },
  ];
  readonly toggles: Toggle[] = [
    { id: 'wave', label: 'Show wave', hint: 'Draw |ψ|² as glowing light, scaled to its peak; the bright bands are the crests', value: true },
    { id: 'detector', label: 'Detector walls', hint: 'Dark walls past the obstacles record where each ball lands', value: true },
    { id: 'rapid', label: 'Rapid fire', hint: 'Repeat the same roll; every repeat lands one dot drawn from the same |ψ|²', value: false },
  ];
  readonly tour: TourStop[] = [
    {
      title: 'A real ball',
      text: `With the real ħ, this ${BALL.mass} kg ball rolled at ${BALL.speed} m/s has a wavelength of ${wavelength(REAL.hbar)}. It rolls straight through the opening and leaves one dot, like every ball you have ever thrown.`,
      pose: terrace(0),
      constants: { hbar: REAL.hbar },
      toggles: { rapid: false, detector: true },
      action: 'clear+roll@2.625',
    },
    {
      title: 'Turn ħ up',
      text: `At ħ = ${HBAR} J·s the same roll has a wavelength of ${wavelength(HBAR)}, about a metre. The ball leaves the mark as a wave, and you can watch it spread as it goes.`,
      pose: porch(0),
      constants: { hbar: HBAR },
      toggles: { rapid: false },
      action: 'roll@0',
    },
    {
      title: 'The doorway',
      text: 'A doorway barely wider than the wavelength makes the wave fan out. Rapid fire repeats the roll: a classical ball would land straight ahead every time, but these dots spread across the whole far wall.',
      pose: gallery(-1),
      toggles: { rapid: true },
      action: 'clear+roll@-16.125',
      predict: {
        question: 'A wave-ball rolls at a doorway 1.5 m wide. Where can it land on the far wall?',
        options: ['Only straight behind the doorway', 'Anywhere across a wide fan', 'Nowhere: it always bounces back'],
        answer: 1,
        reveal: 'The wave diffracts through the opening and spreads into a fan. Each ball still lands as one dot, somewhere inside that fan.',
      },
    },
    {
      title: 'Two openings',
      text: 'Every ball lands as a single dot, yet the dots pile up into stripes. Each ball went through both openings and interfered with itself.',
      pose: { position: [0, EYE, -12], yaw: 0, pitch: 0.03 },
      toggles: { rapid: true },
      action: 'clear+roll@0',
      predict: {
        question: 'If ħ were halved, the stripes on the far wall would get…',
        options: ['Closer together', 'Further apart', 'No different'],
        answer: 0,
        reveal: 'Stripe spacing is Lλ/d and λ = 2πħ/p, so a smaller ħ packs the stripes closer. Drag ħ up to about 0.4 and watch them spread apart.',
      },
    },
    {
      title: 'A detector pins it down',
      text: `Press Measure (M) while it rolls: a detector in the floor interacts with the ball and fires at one spot, drawn at random from |ψ|². That interaction, not anyone looking, leaves a lump as wide as the flash (the detector's ${DETECTOR_RESOLUTION.toFixed(2)} m resolution), which spreads again faster than before but never turns back into the wave it was.`,
      pose: porch(0),
      toggles: { rapid: false },
      action: 'roll@0+measure@1.2',
    },
    {
      title: 'Through glass',
      text: `This lane rolls a longer wave, which pins its speed down more tightly: ${percent(GLASS.below)} of it has less energy than the ${joules(GLASS_V0)} needed to cross the glass, and a classical ball that short of energy always bounces back. Yet some balls tunnel through: compare the count with the theory in the panel.`,
      pose: gallery(1),
      constants: { hbar: HBAR },
      toggles: { rapid: true },
      action: 'clear+roll@16.125',
      predict: {
        question: `The ball has ${joules(ENERGY)} and the glass needs ${joules(GLASS_V0)}. How many balls get through?`,
        options: ['None of them', 'About a quarter', 'All of them'],
        answer: 1,
        reveal: `The wave leaks through a barrier it cannot classically cross. Theory gives ${percent(GLASS.planeWave)} for a wave with exactly the ball's energy, and the count settles near it.`,
      },
    },
    {
      title: 'Fainter, not slower',
      text: 'The panel’s “Glass: speed through” is worked out from the wave past the glass, from the spacing of its crests. Tunnelling changes how many balls get through, not how fast they go.',
      pose: gallery(1),
      constants: { hbar: HBAR },
      toggles: { rapid: true },
      action: 'roll@16.125',
      predict: {
        question: 'A ball that tunnels through the glass comes out…',
        options: ['Slower: getting through cost it energy', 'Just as fast as it went in'],
        answer: 1,
        reveal: `No energy is lost in the glass: what gets through averages ${speed(GLASS.speedThrough)}, if anything a touch over the ${BALL.speed} m/s it rolled in at, as faster parts of the wave tunnel more easily. The wave past the glass is fainter because fewer balls get there, not because they are slower.`,
      },
    },
    {
      title: 'A ball as wide as a room',
      text: `At ħ = 1 J·s the wavelength is ${wavelength(1)}. The ball is a ripple that fills the whole lane and pours through both openings at once.`,
      pose: terrace(0),
      constants: { hbar: 1 },
      toggles: { rapid: false },
      action: 'roll@0',
    },
    {
      title: 'Back to reality',
      text: 'At the real ħ every wave effect shrinks far below the size of an atom. That is why balls look solid and go where they are aimed.',
      constants: { hbar: REAL.hbar },
      toggles: { rapid: false },
      action: 'throw',
    },
  ];

  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);
  private sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  private field: Field;
  private gpu: GpuSchrodinger;
  private waveUniforms: Record<string, THREE.IUniform>;
  private surface: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private ballMesh: THREE.Mesh;
  private ghost: THREE.Mesh;
  private spreadRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Where the floor detector last fired: a spot on the floor and a beam standing over it, as wide as its resolution. */
  private flashSpot: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private flashBeam: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** A brief glow where the latest ball was caught, so a landing reads from across the courtyard. */
  private pulse: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private pulseAge = 1;
  private dots: THREE.InstancedMesh;
  private marks: THREE.InstancedMesh;
  private textures: THREE.Texture[] = [];
  private renderer: THREE.WebGLRenderer;
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && document.pointerLockElement === this.renderer.domElement) this.queuedThrow = true;
  };

  private pos = new THREE.Vector3(...this.start.position);
  private vel = new THREE.Vector2();
  private yaw = this.start.yaw;
  private pitch = this.start.pitch;

  private mode: 'idle' | 'wave' | 'ball' = 'idle';
  private hbar: number;
  private quality: Quality;
  private stepAcc = 0;
  private slowmo = 1;
  private age = 0;
  private readTimer = 0;
  /** The |ψ|² drawn at full brightness: it follows the wave's peak, so a spreading wave stays visible. */
  private shownPeak = 1;
  private peakFloor = 0;
  private stats: WaveStats | null = null;
  private ball = { x: 0, z: 0, vx: 0, vz: 0 };
  private lastThrow: Throw | null = null;
  private measureAt: number | null = null;
  /** What the wave is held still for until its read-back arrives: a measurement, or turning into a classical ball. */
  private held: 'measure' | 'classical' | null = null;
  private relaunchIn: number | null = null;
  private queuedThrow = false;
  private rapid: Source | null = null;
  /** Absorbed probability per cell at the previous read-back, so each interval's new catch can be found. */
  private seen = new Float32Array(0);
  private seenTotal = 0;
  private rapidAcc = 0;
  private counts = emptyCounts();
  private dotCount = 0;
  private markCount = 0;
  private flashAge = FLASH_TIME;
  /**
   * A glass roll still crossing: the wave past the glass at its fullest so far, as a share of the ball, and its mean
   * speed then (see readGlass). Null once read, for any other roll, and after a measurement.
   */
  private crossing: { share: number; speed: number } | null = null;
  /** Mean speed of what got through the glass, read from ψ on the latest glass roll to finish crossing. */
  private glassSpeed: number | null = null;
  private notice = '';
  private noticeTimer = 0;
  private lastEvent = '';

  constructor(ctx: WorldContext) {
    this.renderer = ctx.renderer;
    this.quality = ctx.quality;
    this.hbar = ctx.constants.hbar;
    const r = ctx.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;

    this.field = rasterize(GRID[this.quality]);
    this.gpu = new GpuSchrodinger(this.field);
    this.gpu.clear(r);
    this.waveUniforms = {
      uState: { value: this.gpu.texture },
      uPot: { value: this.gpu.potential },
      uN: { value: this.field.n },
      uPeak: { value: 1 },
      uWave: { value: 1 },
      uHeight: { value: 0.35 },
      uSheet: { value: 1 },
    };

    this.buildEnvironment();
    this.surface = this.buildSurface();
    this.scene.add(this.surface);

    const ballTex = this.ballTexture();
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
    for (const m of [this.ballMesh, this.ghost, this.spreadRing, this.flashSpot, this.flashBeam, this.pulse]) m.visible = false;
    for (const m of [this.dots, this.marks]) {
      m.count = 0;
      m.frustumCulled = false;
    }
    this.scene.add(this.ballMesh, this.ghost, this.spreadRing, this.flashSpot, this.flashBeam, this.pulse, this.dots, this.marks);
    r.domElement.addEventListener('mousedown', this.onMouseDown);
  }

  // ---------- scene ----------

  private buildEnvironment() {
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
    this.setShadowSize();
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

  private buildSurface() {
    const segs = Math.min(this.field.n, 384);
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

  private ballTexture() {
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

  private setShadowSize() {
    const size = this.quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  // ---------- physics ----------

  private get particle() {
    return { mass: BALL.mass, hbar: this.hbar };
  }

  private get lambda() {
    return deBroglieWavelength(this.particle, BALL.speed);
  }

  /** Can this grid carry the wave? At the real ħ nothing could: the ball is classical. */
  private get resolvable() {
    return this.lambda >= RESOLVE_CELLS * this.field.dx;
  }

  private waveDt() {
    return stableTimeStep({ nx: this.field.n, ny: this.field.n, dx: this.field.dx, stencil: 4 }, this.particle, GLASS_V0);
  }

  /** Classical collision test: walls, and the glass whenever the ball lacks the energy to cross it. */
  private blocked(x: number, z: number) {
    const { n, dx } = this.field;
    if (Math.abs(x) >= HALF || Math.abs(z) >= HALF) return true;
    const k = cellIndex(z, dx, n) * n + cellIndex(x, dx, n);
    return this.field.open[k] === 0 || this.field.potential[k] > ENERGY;
  }

  private say(msg: string) {
    this.notice = msg;
    this.noticeTimer = 3.5;
  }

  /** A new ħ is a new experiment; it may also cross between the wave and classical regimes mid-roll. */
  private syncHbar(ctx: WorldContext) {
    const h = ctx.constants.hbar;
    if (h === this.hbar) return;
    const wasResolvable = this.resolvable;
    this.hbar = h;
    this.rapid = null;
    this.resetCounts();
    // Rapid fire tallies one experiment, so a roll in flight starts over under the new ħ.
    if (this.toggle('rapid') && this.lastThrow && this.mode !== 'idle') this.launch(this.lastThrow, ctx);
    else if (this.mode === 'wave' && !this.resolvable) this.hold('classical', ctx.renderer);
    else if (this.mode === 'ball' && this.resolvable && !wasResolvable) {
      const v = Math.hypot(this.ball.vx, this.ball.vz) || 1;
      this.startWave(ctx.renderer, this.ball.x, this.ball.z, this.ball.vx / v, this.ball.vz / v);
      this.say('ħ is big enough now: the ball dissolves into a wave.');
    }
  }

  private resetCounts() {
    this.counts = emptyCounts();
    this.dotCount = 0;
    this.dots.count = 0;
    this.glassSpeed = null;
    this.lastEvent = '';
  }

  private stopAll() {
    this.mode = 'idle';
    this.stats = null;
    this.measureAt = null;
    this.held = null;
    this.gpu.clear(this.renderer);
  }

  private throwFromPlayer(ctx: WorldContext) {
    const f = forwardFlat(this.yaw);
    const lim = HALF - SPONGE.rim - 0.75;
    const x = THREE.MathUtils.clamp(this.pos.x + f.x * 1.5, -lim, lim);
    const z = THREE.MathUtils.clamp(this.pos.z + f.z * 1.5, -lim, lim);
    if (this.blocked(x, z)) {
      this.say('Too close to a wall to roll the ball.');
      return;
    }
    this.release({ x, z, dirX: f.x, dirZ: f.z }, ctx);
  }

  /** Roll a ball; rapid fire keeps its cached outcomes only while the roll stays the same. */
  private release(t: Throw, ctx: WorldContext) {
    const prev = this.lastThrow;
    const same = prev && Math.hypot(t.x - prev.x, t.z - prev.z) < 0.3 && t.dirX * prev.dirX + t.dirZ * prev.dirZ > 0.9995;
    if (!same) this.rapid = null;
    this.launch(t, ctx);
  }

  private launch(t: Throw, ctx: WorldContext) {
    this.lastThrow = t;
    this.relaunchIn = null;
    this.measureAt = null;
    if (this.resolvable) this.startWave(ctx.renderer, t.x, t.z, t.dirX, t.dirZ);
    else this.startBall(t.x, t.z, t.dirX, t.dirZ);
  }

  private startBall(x: number, z: number, dirX: number, dirZ: number) {
    this.stopAll();
    this.mode = 'ball';
    this.ball = { x, z, vx: dirX * BALL.speed, vz: dirZ * BALL.speed };
    this.age = 0;
  }

  private startWave(r: THREE.WebGLRenderer, x: number, z: number, dirX: number, dirZ: number) {
    const { n, dx } = this.field;
    const cpu = new Schrodinger2D({ nx: n, ny: n, dx, stencil: 4 }, this.particle, this.waveDt());
    cpu.potential.set(this.gpu.v);
    cpu.open.set(this.field.open);
    // A packet several wavelengths long, so the ball has a well-defined momentum to begin with; down the glass lane
    // a longer one, whose energy lies almost all below the glass.
    // shortcut: that σ is sized for the tour's ħ; at ħ ≈ 1 only 68% of the packet is below the glass and the speed
    // through reads 4.07 m/s against 4.03 in theory. Scale σ with ħ, and lengthen the lane, to tour the glass there.
    const glass = laneOf(x) === 'glass';
    const sigma = glass ? GLASS_SIGMA : THREE.MathUtils.clamp(0.8 * this.lambda, 0.8, 2);
    const k = (BALL.mass * BALL.speed) / this.hbar;
    cpu.setGaussian(x + HALF - dx / 2, z + HALF - dx / 2, sigma, k * dirX, k * dirZ);
    this.gpu.load(r, cpu.re, cpu.im, cpu.imPrev);
    this.seen = new Float32Array(n * n);
    this.seenTotal = 0;
    const peak = 1 / (2 * Math.PI * sigma * sigma);
    this.shownPeak = peak;
    this.peakFloor = 0.01 * peak;
    this.mode = 'wave';
    this.age = 0;
    this.stepAcc = 0;
    this.readTimer = READ_INTERVAL;
    this.measureAt = null;
    this.held = null;
    this.crossing = glass ? { share: 0, speed: 0 } : null;
    this.stats = { inField: 1, absorbed: 0, peak, x, z, spread: sigma * Math.SQRT2, beyond: 0, beyondOnFloor: 0 };
    this.ghost.position.set(x, BALL.radius + 0.02, z);
    this.spreadRing.scale.setScalar(sigma * Math.SQRT2);
  }

  /** Summarise the last read-back: probability left on the floor and absorbed, its mean and spread, and how much is past the obstacle. */
  private analyse(): WaveStats {
    const b = this.gpu.buffer;
    const { n, dx } = this.field;
    const cell = dx * dx;
    let m = 0, mx = 0, mz = 0, mxx = 0, mzz = 0, ab = 0, beyond = 0, onFloor = 0, peak = 0;
    for (let j = 0; j < n; j++) {
      const z = cellCentre(j, dx);
      for (let i = 0; i < n; i++) {
        const k = (j * n + i) * 4;
        const rho = Math.max(0, b[k] * b[k] + b[k + 1] * b[k + 2]);
        ab += b[k + 3];
        if (z < OBSTACLE_Z) {
          beyond += rho * cell + b[k + 3];
          onFloor += rho;
        }
        if (rho === 0) continue;
        const x = cellCentre(i, dx);
        if (rho > peak) peak = rho;
        m += rho;
        mx += rho * x;
        mz += rho * z;
        mxx += rho * x * x;
        mzz += rho * z * z;
      }
    }
    const inField = m * cell;
    if (m <= 0) return (this.stats = { inField: 0, absorbed: ab, peak: 0, x: 0, z: 0, spread: 0, beyond: 1, beyondOnFloor: 0 });
    const ex = mx / m, ez = mz / m;
    this.stats = {
      inField,
      absorbed: ab,
      peak,
      x: ex,
      z: ez,
      spread: Math.sqrt(Math.max(0, mxx / m - ex * ex + mzz / m - ez * ez)),
      beyond: beyond / Math.max(1e-9, inField + ab),
      beyondOnFloor: onFloor * cell,
    };
    return this.stats;
  }

  /** Mean wavevector of the wave in the last read-back, over the cells `inside` picks (all of them by default). */
  private wavevector(inside: (i: number, j: number) => boolean = () => true): [number, number] {
    const b = this.gpu.buffer;
    const { n, dx } = this.field;
    // Im ψ is read back at the half steps either side of Re ψ: their mean is Im ψ at the same moment.
    return meanWavevector({ nx: n, ny: n, dx }, (k) => b[k * 4], (k) => 0.5 * (b[k * 4 + 1] + b[k * 4 + 2]), inside);
  }

  /**
   * On a glass roll, whose wave can pass the obstacle only through the glass, read the mean speed ħk/m of what has
   * got through from ψ, each time the wave past the glass is fuller than at the last read. Once it stops growing,
   * every part that will get through has, and the far wall has begun to absorb it, fastest first, so a later reading
   * would lean slow: the last reading is the roll's.
   */
  private readGlass(st: WaveStats) {
    const c = this.crossing;
    // Below a percent of the ball, what lies past the glass is too faint to read.
    if (!c || st.beyondOnFloor < 0.01) return;
    if (st.beyondOnFloor > c.share) {
      const dx = this.field.dx;
      const [kx, kz] = this.wavevector((_, j) => cellCentre(j, dx) < OBSTACLE_Z);
      this.crossing = { share: st.beyondOnFloor, speed: (this.hbar * Math.hypot(kx, kz)) / BALL.mass };
    } else {
      this.glassSpeed = c.speed;
      this.crossing = null;
    }
  }

  /** Draw a cell from the last read-back with probability |ψ|². */
  private sampleCell(): [number, number, number] | null {
    const b = this.gpu.buffer;
    const { n, dx } = this.field;
    const cdf = cumulative(n * n, (k) => b[k * 4] ** 2 + b[k * 4 + 1] * b[k * 4 + 2]);
    if (cdf[n * n - 1] <= 1e-12) return null;
    const k = sampleIndex(cdf, Math.random());
    return [cellCentre(k % n, dx), cellCentre(Math.floor(k / n), dx), k];
  }

  /** Hold the wave still and read it back; once the read-back arrives, settle() does what it was held for. */
  private hold(why: 'measure' | 'classical', r: THREE.WebGLRenderer) {
    this.held = why;
    this.gpu.requestRead(r, true);
  }

  /** The held wave has been read back: hand it over to a classical ball if ħ is still too small, else let the detector catch it. */
  private settle(r: THREE.WebGLRenderer) {
    const why = this.held;
    this.held = null;
    if (!this.resolvable) this.becomeBall();
    else if (why === 'measure') this.collapse(r);
  }

  private becomeBall() {
    const pick = this.sampleCell();
    if (!pick) return this.stopAll();
    const [kx, kz] = this.wavevector();
    const k = Math.hypot(kx, kz);
    const [dx, dz] = this.hbar * k > 0.2 * BALL.mass * BALL.speed ? [kx / k, kz / k] : [this.lastThrow?.dirX ?? 0, this.lastThrow?.dirZ ?? -1];
    this.startBall(pick[0], pick[1], dx, dz);
    this.say('The wavelength fell below what the grid can carry: the ball rolls on as a classical ball, from a spot drawn from |ψ|².');
  }

  /** Fire the floor detector at the ball: at a wave, once a read-back of it as it is now has arrived (see collapse). */
  private measure(ctx: WorldContext) {
    if (this.mode === 'ball') {
      this.fire(this.ball.x, this.ball.z);
      this.say('A classical ball already has a definite position: the detector fires where it is, and it rolls on as before.');
      return;
    }
    if (this.mode !== 'wave') {
      this.say('Roll a ball first (F), then measure it while it rolls.');
      return;
    }
    this.hold('measure', ctx.renderer);
  }

  /**
   * The floor detector catches the ball, an unsharp position measurement. It fires at a spot drawn from |ψ|² and
   * blurred by its own Gaussian response, and catching the ball multiplies |ψ|² by that Gaussian about the spot. The
   * local phase survives, so the lump keeps rolling while it spreads.
   */
  private collapse(r: THREE.WebGLRenderer) {
    const pick = this.sampleCell();
    if (!pick) return;
    const b = this.gpu.buffer;
    const { n, dx } = this.field;
    const fx = pick[0] + DETECTOR_SIGMA * gaussian(), fz = pick[1] + DETECTOR_SIGMA * gaussian();
    // The spot and the response in cells (cell i is centred on i).
    const ci = (fx + HALF) / dx - 0.5, cj = (fz + HALF) / dx - 0.5, sigma = DETECTOR_SIGMA / dx;
    // What survives is |ψ|² times the response: its total sets the rescaling, its moments the new summary.
    let kept = 0, mx = 0, mz = 0, mrr = 0, peak = 0, beyond = 0;
    const reach = 6 * sigma;
    for (let j = Math.max(0, Math.ceil(cj - reach)); j <= Math.min(n - 1, cj + reach); j++) {
      const z = cellCentre(j, dx);
      for (let i = Math.max(0, Math.ceil(ci - reach)); i <= Math.min(n - 1, ci + reach); i++) {
        const k = (j * n + i) * 4;
        const x = cellCentre(i, dx);
        const d2 = (i - ci) ** 2 + (j - cj) ** 2;
        const rho = Math.exp(-d2 / (2 * sigma * sigma)) * Math.max(0, b[k] ** 2 + b[k + 1] * b[k + 2]);
        kept += rho;
        mx += rho * x;
        mz += rho * z;
        mrr += rho * (x * x + z * z);
        if (rho > peak) peak = rho;
        if (z < OBSTACLE_Z) beyond += rho;
      }
    }
    const norm = kept * dx * dx;
    if (norm <= 1e-12) return;
    this.gpu.collapse(r, ci, cj, sigma, 1 / Math.sqrt(norm));
    // The collapse empties the absorbed tally, so the detectors start counting again from nothing.
    this.seen.fill(0);
    this.seenTotal = 0;
    // What lies past the glass from now on was put there by the detector, not by tunnelling.
    this.crossing = null;
    const ex = mx / kept, ez = mz / kept;
    const spread = Math.sqrt(Math.max(0, mrr / kept - ex * ex - ez * ez));
    this.stats = { inField: 1, absorbed: 0, peak: peak / norm, x: ex, z: ez, spread, beyond: beyond / kept, beyondOnFloor: beyond / kept };
    this.fire(fx, fz);
    this.lastEvent = `Detector fired at x ${fix1(fx)}, z ${fix1(fz)} m`;
    this.ghost.position.set(ex, BALL.radius + 0.02, ez);
    this.spreadRing.scale.setScalar(spread);
  }

  /** A ball has been absorbed somewhere: record where, and draw its dot. */
  private land(x: number, z: number) {
    // Tallies belong to the lane the ball was rolled down, wherever its wave ended up.
    const lane = laneOf(this.lastThrow?.x ?? x);
    const where = absorberOf(z);
    this.counts[lane][z < OBSTACLE_Z ? 'through' : 'back']++;
    if (where === 'back') {
      this.lastEvent = 'Last ball came back toward you';
      return;
    }
    this.lastEvent = where === 'screen' ? `Last ball landed at x = ${fix1(x)} m` : 'Last ball hit a side absorber';
    if (!this.toggle('detector')) return;
    this.counts[lane].dots++;
    const o = new THREE.Object3D();
    // The floor is two-dimensional, so the height on the plate is free: dots gather in a band at eye level.
    const y = THREE.MathUtils.clamp(1.6 + 0.45 * gaussian(), 0.3, 3.6);
    if (where === 'screen') {
      o.position.set(x, y, -HALF + 0.12);
      o.lookAt(x, y, 0);
    } else {
      const faces = [-HALF, -8.25, -7.875, 7.875, 8.25, HALF];
      const face = faces.reduce((best, f) => (Math.abs(f - x) < Math.abs(best - x) ? f : best));
      const into = x > face ? 1 : -1;
      o.position.set(face + into * 0.12, y, z);
      o.lookAt(face + into * 2, y, z);
    }
    o.updateMatrix();
    this.clickAt(o.position);
    this.pulse.position.copy(o.position).add(new THREE.Vector3(0, 0, 0.01).applyQuaternion(o.quaternion));
    this.pulse.quaternion.copy(o.quaternion);
    this.pulseAge = 0;
    this.dots.setMatrixAt(this.dotCount % MAX_DOTS, o.matrix);
    this.dotCount++;
    this.dots.count = Math.min(this.dotCount, MAX_DOTS);
    this.dots.instanceMatrix.needsUpdate = true;
  }

  private mark(x: number, z: number) {
    this.marks.setMatrixAt(this.markCount % 64, new THREE.Matrix4().makeTranslation(x, 0.012, z));
    this.markCount++;
    this.marks.count = Math.min(this.markCount, 64);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  /** Each detection clicks like a Geiger counter, panned toward where it happened. */
  private clickAt(p: THREE.Vector3) {
    const to = p.clone().sub(this.pos).setY(0).normalize();
    click(Math.min(1, 6 / (1 + p.distanceTo(this.pos))), to.dot(rightFlat(this.yaw)));
  }

  private fire(x: number, z: number) {
    this.flashAge = 0;
    this.flashSpot.position.set(x, 0.03, z);
    this.flashBeam.position.set(x, 0, z);
    this.mark(x, z);
    this.clickAt(this.flashSpot.position);
  }

  private toggle(id: string) {
    return this.toggles.find((t) => t.id === id)!.value;
  }

  /**
   * Rapid fire: a stream of identical rolls, RAPID_RATE a second. Balls of every age are in flight, so
   * they are caught at RAPID_RATE times the share of one ball's wave absorbed so far, each at a spot
   * drawn from where that share went; once one wave has run its course the stream is steady.
   */
  private rapidStream(dt: number) {
    const src = this.rapid;
    if (!src || !this.toggle('rapid')) {
      this.rapidAcc = 0;
      return;
    }
    const caught = 'point' in src || src.complete ? 1 : Math.min(1, src.cdf[src.cdf.length - 1] ?? 0);
    this.rapidAcc += dt * RAPID_RATE * caught;
    while (this.rapidAcc >= 1) {
      this.rapidAcc--;
      if ('point' in src) this.land(...src.point);
      else {
        const k = sampleIndex(src.cdf, Math.random());
        this.land(cellCentre(k % src.n, this.field.dx), cellCentre(Math.floor(k / src.n), this.field.dx));
      }
    }
  }

  // ---------- World interface ----------

  setPose(p: Pose) {
    this.pos.set(...p.position);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.vel.set(0, 0);
  }

  /** Actions, plus the tour's compound ones such as 'clear+roll@0+measure@1.8' (roll from a mark, measure at 1.8 s). */
  runAction(id: string, ctx: WorldContext) {
    const parts = id.split('+').map((p) => p.split('@'));
    // A new roll replaces whatever was rolling, so a change of ħ that comes with it converts nothing.
    if (parts.some(([verb]) => verb === 'throw' || verb === 'roll')) this.stopAll();
    this.syncHbar(ctx);
    for (const [verb, arg] of parts) {
      if (verb === 'clear') {
        this.rapid = null;
        this.resetCounts();
        this.marks.count = this.markCount = 0;
      } else if (verb === 'throw') this.throwFromPlayer(ctx);
      else if (verb === 'roll') this.release({ x: Number(arg), z: LAUNCH_Z, dirX: 0, dirZ: -1 }, ctx);
      else if (verb === 'measure' && arg) this.measureAt = Number(arg);
      else if (verb === 'measure') this.measure(ctx);
    }
  }

  private floorHeight(x: number, z: number) {
    if (Math.abs(x) > HALF) return TERRACE_H;
    if (z < TERRACE_Z0) return 0;
    if (Math.abs(x) > STAIR_X && z < STAIR_Z1) return (TERRACE_H * (z - TERRACE_Z0)) / (STAIR_Z1 - TERRACE_Z0);
    return TERRACE_H;
  }

  private static SOLIDS: [number, number, number, number][] = [
    ...BLOCKS.map((b): [number, number, number, number] => [b.x0, b.x1, b.z0, b.z1]),
    [-STAIR_X, STAIR_X, TERRACE_Z0 - 0.2, TERRACE_Z0 + 0.2],
    [-STAIR_X - 0.15, -STAIR_X + 0.15, TERRACE_Z0 - 0.2, STAIR_Z1],
    [STAIR_X - 0.15, STAIR_X + 0.15, TERRACE_Z0 - 0.2, STAIR_Z1],
    // The gallery edges: a wall seen from the floor, a railing seen from above.
    [-HALF - 0.2, -HALF + 0.05, -HALF - 1, STAIR_Z1],
    [HALF - 0.05, HALF + 0.2, -HALF - 1, STAIR_Z1],
  ];

  private walk(dt: number, input: InputState) {
    const wish = forwardFlat(this.yaw).multiplyScalar(input.move.z).add(rightFlat(this.yaw).multiplyScalar(input.move.x));
    const target = new THREE.Vector2(wish.x, wish.z);
    if (target.lengthSq() > 1) target.normalize();
    target.multiplyScalar(input.sprint ? 7 : 3.4);
    this.vel.lerp(target, 1 - Math.exp(-10 * dt));
    let x = this.pos.x + this.vel.x * dt;
    let z = this.pos.z + this.vel.y * dt;
    const R = 0.3;
    for (const [x0, x1, z0, z1] of BigHbarWorld.SOLIDS) {
      if (x < x0 - R || x > x1 + R || z < z0 - R || z > z1 + R) continue;
      const push = [x0 - R - x, x1 + R - x, z0 - R - z, z1 + R - z];
      const i = push.reduce((best, v, k) => (Math.abs(v) < Math.abs(push[best]) ? k : best), 0);
      if (i < 2) {
        x += push[i];
        this.vel.x = 0;
      } else {
        z += push[i];
        this.vel.y = 0;
      }
    }
    x = THREE.MathUtils.clamp(x, -GALLERY_X + R, GALLERY_X - R);
    z = THREE.MathUtils.clamp(z, -HALF + R, TERRACE_Z1 - R);
    const eye = this.floorHeight(x, z) + EYE;
    this.pos.set(x, this.pos.y + (eye - this.pos.y) * (1 - Math.exp(-12 * dt)), z);
  }

  private stepBall(dt: number) {
    const sub = Math.max(1, Math.ceil(dt * 240));
    const h = dt / sub;
    const b = this.ball;
    const axis = new THREE.Vector3();
    for (let s = 0; s < sub; s++) {
      let nx = b.x + b.vx * h, nz = b.z + b.vz * h;
      if (this.blocked(nx, b.z)) {
        b.vx = -b.vx;
        nx = b.x;
      }
      if (this.blocked(b.x, nz)) {
        b.vz = -b.vz;
        nz = b.z;
      }
      if (this.blocked(nx, nz)) {
        b.vx = -b.vx;
        b.vz = -b.vz;
        nx = b.x;
        nz = b.z;
      }
      const d = Math.hypot(nx - b.x, nz - b.z);
      if (d > 0) this.ballMesh.rotateOnWorldAxis(axis.set((nz - b.z) / d, 0, -(nx - b.x) / d), d / BALL.radius);
      b.x = nx;
      b.z = nz;
      this.age += h;
      if (spongeRate(b.x, b.z) > 0.02 * SPONGE.rate || this.age > 40) {
        this.mode = 'idle';
        this.land(b.x, b.z);
        if (this.toggle('rapid')) {
          this.rapid ??= { point: [b.x, b.z] };
          this.relaunchIn = 0.8;
        }
        return;
      }
    }
  }

  private stepWave(dt: number, ctx: WorldContext) {
    const r = ctx.renderer;
    // Read-backs arrive a frame or more after they are asked for, so neither side ever waits for the other.
    if (this.gpu.poll(r)) {
      this.detect();
      if (this.mode === 'wave' && this.held) this.settle(r);
      if (this.mode !== 'wave') return;
    }
    if (this.held) return;
    const h = this.waveDt();
    this.stepAcc += dt;
    let steps = Math.floor(this.stepAcc / h);
    if (steps > MAX_STEPS[this.quality]) {
      steps = MAX_STEPS[this.quality];
      this.stepAcc = 0;
    } else this.stepAcc -= steps * h;
    if (steps > 0) this.gpu.step(r, steps, h, this.particle);
    this.age += steps * h;
    if (dt > 0) this.slowmo += ((steps * h) / dt - this.slowmo) * 0.1;
    if (this.measureAt !== null && this.age >= this.measureAt) {
      this.measureAt = null;
      this.measure(ctx);
    }
    this.readTimer -= dt;
    if (this.readTimer <= 0 && this.gpu.requestRead(r)) this.readTimer = READ_INTERVAL;
  }

  /** A read-back has arrived: summarise the wave, read the glass, and give the detector walls their chance to catch it. */
  private detect() {
    const st = this.analyse();
    this.readGlass(st);
    const b = this.gpu.buffer;
    const { n, dx } = this.field;
    const finished = st.inField < 0.03 || this.age > 60;
    if (this.toggle('rapid')) {
      const absorbed = cumulative(n * n, (k) => b[k * 4 + 3]);
      if (!this.rapid) this.rapid = { cdf: absorbed, n, complete: false };
      else if ('cdf' in this.rapid && !this.rapid.complete) this.rapid.cdf = absorbed;
      if (finished) {
        if ('cdf' in this.rapid) this.rapid.complete = true;
        this.stopAll();
        this.relaunchIn = 0.8;
        return;
      }
    } else {
      // The absorbing walls are detectors. In each interval the ball is caught with the probability its
      // wave just lost to them (given it was not caught before), at a spot drawn from where that went.
      const gained = st.absorbed - this.seenTotal;
      const caught = gained > 0 && Math.random() * Math.max(1e-9, 1 - this.seenTotal) < gained;
      if (caught || finished) {
        const seen = this.seen;
        const fresh = caught ? cumulative(n * n, (k) => b[k * 4 + 3] - seen[k]) : null;
        const pick = fresh && fresh[n * n - 1] > 0 ? sampleIndex(fresh, Math.random()) : this.sampleCell()?.[2];
        this.stopAll();
        if (pick !== undefined) this.land(cellCentre(pick % n, dx), cellCentre(Math.floor(pick / n), dx));
        return;
      }
    }
    for (let k = 0; k < n * n; k++) this.seen[k] = b[k * 4 + 3];
    this.seenTotal = st.absorbed;
  }

  frame(dt: number, input: InputState, ctx: WorldContext) {
    const r = ctx.renderer;
    if (ctx.quality !== this.quality) this.setQuality(ctx.quality, ctx);
    this.syncHbar(ctx);
    this.yaw = input.yaw;
    this.pitch = input.pitch;
    this.walk(dt, input);
    if (this.queuedThrow) {
      this.queuedThrow = false;
      this.throwFromPlayer(ctx);
    }
    this.noticeTimer -= dt;

    if (this.mode === 'wave') this.stepWave(dt, ctx);
    else if (this.mode === 'ball') this.stepBall(dt);
    if (this.relaunchIn !== null && this.mode === 'idle') {
      this.relaunchIn -= dt;
      if (this.relaunchIn <= 0 && this.lastThrow && this.toggle('rapid')) this.launch(this.lastThrow, ctx);
    }
    this.rapidStream(dt);

    const wave = this.mode === 'wave';
    const u = this.waveUniforms;
    u.uState.value = this.gpu.texture;
    u.uPeak.value = this.shownPeak;
    u.uWave.value = this.toggle('wave') ? 1 : 0;
    this.surface.visible = wave && this.toggle('wave');
    this.ballMesh.visible = this.mode === 'ball';
    this.ballMesh.position.set(this.ball.x, BALL.radius, this.ball.z);
    const st = this.stats;
    this.ghost.visible = this.spreadRing.visible = wave && !!st && st.inField > 0.05;
    if (st && wave) {
      const k = 1 - Math.exp(-8 * dt);
      this.ghost.position.lerp(new THREE.Vector3(st.x, BALL.radius + 0.02, st.z), k);
      this.spreadRing.position.set(this.ghost.position.x, 0.025, this.ghost.position.z);
      this.spreadRing.scale.setScalar(THREE.MathUtils.lerp(this.spreadRing.scale.x, Math.max(0.15, st.spread), k));
      // The ring and the raised sheet describe one lump; once the wave has spread out or split they would
      // only mislead, and the floor alone shows it.
      const lump = 1 - THREE.MathUtils.smoothstep(this.spreadRing.scale.x, 2.5, 4.5);
      this.spreadRing.material.opacity = 0.85 * lump;
      u.uSheet.value = lump;
      this.shownPeak += (Math.max(st.peak, this.peakFloor) - this.shownPeak) * (1 - Math.exp(-4 * dt));
    }
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
      this.flashBeam.rotation.y = this.yaw;
      this.flashSpot.material.opacity = this.flashBeam.material.opacity = 1 - this.flashAge / FLASH_TIME;
    }

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.camera.aspect = size.x / Math.max(1, size.y);
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  readouts(ctx: WorldContext): Readout[] {
    const h = ctx.constants.hbar;
    const out: Readout[] = [
      { label: 'Wavelength λ', value: wavelength(h) },
      { label: 'Ball', value: `${BALL.mass} kg at ${BALL.speed} m/s` },
    ];
    const st = this.stats;
    if (this.mode === 'wave' && st) {
      out.push({ label: 'Where (mean)', value: spot(st.x, st.z) });
      out.push({ label: 'Spread Δx', value: `${st.spread.toFixed(2)} m` });
      out.push({ label: 'Past the obstacle', value: `${Math.round(st.beyond * 100)}%`, gauge: st.beyond });
    } else if (this.mode === 'ball') {
      out.push({ label: 'Where', value: spot(this.ball.x, this.ball.z) });
      out.push({ label: 'Spread Δx', value: '0 (a point)' });
    }
    const c = this.counts;
    out.push({ label: 'Dots recorded', value: String(c.doorway.dots + c.slits.dots + c.glass.dots) });
    const n = c.glass.through + c.glass.back;
    const theory = barrierTransmission(ENERGY, GLASS_V0, GLASS_THICKNESS, { mass: BALL.mass, hbar: h });
    out.push({ label: 'Glass: through', value: n ? `${c.glass.through} of ${n} (${Math.round((100 * c.glass.through) / n)}%)` : '—', gauge: n ? c.glass.through / n : undefined });
    out.push({ label: 'Theory (plane wave)', value: percent(theory) });
    out.push({ label: 'Glass: speed through', value: this.glassSpeed === null ? '—' : speed(this.glassSpeed) });
    return out;
  }

  status(ctx: WorldContext) {
    if (this.noticeTimer > 0) return this.notice;
    const h = ctx.constants.hbar;
    const lambda = deBroglieWavelength({ mass: BALL.mass, hbar: h }, BALL.speed);
    const need = RESOLVE_CELLS * this.field.dx;
    const out: string[] = [];
    if (lambda < need) {
      const hMin = (need * BALL.mass * BALL.speed) / (2 * Math.PI);
      out.push(h < 1e-20
        ? `Classical: λ = ${formatSI(lambda)} m, far below anything visible. Raise ħ past ${hMin.toFixed(2)} J·s to see the wave.`
        : `Classical limit: λ = ${lambda.toFixed(2)} m is finer than this ${this.field.n}² grid carries (${need.toFixed(2)} m). Raise ħ or quality.`);
    } else {
      const pace = this.mode !== 'wave' ? '' : this.slowmo < 0.95 ? `, slow motion ×${this.slowmo.toFixed(2)}` : ', real time';
      out.push(`Wave on a ${this.field.n}² grid of ${Math.round(this.field.dx * 100)} cm cells${pace}.`);
    }
    if (this.toggle('rapid')) out.push('Rapid fire: each repeat lands one dot from the same |ψ|².');
    else if (this.lastEvent) out.push(`${this.lastEvent}.`);
    return out.join(' ');
  }

  setQuality(q: Quality, ctx: WorldContext) {
    if (q === this.quality && this.field.n === GRID[q]) return;
    const rolling = this.mode !== 'idle';
    this.quality = q;
    this.gpu.dispose(ctx.renderer);
    this.field = rasterize(GRID[q]);
    this.gpu = new GpuSchrodinger(this.field);
    this.gpu.clear(ctx.renderer);
    this.waveUniforms.uPot.value = this.gpu.potential;
    this.waveUniforms.uN.value = this.field.n;
    this.rapid = null;
    this.mode = 'idle';
    this.stats = null;
    this.held = null;
    const old = this.surface;
    this.scene.remove(old);
    old.geometry.dispose();
    old.material.dispose();
    this.surface = this.buildSurface();
    this.scene.add(this.surface);
    this.setShadowSize();
    // A roll in flight starts over on the new grid, as a wave or a ball as the new grid allows.
    if (rolling && this.lastThrow) this.launch(this.lastThrow, ctx);
  }

  dispose() {
    const r = this.renderer;
    r.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.gpu.dispose(r);
    this.sun.shadow.map?.dispose();
    this.textures.forEach((t) => t.dispose());
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    });
    r.shadowMap.enabled = false;
    r.toneMapping = THREE.NoToneMapping;
    r.toneMappingExposure = 1;
  }
}
