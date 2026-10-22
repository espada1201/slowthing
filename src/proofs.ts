// Checks that run in the visitor's own browser: the physics core against textbook results, and the GPU
// shaders the worlds actually use against that independent CPU physics.

import type * as THREE from 'three';
import { aberrationAngle, dopplerFactor, lorentzFactor, retardedTime } from './physics/relativity';
import { Schrodinger2D, barrierTransmission, freeSpreadWidth, packetAverage, stableTimeStep } from './physics/schrodinger';
import { CRITICAL_IMPACT, exactDeflection, traceRay, tracedDeflection } from './physics/schwarzschild';
import { cieXYZ } from './physics/spectrum';
import { type Vec3, add, dot, scale, sub } from './physics/vec';

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

export const fmt = (x: number) => (x === 0 ? '0' : Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4 ? x.toExponential(1) : Math.abs(x) < 1 ? x.toPrecision(2) : x.toFixed(2));
export const deg = Math.PI / 180;

export function within(errors: number[], tol: number, unit = ''): ProofResult {
  const worst = Math.max(...errors);
  return { pass: worst <= tol, measured: `max error ${fmt(worst)}${unit}`, expected: `≤ ${fmt(tol)}${unit}` };
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
      const T = packetAverage(k0, sigma, (k) => barrierTransmission((k * k) / 2, V0, a, p)), got = through / total;
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
  const [l, h, g] = await Promise.all([import('./worlds/slowLightProofs'), import('./worlds/bigHbar'), import('./worlds/bigG')]);
  const out: Proof[] = [
    {
      id: 'gpu-aberration',
      world: 'I',
      gpu: true,
      title: 'GPU aberration shader',
      claim: 'The shader that bends your view at speed sends every pixel to the direction the Lorentz transformation predicts.',
      run: l.proveAberration,
    },
    {
      id: 'gpu-doppler',
      world: 'I',
      gpu: true,
      title: 'GPU spectral Doppler shader',
      claim: 'The colour each pixel shows matches a full spectral integration (sunlight, reflectance, 300 K glow, CIE observer) at that pixel’s Doppler factor.',
      run: l.proveDoppler,
    },
    {
      id: 'gpu-retarded',
      world: 'I',
      gpu: true,
      title: 'GPU light-delay shader',
      claim: 'The vertex shader that draws trams and lamps where they were when their light left puts every vertex where the CPU light-cone solver does, from inside the loop to 260 m away, at up to 0.95 c. With light delay off it draws them at your now, where the CPU simultaneity solver does, even while you cruise.',
      run: l.proveRetarded,
    },
    {
      id: 'gpu-tram-colour',
      world: 'I',
      gpu: true,
      title: 'GPU tram colour shader',
      claim: 'The shader that colours trams and lamps gives every tested face the colour a full spectral calculation does: sunlight and sky light shifted onto the moving tram, reflected, then shifted again on the way to you.',
      run: l.proveTramColour,
    },
  ];
  out.push({ id: 'gpu-schrodinger', world: 'II', gpu: true, title: 'GPU Schrödinger solver', claim: 'The courtyard’s fragment-shader solver produces the same wavefunction as the CPU reference, step for step.', run: h.proveSolver });
  out.push({ id: 'gpu-geodesics', world: 'III', gpu: true, title: 'GPU black-hole ray-marcher', claim: 'Every pixel’s light path through the shader ends where the CPU geodesic integrator says it should.', run: g.proveRays });
  return out;
}
