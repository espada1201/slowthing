// World I — a town where light crawls. The scenery is rendered in its own rest frame into a cube map
// from the observer's position (moving things drawn at their retarded positions), then a full-screen
// pass aberrates, Doppler-shifts and beams it into what a moving observer sees.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { formatSI } from '../constants';
import { chime } from '../audio';
import { dopplerFactor, observerToWorldDirection, retardedTime, sourceDopplerFactor, velocityFromProper } from '../physics/relativity';
import { whiteLuminance } from '../physics/spectrum';
import { type Vec3, len, scale } from '../physics/vec';
import type { InputState } from '../input';
import noise from '../shaders/noise.glsl?raw';
import groundFrag from '../shaders/slow-ground.frag?raw';
import skyFrag from '../shaders/slow-sky.frag?raw';
import staticVert from '../shaders/slow-static.vert?raw';
import surfaceFrag from '../shaders/slow-surface.frag?raw';
import { knotUniforms, lutUniforms, skyUniforms } from '../lut';
import { cameraRotation, clockString, facing, forwardFlat, fullscreenPass, paint, rightFlat, seeded } from './shared';
import { compositeFragment, movingFragment, movingVertex } from './slowShaders';
import type { Pose, Quality, Readout, Toggle, TourStop, World, WorldContext } from './types';

const TRACK_R = 45;
const TRAM_PROPER_SPEED = 24;
const CAROUSEL_R = 7;
const CAROUSEL_PROPER_SPEED = 13;
const BLINK_PERIOD = 0.6;
const EYE = 1.7;
/** How far from the centre you can go: room for a cruise through town at 0.9 c. */
const BOUND = 260;
const SUN = new THREE.Vector3(0.45, 0.62, -0.64).normalize();
const CLOCK_TOWER = new THREE.Vector3(0, 0, -26);
const CLOCK_START = 10 * 3600 + 8 * 60;
/** Tour cruises start out of town and run straight through it. */
const CRUISE_NORTH: Pose = { position: [4, EYE, 130], yaw: 0, pitch: 0 };
const CRUISE_WEST: Pose = { position: [130, EYE, -4], yaw: Math.PI / 2, pitch: 0 };
/** 20 m inside the loop, facing the stretch where the tram passes with its sunlit side toward you. */
const TERRELL_BEARING = (170 * Math.PI) / 180;
const TERRELL: Pose = { ...facing([25 * Math.cos(TERRELL_BEARING), EYE, 25 * Math.sin(TERRELL_BEARING)], [45 * Math.cos(TERRELL_BEARING), EYE, 45 * Math.sin(TERRELL_BEARING)]), pitch: -0.1 };
const CUBE_SIZE: Record<Quality, number> = { low: 256, medium: 512, high: 1024 };

interface Mover {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  phase0: number;
  radius: number;
  properSpeed: number;
  direction: 1 | -1;
  tram: boolean;
  /** Index of the last flash the observer has seen (lamps only). */
  seenFlash?: number;
}

/** Bell notes for the carousel lamps (C major pentatonic). */
const LAMP_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

const motion = (properSpeed: number, c: number) => {
  const v = properSpeed / Math.sqrt(1 + (properSpeed / c) ** 2);
  return { v, beta: v / c, gamma: Math.sqrt(1 + (properSpeed / c) ** 2) };
};

export class SlowLightWorld implements World {
  readonly id = 'slow-light';
  readonly title = 'Slow Light';
  readonly dials = ['c' as const];
  readonly preset = { c: 12 };
  readonly start: Pose = { position: [0, EYE, 30], yaw: 0, pitch: 0.04 };
  readonly actions = [
    { id: 'cruise', label: 'Cruise', key: 'KeyF' },
    { id: 'stop', label: 'Stop', key: 'KeyX', calm: true },
    { id: 'tram', label: 'Tram', key: 'KeyT' },
  ];
  readonly toggles: Toggle[] = [
    { id: 'aberration', label: 'Aberration', hint: 'Light from the side arrives from ahead when you move', value: true },
    { id: 'doppler', label: 'Doppler colour', hint: 'Spectral shift, including infrared and ultraviolet', value: true },
    { id: 'beaming', label: 'Searchlight', hint: 'Brightness piles up ahead (D⁵ beaming)', value: true },
    { id: 'delay', label: 'Light delay', hint: 'See moving things where they were when light left', value: true },
    { id: 'contraction', label: 'Contraction', hint: 'Moving things are shorter along their motion', value: true },
    { id: 'adapt', label: 'Eye adaptation', hint: 'Your eyes adjust to the glare, as real ones would', value: true },
  ];
  readonly tour: TourStop[] = [
    { title: 'A town at 12 m/s', text: 'Light here crawls at cycling speed. Everything you see left its surface a moment ago, so the world you see is always slightly in the past.', pose: { position: [0, EYE, 30], yaw: 0, pitch: 0.04 }, constants: { c: 12 }, action: 'stop' },
    { title: 'The late clock', text: 'The tower clock reads behind your watch: its light needed time to reach you. Walk away and it seems to slow, walk toward it and it races.', pose: { position: [0, EYE, 40], yaw: 0, pitch: 0.22 }, action: 'stop', predict: { question: 'The clock face is 65 m away and light moves at 12 m/s. Compared with your watch, it reads…', options: ['the same time', 'about 5 s behind', 'about 5 s ahead'], answer: 1, reveal: 'Its light needed 65 m ÷ 12 m/s ≈ 5.4 s to reach you, so you see the clock as it was 5.4 s ago.' } },
    { title: 'Aberration', text: 'Now we cruise at 0.9 c. Light from beside and even behind you arrives from in front, so the world crowds into a tunnel ahead.', pose: CRUISE_NORTH, action: 'cruise', toggles: { aberration: true, doppler: true, beaming: true }, predict: { question: 'At 0.9 c, where do the houses that are level with you appear?', options: ['Still beside you', 'Pushed toward the front', 'Pushed behind you'], answer: 1, reveal: 'Aberration tilts incoming light forward: anything exactly beside you appears just 26° from straight ahead (cos θ′ = β).' } },
    { title: 'Colours you cannot normally see', text: 'With the searchlight off, look ahead: blues slide into ultraviolet and vanish, infrared sunlight climbs into view, and a rainbow rings the way forward. Sprint past 0.98 c (hold Shift) and even the 300 K warmth of the stone begins to glow.', pose: CRUISE_WEST, action: 'cruise', toggles: { aberration: true, doppler: true, beaming: false } },
    { title: 'Searchlight', text: 'With the searchlight back on, brightness ahead rises as D⁵ and the same colours drown in glare. Flip the Searchlight switch to compare.', pose: CRUISE_NORTH, action: 'cruise', toggles: { aberration: true, doppler: true, beaming: true } },
    { title: 'Terrell rotation', text: 'Colour and searchlight are off, so watch only the shape: the tram is Lorentz-contracted, yet it looks turned, not squashed, because light from its far side left earlier. Press T to call it, then switch them back on: side-on it turns almost black, its light redshifted and beamed forward, away from you.', pose: TERRELL, action: 'tram', toggles: { doppler: false, beaming: false }, predict: { question: 'A tram at 0.89 c is Lorentz-contracted to under half its length. As it passes, it looks…', options: ['Squashed flat', 'Turned, as if rotated toward you', 'Exactly normal'], answer: 1, reveal: 'Light delay undoes the squashing and shows you the tram turned. Penrose and Terrell proved this in 1959, half a century after Einstein.' } },
    { title: 'Moving clocks', text: 'Each carousel lamp flashes once per 0.6 s of its own time. At 0.73 c its clock runs at two-thirds speed, and light delay bunches or spreads the flashes you see.', pose: { position: [0, EYE, 19], yaw: 0, pitch: 0.06 }, action: 'stop', toggles: { doppler: true, beaming: true } },
    { title: 'You are younger', text: 'Compare the town clock with your watch: every journey at speed left you a little younger than the town. This is the twin paradox, measured.', predict: { question: 'You have been running about town at near light speed. Who has aged more?', options: ['You', 'The town', 'Neither: motion is relative'], answer: 1, reveal: 'The town. You took a path through spacetime with less proper time, and the readout shows the difference.' } },
    { title: 'The real universe', text: 'Reset c to 299 792 458 m/s. Every effect vanishes at walking speed, which is why nobody noticed any of this for most of history.', constants: { c: 299792458 }, action: 'stop' },
  ];

  private scene = new THREE.Scene();
  private cubeTarget!: THREE.WebGLCubeRenderTarget;
  private cubeCamera!: THREE.CubeCamera;
  private composite = fullscreenPass(compositeFragment, {
    uCube: { value: null },
    uBeta: { value: new THREE.Vector3() },
    uCamRot: { value: new THREE.Matrix3() },
    uTan: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 1 },
    uDoppler: { value: 1 },
    uBeaming: { value: 1 },
    uExposure: { value: 1 },
  });
  private logExposure = 0;
  private tramOffset = 0;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private clockMaterial: THREE.ShaderMaterial;
  private movers: Mover[] = [];
  private obstacles: THREE.Box2[] = [];
  private materials: THREE.ShaderMaterial[] = [];

  private pos = new THREE.Vector3(...this.start.position);
  private properVel = new THREE.Vector3();
  private cruise: THREE.Vector3 | null = null;
  private atEdge = false;
  private yaw = this.start.yaw;
  private pitch = this.start.pitch;
  /** World (town) coordinate time and the player's proper time, seconds. */
  private t = 0;
  private tau = 0;
  private fov = 75;

  constructor(ctx: WorldContext) {
    this.buildCube(ctx.quality);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 48, 24),
      this.material(staticVert, `${noise}\n${skyFrag}`, { uObs: { value: this.pos } }, THREE.BackSide),
    );
    this.scene.add(this.sky);
    this.clockMaterial = this.buildClockMaterial();
    this.buildTown();
  }

  private material(vert: string, frag: string, uniforms: Record<string, THREE.IUniform> = {}, side: THREE.Side = THREE.FrontSide, defines: Record<string, string> = {}) {
    const m = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uSun: { value: SUN }, uBlinkPeriod: { value: BLINK_PERIOD }, ...uniforms },
      side,
      defines,
    });
    this.materials.push(m);
    return m;
  }

  private buildCube(q: Quality) {
    this.cubeTarget?.dispose();
    const mip = q !== 'low';
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(CUBE_SIZE[q], {
      type: THREE.HalfFloatType,
      generateMipmaps: mip,
      minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    if (this.cubeCamera) this.scene.remove(this.cubeCamera);
    this.cubeCamera = new THREE.CubeCamera(0.1, 2000, this.cubeTarget);
    this.scene.add(this.cubeCamera);
    this.composite.material.uniforms.uCube.value = this.cubeTarget.texture;
  }

  /** Clock faces show the town time at which the light reaching you left each point of the face. */
  private buildClockMaterial() {
    return this.material(
      staticVert,
      `uniform float uTownTime; uniform vec3 uObs; uniform float uC; uniform float uDelay;
      varying vec3 vWorld; varying vec3 vNormal; varying vec3 vColor; varying float vPattern;
      float seg(vec2 p, vec2 dir, float len, float w) {
        float t = clamp(dot(p, dir), 0.0, len);
        return smoothstep(w, w * 0.6, length(p - dir * t));
      }
      void main() {
        float uClockTime = uTownTime - uDelay * length(uObs - vWorld) / uC;
        vec2 p = vColor.xy;
        float r = length(p);
        vec3 col = vec3(0.95, 0.92, 0.84);
        float ticks = step(0.82, r) * step(r, 0.95) * step(0.985, cos(atan(p.y, p.x) * 12.0));
        col = mix(col, vec3(0.1), ticks);
        float s = mod(uClockTime, 60.0) / 60.0 * 6.2831853;
        float m = mod(uClockTime, 3600.0) / 3600.0 * 6.2831853;
        float h = mod(uClockTime, 43200.0) / 43200.0 * 6.2831853;
        col = mix(col, vec3(0.08), seg(p, vec2(sin(h), cos(h)), 0.5, 0.06));
        col = mix(col, vec3(0.08), seg(p, vec2(sin(m), cos(m)), 0.78, 0.045));
        col = mix(col, vec3(0.86, 0.22, 0.12), seg(p, vec2(sin(s), cos(s)), 0.86, 0.025));
        col = mix(col, vec3(0.4, 0.3, 0.15), smoothstep(0.96, 0.98, r));
        gl_FragColor = vec4(col * 1.05, 1.0);
      }`,
      { uTownTime: { value: CLOCK_START }, uObs: { value: this.pos }, uC: { value: 12 }, uDelay: { value: 1 } },
    );
  }

  private buildTown() {
    const rand = seeded(7);
    const statics: THREE.BufferGeometry[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, pattern = 0, rotY = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateY(rotY);
      g.translate(x, y + h / 2, z);
      statics.push(paint(g, color, pattern));
    };

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), this.material(staticVert, `${noise}\n${groundFrag}`, { uTrackRadius: { value: TRACK_R } }));
    this.scene.add(ground);

    // Houses in a ring outside the tram loop, with gaps for four streets.
    const palette = [0xc8553d, 0xe0a458, 0x2f7f79, 0xe9dcc3, 0x5b6c8f, 0x9c6644, 0xd9c89e, 0x7a9e7e];
    for (let ring = 0; ring < 2; ring++) {
      const R = 62 + ring * 16;
      const count = 22 + ring * 6;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + ring * 0.07;
        const w = 7 + rand() * 6, d = 7 + rand() * 4, h = 6 + rand() * (ring ? 16 : 10);
        const x = Math.cos(a) * R, z = Math.sin(a) * R;
        const half = Math.max(w, d) / 2 + 0.5;
        if (Math.abs(x) < half + 7 || Math.abs(z) < half + 7) continue; // keep the four streets open
        const color = palette[Math.floor(rand() * palette.length)];
        box(w, h, d, x, 0, z, color, 1, -a);
        const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.72, 3 + rand() * 2, 4);
        roof.rotateY(Math.PI / 4 - a);
        roof.translate(x, h + 1.5, z);
        statics.push(paint(roof, rand() > 0.5 ? 0x7d3c2b : 0x3f4a52));
        const bb = new THREE.Box2().setFromCenterAndSize(new THREE.Vector2(x, z), new THREE.Vector2(Math.max(w, d) + 1, Math.max(w, d) + 1));
        this.obstacles.push(bb);
      }
    }
    // Trees between the houses and the track.
    for (let i = 0; i < 46; i++) {
      const a = rand() * Math.PI * 2;
      const R = 52 + rand() * 6;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      if (Math.abs(x) < 9 || Math.abs(z) < 9) continue;
      const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6);
      trunk.translate(x, 1.2, z);
      statics.push(paint(trunk, 0x5a4030));
      const crown = new THREE.IcosahedronGeometry(1.8 + rand(), 0);
      crown.translate(x, 3.6 + rand(), z);
      statics.push(paint(crown, rand() > 0.5 ? 0x3d6b35 : 0x56803f));
    }
    // A colonnade lining the avenue from the start toward the plaza.
    for (let i = 0; i < 9; i++) {
      for (const side of [-1, 1]) {
        const x = side * 9, z = 34 - i * 4;
        box(1.2, 0.5, 1.2, x, 0, z, 0xd8d2c4);
        const col = new THREE.CylinderGeometry(0.42, 0.48, 6, 16);
        col.translate(x, 3.5, z);
        statics.push(paint(col, 0xefe9dc));
        box(1.3, 0.5, 1.3, x, 6.5, z, 0xd8d2c4);
        this.obstacles.push(new THREE.Box2().setFromCenterAndSize(new THREE.Vector2(x, z), new THREE.Vector2(1.6, 1.6)));
      }
    }
    for (const side of [-1, 1]) box(1.3, 0.8, 34, side * 9, 7, 18, 0xd8d2c4);

    // Clock tower with four faces.
    const T = CLOCK_TOWER;
    box(5, 19, 5, T.x, 0, T.z, 0xb8a27e, 0);
    box(5.8, 1, 5.8, T.x, 19, T.z, 0x8a6f4a);
    const spire = new THREE.ConeGeometry(4, 6, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(T.x, 23, T.z);
    statics.push(paint(spire, 0x2f5d62));
    this.obstacles.push(new THREE.Box2().setFromCenterAndSize(new THREE.Vector2(T.x, T.z), new THREE.Vector2(6, 6)));
    for (let k = 0; k < 4; k++) {
      const face = new THREE.CircleGeometry(2.1, 48);
      const n = face.getAttribute('position').count;
      const local = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        local[i * 3] = face.getAttribute('position').getX(i) / 2.1;
        local[i * 3 + 1] = face.getAttribute('position').getY(i) / 2.1;
      }
      face.setAttribute('aColor', new THREE.BufferAttribute(local, 3));
      face.setAttribute('aPattern', new THREE.BufferAttribute(new Float32Array(n), 1));
      face.translate(0, 0, 2.52);
      face.rotateY((k * Math.PI) / 2);
      face.translate(T.x, 14.5, T.z);
      this.scene.add(new THREE.Mesh(face, this.clockMaterial));
    }

    // Carousel hub.
    const hub = new THREE.CylinderGeometry(1.4, 1.8, 5, 24);
    hub.translate(0, 2.5, 0);
    statics.push(paint(hub, 0xc8553d));
    const canopy = new THREE.ConeGeometry(CAROUSEL_R + 1.5, 2.5, 32);
    canopy.translate(0, 6.6, 0);
    statics.push(paint(canopy, 0xe9dcc3));
    this.obstacles.push(new THREE.Box2().setFromCenterAndSize(new THREE.Vector2(0, 0), new THREE.Vector2(3.6, 3.6)));

    // Distant mountains.
    const hills: number[] = [];
    const N = 120;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const h0 = 40 + 60 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11)) + 20 * rand();
      const R = 650;
      hills.push(Math.cos(a0) * R, 0, Math.sin(a0) * R, Math.cos(a1) * R, 0, Math.sin(a1) * R, Math.cos((a0 + a1) / 2) * R, h0, Math.sin((a0 + a1) / 2) * R);
    }
    const hillGeo = new THREE.BufferGeometry();
    hillGeo.setAttribute('position', new THREE.Float32BufferAttribute(hills, 3));
    hillGeo.computeVertexNormals();
    statics.push(paint(hillGeo, 0x6f8196));

    const merged = mergeGeometries(statics);
    this.scene.add(new THREE.Mesh(merged, this.material(staticVert, surfaceFrag, {}, THREE.DoubleSide)));
    statics.forEach((g) => g.dispose());

    // Tram: four cars on the loop.
    const car = () => {
      const parts: THREE.BufferGeometry[] = [];
      const add = (g: THREE.BufferGeometry, color: number, pattern = 0) => parts.push(paint(g, color, pattern));
      add(new THREE.BoxGeometry(7.2, 1.4, 2.5).translate(0, 1.2, 0), 0xc8553d);
      add(new THREE.BoxGeometry(7.2, 1.3, 2.5).translate(0, 2.55, 0), 0xf0e6cf);
      for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(1.0, 0.9, 2.56).translate(i * 1.4, 2.55, 0), 0x22313a);
      add(new THREE.BoxGeometry(7.4, 0.3, 2.7).translate(0, 3.35, 0), 0x3f4a52);
      add(new THREE.BoxGeometry(6.4, 0.5, 2.0).translate(0, 0.3, 0), 0x222222);
      add(new THREE.BoxGeometry(0.1, 0.35, 0.5).translate(3.62, 1.3, 0.75), 0xfff2c0, 2);
      add(new THREE.BoxGeometry(0.1, 0.35, 0.5).translate(3.62, 1.3, -0.75), 0xfff2c0, 2);
      add(new THREE.BoxGeometry(0.1, 0.35, 0.5).translate(-3.62, 1.3, 0.75), 0xff3b1f, 2);
      add(new THREE.BoxGeometry(0.1, 0.35, 0.5).translate(-3.62, 1.3, -0.75), 0xff3b1f, 2);
      const g = mergeGeometries(parts);
      parts.forEach((p) => p.dispose());
      return g;
    };
    const tramGeo = car();
    for (let i = 0; i < 4; i++) this.addMover(tramGeo, (-i * 8) / TRACK_R, TRACK_R, TRAM_PROPER_SPEED, 1, true);

    // Carousel lamps.
    const lampGeo = mergeGeometries([
      paint(new THREE.SphereGeometry(0.5, 20, 12).translate(0, 3.0, 0), 0xffd27a, 3),
    ]);
    for (let i = 0; i < 8; i++) this.addMover(lampGeo, (i / 8) * Math.PI * 2, CAROUSEL_R, CAROUSEL_PROPER_SPEED, -1, false);
  }

  private addMover(geometry: THREE.BufferGeometry, phase0: number, radius: number, properSpeed: number, direction: 1 | -1, tram: boolean) {
    const mat = this.material(
      movingVertex,
      movingFragment,
      {
        uObs: { value: this.pos },
        uC: { value: 12 },
        uPhase: { value: 0 },
        uOmega: { value: 0 },
        uRadius: { value: radius },
        uCenter: { value: new THREE.Vector3() },
        uGamma: { value: 1 },
        uBeta: { value: 0 },
        uRetard: { value: 1 },
        uContract: { value: 1 },
        uTauNow: { value: 0 },
        uAberrationOn: { value: 1 },
        uDopplerOn: { value: 1 },
        uBeamingOn: { value: 1 },
        uObsBeta: { value: this.composite.material.uniforms.uBeta.value },
        ...lutUniforms(),
        ...knotUniforms(),
        ...skyUniforms(),
      },
      THREE.FrontSide,
      { MOVING: '' },
    );
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.movers.push({ mesh, phase0, radius, properSpeed, direction, tram });
  }

  private toggle(id: string) {
    return this.toggles.find((t) => t.id === id)!.value;
  }

  setPose(p: Pose) {
    this.pos.set(...p.position);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
  }

  runAction(id: string, ctx: WorldContext) {
    if (id === 'stop') {
      this.cruise = null;
      this.properVel.set(0, 0, 0);
    } else if (id === 'cruise') {
      // Proper speed giving β = 0.9 at the current c.
      const u = (0.9 / Math.sqrt(1 - 0.81)) * ctx.constants.c;
      this.cruise = forwardFlat(this.yaw).multiplyScalar(u);
    } else if (id === 'tram') {
      // Bring the tram round so its head reaches the observer's bearing in about three seconds.
      this.runAction('stop', ctx);
      const omega = motion(TRAM_PROPER_SPEED, ctx.constants.c).v / TRACK_R;
      this.tramOffset = Math.atan2(this.pos.z, this.pos.x) - omega * (this.t + 3);
    }
  }

  frame(dt: number, input: InputState, ctx: WorldContext) {
    const c = ctx.constants.c;
    this.yaw = input.yaw;
    this.pitch = input.pitch;

    // Player: input is a proper acceleration; proper velocity u = γv is unbounded, v never reaches c.
    const wish = forwardFlat(this.yaw).multiplyScalar(input.move.z).add(rightFlat(this.yaw).multiplyScalar(input.move.x));
    const pushing = wish.lengthSq() > 0;
    if (pushing) this.cruise = null;
    const uMax = input.sprint ? 60 : 6;
    if (this.cruise) {
      this.properVel.lerp(this.cruise, 1 - Math.exp(-2.5 * dt));
    } else if (pushing) {
      wish.normalize();
      this.properVel.addScaledVector(wish, (input.sprint ? 30 : 12) * dt);
      if (this.properVel.length() > uMax) this.properVel.setLength(Math.max(uMax, this.properVel.length() * Math.exp(-2 * dt)));
    } else {
      this.properVel.multiplyScalar(Math.exp(-3 * dt));
      if (this.properVel.length() < 0.02) this.properVel.set(0, 0, 0);
    }
    const gamma = Math.sqrt(1 + this.properVel.lengthSq() / (c * c));
    this.pos.addScaledVector(this.properVel, dt);
    this.collide();
    this.tau += dt;
    this.t += gamma * dt;

    // Movers: analytic circular paths in town time.
    for (const m of this.movers) {
      const { v, beta, gamma: g } = motion(m.properSpeed, c);
      const omega = (m.direction * v) / m.radius;
      const u = m.mesh.material.uniforms;
      u.uC.value = c;
      u.uOmega.value = omega;
      u.uPhase.value = (m.phase0 + omega * this.t + (m.tram ? this.tramOffset : 0)) % (Math.PI * 2);
      u.uGamma.value = g;
      u.uBeta.value = beta;
      u.uTauNow.value = (this.t / g) % (BLINK_PERIOD * 1000);
      u.uRetard.value = this.toggle('delay') ? 1 : 0;
      u.uContract.value = this.toggle('contraction') ? 1 : 0;
      u.uAberrationOn.value = this.toggle('aberration') ? 1 : 0;
      u.uDopplerOn.value = this.toggle('doppler') ? 1 : 0;
      u.uBeamingOn.value = this.toggle('beaming') ? 1 : 0;
    }
    this.ringLamps(c);
    const clock = this.clockMaterial.uniforms;
    clock.uTownTime.value = CLOCK_START + this.t;
    clock.uC.value = c;
    clock.uDelay.value = this.toggle('delay') ? 1 : 0;
    this.sky.position.copy(this.pos);

    // The movers shade with the observer's velocity too (uObsBeta is the same vector), so set it before drawing them.
    const u = this.composite.material.uniforms;
    u.uBeta.value.set(...velocityFromProper(this.properVel.toArray(), c)).divideScalar(c);
    const r = ctx.renderer;
    this.cubeCamera.position.copy(this.pos);
    this.cubeCamera.update(r, this.scene);

    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.fov / 2));
    u.uTan.value.set(tanY * (size.x / size.y), tanY);
    u.uCamRot.value.copy(cameraRotation(this.yaw, this.pitch));
    u.uAberration.value = this.toggle('aberration') ? 1 : 0;
    u.uDoppler.value = this.toggle('doppler') ? 1 : 0;
    u.uBeaming.value = this.toggle('beaming') ? 1 : 0;
    this.adaptEyes(dt, u.uCamRot.value, u.uBeta.value, u.uTan.value);
    u.uExposure.value = this.toggle('adapt') ? Math.exp(this.logExposure) : 1;
    r.setRenderTarget(null);
    r.render(this.composite.scene, this.composite.camera);
  }

  /**
   * Each lamp rings when its flash *reaches you*: the flash happens on the lamp's own (dilated) clock at the
   * retarded time, and the bell is pitched by the same Doppler factor that shifts the lamp's colour.
   */
  private ringLamps(c: number) {
    const betaObs = scale(velocityFromProper(this.properVel.toArray(), c), 1 / c);
    const obs: Vec3 = [this.pos.x, this.pos.y, this.pos.z];
    let lamp = 0;
    for (const m of this.movers) {
      if (m.tram) continue;
      const { v, gamma } = motion(m.properSpeed, c);
      const omega = (m.direction * v) / m.radius;
      const path = (t: number): Vec3 => [m.radius * Math.cos(m.phase0 + omega * t), 3, m.radius * Math.sin(m.phase0 + omega * t)];
      const vel = (t: number): Vec3 => [-m.radius * omega * Math.sin(m.phase0 + omega * t), 0, m.radius * omega * Math.cos(m.phase0 + omega * t)];
      const tr = this.toggle('delay') ? retardedTime(path, vel, obs, this.t, c, 8) : this.t;
      const flash = Math.floor(tr / gamma / BLINK_PERIOD);
      const note = LAMP_NOTES[lamp++ % LAMP_NOTES.length];
      if (m.seenFlash !== undefined && flash > m.seenFlash) {
        const p = path(tr);
        const d: Vec3 = [obs[0] - p[0], obs[1] - p[1], obs[2] - p[2]];
        const dist = Math.hypot(...d);
        const k: Vec3 = [d[0] / dist, d[1] / dist, d[2] / dist];
        const u = vel(tr);
        const dSrc = sourceDopplerFactor([u[0] / c, u[1] / c, u[2] / c], k);
        const nW: Vec3 = [-k[0], -k[1], -k[2]];
        const dObs = dopplerFactor(nW, betaObs);
        const D = this.toggle('doppler') ? dSrc * dObs : 1;
        const seen = this.toggle('aberration') ? observerToWorldDirection(nW, [-betaObs[0], -betaObs[1], -betaObs[2]]) : nW;
        const right = rightFlat(this.yaw);
        chime(note * D, (0.8 / (1 + dist / 12)) * Math.min(3, this.toggle('beaming') ? D * D : 1), seen[0] * right.x + seen[2] * right.z);
      }
      m.seenFlash = flash;
    }
  }

  /**
   * Eye adaptation: estimate the scene's log-average brightness from the Doppler factor across the view
   * (a white surface seen through the same aberration, colour shift and beaming) and ease exposure toward it.
   * The eyes keep adapting while the switch is off; the switch only decides whether you see through them.
   */
  private adaptEyes(dt: number, rot: THREE.Matrix3, beta: THREE.Vector3, tan: THREE.Vector2) {
    const b: Vec3 = [beta.x, beta.y, beta.z];
    const e = rot.elements;
    let sum = 0, n = 0;
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 7; j++) {
        const x = (i / 8 - 0.5) * 2 * tan.x, y = (j / 6 - 0.5) * 2 * tan.y;
        const l = Math.hypot(x, y, 1);
        const nObs: Vec3 = [(e[0] * x + e[3] * y - e[6]) / l, (e[1] * x + e[4] * y - e[7]) / l, (e[2] * x + e[5] * y - e[8]) / l];
        const nW = this.toggle('aberration') ? observerToWorldDirection(nObs, b) : nObs;
        const D = dopplerFactor(nW, b);
        const L = (this.toggle('doppler') ? whiteLuminance(D) : 1) * (this.toggle('beaming') ? D ** 5 : 1);
        sum += Math.log(Math.max(L, 1e-4));
        n++;
      }
    }
    const target = Math.max(-9, Math.min(4, -sum / n));
    this.logExposure += (target - this.logExposure) * (1 - Math.exp(-3 * dt));
  }

  private collide() {
    const p2 = new THREE.Vector2(this.pos.x, this.pos.z);
    for (const b of this.obstacles) {
      if (!b.containsPoint(p2)) continue;
      const dx = Math.min(p2.x - b.min.x, b.max.x - p2.x);
      const dz = Math.min(p2.y - b.min.y, b.max.y - p2.y);
      if (dx < dz) p2.x = p2.x - b.min.x < b.max.x - p2.x ? b.min.x : b.max.x;
      else p2.y = p2.y - b.min.y < b.max.y - p2.y ? b.min.y : b.max.y;
      this.properVel.multiplyScalar(0.5);
      this.cruise = null;
    }
    if (p2.length() > BOUND) {
      p2.setLength(BOUND);
      // The edge of the world: stop dead rather than slide along it with the clocks still running fast.
      if (this.properVel.dot(this.pos.clone().setY(0)) > 0) this.properVel.set(0, 0, 0);
      this.cruise = null;
      this.atEdge = true;
    } else if (p2.length() < BOUND - 1) this.atEdge = false;
    this.pos.set(p2.x, EYE, p2.y);
  }

  readouts(ctx: WorldContext): Readout[] {
    const c = ctx.constants.c;
    const v = len(velocityFromProper(this.properVel.toArray(), c));
    const beta = v / c;
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    return [
      { label: 'Speed', value: `${formatSI(v)} m/s` },
      { label: 'β = v/c', value: beta.toFixed(3), gauge: beta },
      { label: 'γ', value: gamma.toFixed(3), gauge: Math.min(1, (gamma - 1) / 4) },
      { label: 'Your watch τ', value: clockString(CLOCK_START + this.tau) },
      { label: 'Town clock t', value: clockString(CLOCK_START + this.t) },
      { label: 'You are younger by', value: `${(this.t - this.tau).toFixed(2)} s` },
    ];
  }

  status(ctx: WorldContext) {
    if (this.atEdge) return 'Edge of town. Turn round and cruise back through it (F).';
    const tram = motion(TRAM_PROPER_SPEED, ctx.constants.c);
    return `Tram ${tram.beta.toFixed(2)} c · carousel ${motion(CAROUSEL_PROPER_SPEED, ctx.constants.c).beta.toFixed(2)} c`;
  }

  setQuality(q: Quality) {
    this.buildCube(q);
  }

  dispose() {
    this.cubeTarget.dispose();
    this.composite.dispose();
    this.materials.forEach((m) => m.dispose());
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
