// Special relativity for an observer moving through a world whose rest frame is the scenery.
// Directions are unit 3-vectors as [x, y, z] tuples; velocities are expressed as β = v / c.

import { type Vec3, add, dot, len, scale, sub } from './vec';

export function lorentzFactor(beta: number): number {
  if (beta < 0 || beta >= 1) throw new RangeError(`β must be in [0, 1), got ${beta}`);
  return 1 / Math.sqrt(1 - beta * beta);
}

/** Apparent angle (observer frame) of a source seen at angle θ from the direction of motion in the world frame. */
export function aberrationAngle(theta: number, beta: number): number {
  const c = Math.cos(theta);
  return Math.acos((c + beta) / (1 + beta * c));
}

/**
 * Map a viewing direction in the observer's frame to the world-frame direction the light came from.
 * `beta` is the observer's velocity in the world frame (|β| < 1). Both directions point from eye to source.
 */
export function observerToWorldDirection(nObs: Vec3, beta: Vec3): Vec3 {
  const b = len(beta);
  if (b < 1e-12) return nObs;
  const g = lorentzFactor(b);
  const bh = scale(beta, 1 / b);
  const par = dot(nObs, bh);
  const perp = sub(nObs, scale(bh, par));
  const denom = 1 - dot(beta, nObs);
  return add(scale(bh, (par - b) / denom), scale(perp, 1 / (g * denom)));
}

/** Frequency ratio ν_observed / ν_world for light arriving from world-frame view direction n (eye → source). */
export function dopplerFactor(nWorld: Vec3, beta: Vec3): number {
  const b = len(beta);
  if (b < 1e-12) return 1;
  return lorentzFactor(b) * (1 + dot(beta, nWorld));
}

/** Frequency ratio ν_world / ν_emitted for a source moving with velocity βs, seen along unit vector k (source → eye). */
export function sourceDopplerFactor(betaSource: Vec3, kToEye: Vec3): number {
  const b = len(betaSource);
  if (b < 1e-12) return 1;
  return 1 / (lorentzFactor(b) * (1 - dot(betaSource, kToEye)));
}

/** Velocity from proper velocity u = γv (both in m/s). Keeps |v| < c however hard the player pushes. */
export function velocityFromProper(u: Vec3, c: number): Vec3 {
  const uu = len(u);
  return scale(u, 1 / Math.sqrt(1 + (uu * uu) / (c * c)));
}

/**
 * Solve the light-cone condition c (t − tr) = |xObs − path(tr)| for the retarded emission time tr.
 * For a sub-luminal path f(tr) = c (t − tr) − |xObs − path(tr)| falls through zero exactly once, but it is
 * not concave (a fast source on a circle bends it both ways), so plain Newton can overshoot and cycle.
 * Each evaluation therefore narrows a bracket [lo, hi] around the root, and a Newton step that would
 * leave the bracket bisects it instead.
 */
export function retardedTime(
  path: (t: number) => Vec3,
  velocity: (t: number) => Vec3,
  xObs: Vec3,
  t: number,
  c: number,
  iterations = 12,
): number {
  let lo = -Infinity, hi = t;
  let tr = t - len(sub(xObs, path(t))) / c;
  for (let i = 0; i < iterations; i++) {
    const d = sub(xObs, path(tr));
    const dist = len(d);
    const f = c * (t - tr) - dist;
    if (f > 0) lo = tr;
    else hi = tr;
    // Below light speed f′ < 0; the cap keeps the step finite and its sign right for a path that is not.
    const fp = Math.min(-c + (dist > 0 ? dot(d, velocity(tr)) / dist : 0), -1e-9 * c);
    let next = tr - f / fp;
    if (!(next >= lo && next <= hi)) next = 0.5 * (lo + hi);
    const step = next - tr;
    tr = next;
    if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(t))) break;
  }
  return tr;
}
