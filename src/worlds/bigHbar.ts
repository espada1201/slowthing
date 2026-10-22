// World II — a courtyard where Planck's constant is big enough to see. A rolled ball is a wavepacket
// evolved by the time-dependent Schrödinger equation on the GPU; when its wavelength is too small to
// resolve (as it is at the real ħ) the ball is a classical point instead.

import * as THREE from 'three';
import { click } from '../audio';
import { REAL, formatSI } from '../constants';
import type { InputState } from '../input';
import { Schrodinger2D, barrierTransmission, cumulative, deBroglieWavelength, sampleIndex, stableTimeStep } from '../physics/schrodinger';
import {
  BALL,
  DETECTOR_RESOLUTION,
  DETECTOR_SIGMA,
  ENERGY,
  type Field,
  GLASS_SIGMA,
  GLASS_THICKNESS,
  GLASS_V0,
  HALF,
  HBAR,
  type Lane,
  OBSTACLE_Z,
  SPONGE,
  absorberOf,
  cellCentre,
  cellIndex,
  glassTheory,
  laneOf,
  rasterize,
  spongeRate,
} from './courtyard';
import { CourtyardScene, GALLERY_X, LAUNCH_Z, SOLIDS, TERRACE_H, TERRACE_Z1, floorHeight } from './courtyardScene';
import { DetectorRecord } from './detectorRecord';
import { GpuSchrodinger } from './hbarSolver';
import { forwardFlat, gaussian, rightFlat } from './shared';
import type { Pose, Quality, Readout, Toggle, TourStop, World, WorldContext } from './types';
import { type WaveStats, analyse, collapsed, sampleCell, wavevector } from './waveAnalysis';

export { proveSolver } from './hbarSolver';

const GRID: Record<Quality, number> = { low: 256, medium: 384, high: 512 };
/** Leapfrog steps the GPU may take per frame before the wave falls behind real time. */
const MAX_STEPS: Record<Quality, number> = { low: 40, medium: 80, high: 120 };
/** A wavelength must span this many cells for the grid to carry the wave faithfully. */
const RESOLVE_CELLS = 5;
const EYE = 1.7;
const RAPID_RATE = 30;
const READ_INTERVAL = 0.2;

interface Throw {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
}

/** What a stream of identical rolls lands on: a fixed point (classical), or the wave's absorbed distribution so far. */
type Source = { cdf: Float64Array; n: number; complete: boolean } | { point: [number, number] };
type Counts = Record<Lane, { through: number; back: number; dots: number }>;
const emptyCounts = (): Counts => ({ doorway: { through: 0, back: 0, dots: 0 }, slits: { through: 0, back: 0, dots: 0 }, glass: { through: 0, back: 0, dots: 0 } });

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

const VIEW = TERRACE_H + EYE;
const terrace = (x: number, pitch = -0.2): Pose => ({ position: [x, VIEW, 25.05], yaw: 0, pitch });
/** Standing just behind a launch mark, looking down the lane. */
const porch = (x: number): Pose => ({ position: [x, EYE, LAUNCH_Z + 3.3], yaw: 0, pitch: -0.3 });
/** On a side gallery, looking down at the floor of the outer lane beyond its obstacle. */
const gallery = (sx: -1 | 1): Pose => ({ position: [sx * 24.6, VIEW, -1], yaw: sx * 0.58, pitch: -0.45 });

/** World II's content as plain data, readable without WebGL: the teaching kit prints from it. */
export class BigHbarLesson {
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
      lesson: { minutes: 1 },
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
      lesson: {
        minutes: 3,
        explain: [{ toggle: 'wave', prompt: 'Hide the wave and roll again. What can you still see, and what does that tell you about what the wave is?' }],
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
      lesson: {
        minutes: 3,
        explain: [{ toggle: 'detector', prompt: 'With Rapid fire on, how do single dots become stripes? What does each dot tell you about one ball?' }],
      },
    },
    {
      title: 'A detector pins it down',
      text: `Press Measure (M) while it rolls: a detector in the floor interacts with the ball and fires at one spot, drawn at random from |ψ|². That interaction, not anyone looking, leaves a lump as wide as the flash (the detector’s ${DETECTOR_RESOLUTION.toFixed(2)} m resolution), which spreads again faster than before but never turns back into the wave it was.`,
      pose: porch(0),
      toggles: { rapid: false },
      action: 'roll@0+measure@1.2',
      lesson: {
        minutes: 3,
        misconceptions: [
          '“Observing means looking.” Measurement is an interaction with a detector (Huseby & Bungum 2019).',
          '“After a measurement the wave goes back to how it was.” It spreads again from the narrow lump the detector left (about a third of students in one survey, arXiv 1602.05440).',
        ],
      },
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
        reveal: `The wave leaks through a barrier it cannot classically cross. Theory gives ${percent(GLASS.planeWave)} for a wave with exactly the ball’s energy, and the count settles near it.`,
      },
      lesson: { minutes: 3 },
    },
    {
      title: 'Fainter, not slower',
      text: `The panel’s “Glass: speed through” is worked out from the wave past the glass, from the spacing of its crests. Compare it with the ball’s ${BALL.speed} m/s.`,
      pose: gallery(1),
      constants: { hbar: HBAR },
      toggles: { rapid: true },
      action: 'roll@16.125',
      predict: {
        question: 'A ball that tunnels through the glass comes out…',
        options: ['Slower: getting through cost it energy', 'Just as fast as it went in'],
        answer: 1,
        reveal: `No energy is lost in the glass: what gets through averages ${speed(GLASS.speedThrough)}, a touch over the ${BALL.speed} m/s it rolled in at, because faster parts of the wave tunnel more easily. The wave past the glass is fainter because fewer balls get there, not because they are slower.`,
      },
      lesson: {
        minutes: 2,
        misconceptions: ['“A ball that tunnels comes out slower, having lost energy.” Fewer balls get through; those that do keep their speed (Wittmann, Morgan & Bao; McKagan & Wieman).'],
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
}

export class BigHbarWorld extends BigHbarLesson implements World {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.1, 900);
  private field: Field;
  private gpu: GpuSchrodinger;
  private waveUniforms: Record<string, THREE.IUniform>;
  private courtyard: CourtyardScene;
  private record: DetectorRecord;
  private renderer: THREE.WebGLRenderer;
  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && document.pointerLockElement === this.renderer.domElement) this.queuedThrow = true;
  };
  /** A lost GL context has come back (see frame). */
  private restored = false;
  private onRestored = () => {
    this.gpu.contextRestored();
    this.restored = true;
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
    super();
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

    this.courtyard = new CourtyardScene(this.scene, this.waveUniforms, this.field.n, this.quality);
    this.record = new DetectorRecord(this.scene);
    r.domElement.addEventListener('mousedown', this.onMouseDown);
    r.domElement.addEventListener('webglcontextrestored', this.onRestored);
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
    this.record.clearDots();
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
    this.courtyard.ghost.position.set(x, BALL.radius + 0.02, z);
    this.courtyard.spreadRing.scale.setScalar(sigma * Math.SQRT2);
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
      const [kx, kz] = wavevector(this.gpu, (_, j) => cellCentre(j, dx) < OBSTACLE_Z);
      this.crossing = { share: st.beyondOnFloor, speed: (this.hbar * Math.hypot(kx, kz)) / BALL.mass };
    } else {
      this.glassSpeed = c.speed;
      this.crossing = null;
    }
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
    const pick = sampleCell(this.gpu);
    if (!pick) return this.stopAll();
    const [kx, kz] = wavevector(this.gpu);
    const k = Math.hypot(kx, kz);
    const [dx, dz] = this.hbar * k > 0.2 * BALL.mass * BALL.speed ? [kx / k, kz / k] : [this.lastThrow?.dirX ?? 0, this.lastThrow?.dirZ ?? -1];
    this.startBall(pick[0], pick[1], dx, dz);
    this.say('The wavelength fell below what the grid can carry: the ball rolls on as a classical ball, from a spot drawn from |ψ|².');
  }

  /** Fire the floor detector at the ball: at a wave, once a read-back of it as it is now has arrived (see collapse). */
  private measure(ctx: WorldContext) {
    if (this.mode === 'ball') {
      this.clickAt(this.record.fire(this.ball.x, this.ball.z));
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
    const pick = sampleCell(this.gpu);
    if (!pick) return;
    const dx = this.field.dx;
    const fx = pick[0] + DETECTOR_SIGMA * gaussian(), fz = pick[1] + DETECTOR_SIGMA * gaussian();
    // The spot and the response in cells (cell i is centred on i).
    const ci = (fx + HALF) / dx - 0.5, cj = (fz + HALF) / dx - 0.5, sigma = DETECTOR_SIGMA / dx;
    const lump = collapsed(this.gpu, ci, cj, sigma);
    if (!lump) return;
    this.gpu.collapse(r, ci, cj, sigma, 1 / Math.sqrt(lump.norm));
    // The collapse empties the absorbed tally, so the detectors start counting again from nothing.
    this.seen.fill(0);
    this.seenTotal = 0;
    // What lies past the glass from now on was put there by the detector, not by tunnelling.
    this.crossing = null;
    const st = (this.stats = lump.stats);
    this.clickAt(this.record.fire(fx, fz));
    this.lastEvent = `Detector fired at x ${fix1(fx)}, z ${fix1(fz)} m`;
    this.courtyard.ghost.position.set(st.x, BALL.radius + 0.02, st.z);
    this.courtyard.spreadRing.scale.setScalar(st.spread);
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
    this.clickAt(this.record.dot(x, z, where));
  }

  /** Each detection clicks like a Geiger counter, panned toward where it happened. */
  private clickAt(p: THREE.Vector3) {
    const to = p.clone().sub(this.pos).setY(0).normalize();
    click(Math.min(1, 6 / (1 + p.distanceTo(this.pos))), to.dot(rightFlat(this.yaw)));
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
        this.record.clearMarks();
      } else if (verb === 'throw') this.throwFromPlayer(ctx);
      else if (verb === 'roll') this.release({ x: Number(arg), z: LAUNCH_Z, dirX: 0, dirZ: -1 }, ctx);
      else if (verb === 'measure' && arg) this.measureAt = Number(arg);
      else if (verb === 'measure') this.measure(ctx);
    }
  }

  private walk(dt: number, input: InputState) {
    const wish = forwardFlat(this.yaw).multiplyScalar(input.move.z).add(rightFlat(this.yaw).multiplyScalar(input.move.x));
    const target = new THREE.Vector2(wish.x, wish.z);
    if (target.lengthSq() > 1) target.normalize();
    target.multiplyScalar(input.sprint ? 7 : 3.4);
    this.vel.lerp(target, 1 - Math.exp(-10 * dt));
    let x = this.pos.x + this.vel.x * dt;
    let z = this.pos.z + this.vel.y * dt;
    const R = 0.3;
    for (const [x0, x1, z0, z1] of SOLIDS) {
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
    const eye = floorHeight(x, z) + EYE;
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
      if (d > 0) this.courtyard.ballMesh.rotateOnWorldAxis(axis.set((nz - b.z) / d, 0, -(nx - b.x) / d), d / BALL.radius);
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
    const st = (this.stats = analyse(this.gpu));
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
        const pick = fresh && fresh[n * n - 1] > 0 ? sampleIndex(fresh, Math.random()) : sampleCell(this.gpu)?.[2];
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
    // The wave lived in the solver's state textures, which a restored context brings back empty: a roll in flight
    // starts over, as it does on a new grid.
    if (this.restored && this.mode === 'wave' && this.lastThrow) this.launch(this.lastThrow, ctx);
    this.restored = false;
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
    const { surface, ballMesh, ghost, spreadRing } = this.courtyard;
    u.uState.value = this.gpu.texture;
    u.uPeak.value = this.shownPeak;
    u.uWave.value = this.toggle('wave') ? 1 : 0;
    surface.visible = wave && this.toggle('wave');
    ballMesh.visible = this.mode === 'ball';
    ballMesh.position.set(this.ball.x, BALL.radius, this.ball.z);
    const st = this.stats;
    ghost.visible = spreadRing.visible = wave && !!st && st.inField > 0.05;
    if (st && wave) {
      const k = 1 - Math.exp(-8 * dt);
      ghost.position.lerp(new THREE.Vector3(st.x, BALL.radius + 0.02, st.z), k);
      spreadRing.position.set(ghost.position.x, 0.025, ghost.position.z);
      spreadRing.scale.setScalar(THREE.MathUtils.lerp(spreadRing.scale.x, Math.max(0.15, st.spread), k));
      // The ring and the raised sheet describe one lump; once the wave has spread out or split they would
      // only mislead, and the floor alone shows it.
      const lump = 1 - THREE.MathUtils.smoothstep(spreadRing.scale.x, 2.5, 4.5);
      spreadRing.material.opacity = 0.85 * lump;
      u.uSheet.value = lump;
      this.shownPeak += (Math.max(st.peak, this.peakFloor) - this.shownPeak) * (1 - Math.exp(-4 * dt));
    }
    this.record.update(dt, this.yaw);

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
    this.courtyard.regrid(this.field.n, q);
    // A roll in flight starts over on the new grid, as a wave or a ball as the new grid allows.
    if (rolling && this.lastThrow) this.launch(this.lastThrow, ctx);
  }

  dispose() {
    const r = this.renderer;
    r.domElement.removeEventListener('mousedown', this.onMouseDown);
    r.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    this.gpu.dispose(r);
    this.courtyard.dispose();
    this.record.dispose();
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      // An instanced mesh's matrix buffer goes with the mesh's own dispose, not its geometry's.
      o.dispose();
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: THREE.Material) => m.dispose());
    });
    r.shadowMap.enabled = false;
    r.toneMapping = THREE.NoToneMapping;
    r.toneMappingExposure = 1;
  }
}
