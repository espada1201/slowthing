// The Big ħ courtyard: one floor plan drives both the 3D walls and the potential the wave sees.
// Every edge sits on a multiple of 0.375 m, which is a whole number of cells on all three grids
// (256, 384, 512 over 48 m), so the physics is identical at every quality setting.

import { barrierTransmission, packetAverage } from '../physics/schrodinger';

export const HALF = 24;
export const FIELD = 2 * HALF;
/** The obstacles stand 14 m in front of the back screen: far enough for the patterns to open out, near enough to catch them. */
export const OBSTACLE_Z = -7.875;
export const PORCH_Z = 10.125;
/** The courtyard's ħ (J·s): it gives the rolled ball a wavelength of about a metre. */
export const HBAR = 0.25;
export const BALL = { mass: 0.4, speed: 4, radius: 0.11 };
/** Kinetic energy of the rolled ball, ½mv² = 3.2 J. */
export const ENERGY = 0.5 * BALL.mass * BALL.speed ** 2;
/** The glass needs 15% more energy than the ball has. */
export const GLASS_V0 = 1.15 * ENERGY;
export const GLASS_THICKNESS = 0.375;
/**
 * σ (m) of |ψ|² for a ball rolled down the glass lane. A longer packet has a narrower spread of wavenumbers (1/2σ),
 * so of energies: at the courtyard's ħ, 95% of the packet lies below the barrier once σ passes 1.78 m, and 97% at
 * 2 m, so what gets through has tunnelled, not gone over the top. Much longer, and what gets through would no longer
 * fit between the glass and the far wall's absorber, where its speed is read.
 */
export const GLASS_SIGMA = 2;
/**
 * The glass experiment in theory. A slab only cares about the wavenumber k across it, so the plane-wave transmission
 * T(k) is averaged over the packet's spread of k: the share of the packet below the barrier (too slow to cross the
 * glass classically), the share that gets through, and the mean speed of what gets through.
 */
export function glassTheory(hbar: number) {
  const p = { mass: BALL.mass, hbar };
  const k0 = (BALL.mass * BALL.speed) / hbar, kGlass = Math.sqrt(2 * BALL.mass * GLASS_V0) / hbar;
  const T = (k: number) => barrierTransmission((hbar * k) ** 2 / (2 * BALL.mass), GLASS_V0, GLASS_THICKNESS, p);
  const through = packetAverage(k0, GLASS_SIGMA, T);
  return {
    planeWave: T(k0),
    below: packetAverage(k0, GLASS_SIGMA, (k) => (k < kGlass ? 1 : 0)),
    through,
    speedThrough: (hbar * packetAverage(k0, GLASS_SIGMA, (k) => k * T(k))) / through / BALL.mass,
  };
}

export type Lane = 'doorway' | 'slits' | 'glass';
export const LANES: { id: Lane; name: string; x0: number; x1: number }[] = [
  { id: 'doorway', name: 'The doorway', x0: -HALF, x1: -8.25 },
  { id: 'slits', name: 'Two openings', x0: -7.875, x1: 7.875 },
  { id: 'glass', name: 'The glass', x0: 8.25, x1: HALF },
];

export interface Block {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  kind: 'wall' | 'glass';
  /** Visual height of the 3D wall; the simulation is the 2D floor plan. */
  height: number;
}

const wall = (x0: number, x1: number, z0: number, z1: number, height: number): Block => ({ x0, x1, z0, z1, kind: 'wall', height });
const OB = [OBSTACLE_Z, OBSTACLE_Z + 0.375] as const;

export const BLOCKS: Block[] = [
  // Lane dividers.
  wall(-8.25, -7.875, -HALF, PORCH_Z, 3.6),
  wall(7.875, 8.25, -HALF, PORCH_Z, 3.6),
  // I. A single doorway, 1.5 m wide.
  wall(-HALF, -16.875, ...OB, 0.6),
  wall(-15.375, -8.25, ...OB, 0.6),
  // II. Two openings 1.5 m wide, 5.25 m apart (centre to centre).
  wall(-7.875, -3.375, ...OB, 0.6),
  wall(-1.875, 1.875, ...OB, 0.6),
  wall(3.375, 7.875, ...OB, 0.6),
  // III. A pane of glass the ball cannot classically cross.
  { x0: 8.25, x1: HALF, z0: OB[0], z1: OB[1], kind: 'glass', height: 1.6 },
];

/** Absorbing edges: the outer rim of the floor, and the divider faces beyond the obstacles. */
export const SPONGE = { rim: 2.5, divider: 1.2, rate: 12 };

export function spongeRate(x: number, z: number): number {
  const d = Math.min(x + HALF, HALF - x, z + HALF, HALF - z);
  let s = d < SPONGE.rim ? ((SPONGE.rim - d) / SPONGE.rim) ** 2 : 0;
  if (z < OBSTACLE_Z) {
    const dd = Math.min(Math.abs(x - 7.875), Math.abs(x - 8.25), Math.abs(x + 7.875), Math.abs(x + 8.25));
    if (dd < SPONGE.divider) s = Math.max(s, ((SPONGE.divider - dd) / SPONGE.divider) ** 2);
  }
  return s * SPONGE.rate;
}

export interface Field {
  n: number;
  dx: number;
  potential: Float32Array;
  open: Float32Array;
  sponge: Float32Array;
}

/** Cell centre of index i (same along x and z). */
export const cellCentre = (i: number, dx: number) => -HALF + (i + 0.5) * dx;
export const cellIndex = (v: number, dx: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((v + HALF) / dx)));

export function rasterize(n: number): Field {
  const dx = FIELD / n;
  const potential = new Float32Array(n * n);
  const open = new Float32Array(n * n).fill(1);
  const sponge = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = cellCentre(j, dx);
    for (let i = 0; i < n; i++) {
      const x = cellCentre(i, dx);
      const k = j * n + i;
      sponge[k] = spongeRate(x, z);
      for (const b of BLOCKS) {
        if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
        if (b.kind === 'wall') open[k] = 0;
        else potential[k] = GLASS_V0;
      }
    }
  }
  return { n, dx, potential, open, sponge };
}

export const laneOf = (x: number): Lane => (x < -8.0625 ? 'doorway' : x > 8.0625 ? 'glass' : 'slits');

/** Where an absorbed ball ends up: on the back screen, on a side absorber past the obstacle, or back out. */
export function absorberOf(z: number): 'screen' | 'side' | 'back' {
  if (z < -HALF + SPONGE.rim) return 'screen';
  return z < OBSTACLE_Z ? 'side' : 'back';
}
