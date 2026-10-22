// Light rays around a Schwarzschild black hole (units: metres, Schwarzschild radius rs).
// In Schwarzschild coordinates a photon orbit obeys u'' + u = (3/2) rs u² (u = 1/r). The same orbit shape
// comes from the flat-space ODE x'' = −(3/2) rs h² x / r⁵ with h = |x × x'|, which is what the GPU
// ray-marcher integrates. These CPU versions use the exact same stepping so tests verify the shader's maths.

import { type Vec3, add, cross, dot, len, normalize, scale, sub } from './vec';

export const PHOTON_SPHERE = 1.5;
export const CRITICAL_IMPACT = (3 * Math.sqrt(3)) / 2;

/** dτ/dt for a static observer at radius r: clocks near the hole tick slower. */
export function timeDilation(r: number, rs: number): number {
  return r <= rs ? 0 : Math.sqrt(1 - rs / r);
}

/** ν_observed / ν_emitted for light from a static emitter at rEmit received by a static observer at rObs. */
export function gravitationalShift(rEmit: number, rObs: number, rs: number): number {
  return Math.sqrt((1 - rs / rEmit) / (1 - rs / rObs));
}

export function schwarzschildRadius(G: number, M: number, c: number): number {
  return (2 * G * M) / (c * c);
}

/**
 * Convert a direction measured in a static observer's local orthonormal frame into the coordinate
 * velocity of the flat-space ODE. The radial component shrinks by √(1 − rs/r); this is exact and
 * reproduces the impact parameter b = r sin α / √(1 − rs/r).
 */
function coordinateDirection(pos: Vec3, nLocal: Vec3, rs: number): Vec3 {
  const rhat = normalize(pos);
  const radial = dot(nLocal, rhat);
  const perp = sub(nLocal, scale(rhat, radial));
  return add(scale(rhat, radial * Math.sqrt(Math.max(0, 1 - rs / len(pos)))), perp);
}

interface RayResult {
  captured: boolean;
  direction: Vec3;
  /** Where the march stopped. */
  position: Vec3;
  path?: Vec3[];
}

/** Integrate one ray with adaptive velocity-Verlet, step h = stepScale · r · |v|⁻¹ (as in the shader). */
export function traceRay(pos: Vec3, nLocal: Vec3, rs: number, opts: { stepScale?: number; rFar?: number; maxSteps?: number; keepPath?: boolean } = {}): RayResult {
  const { stepScale = 0.04, rFar = 400 * rs, maxSteps = 20000, keepPath = false } = opts;
  let x = pos;
  let v = coordinateDirection(pos, nLocal, rs);
  const h2 = dot(cross(x, v), cross(x, v));
  const accel = (p: Vec3) => {
    const r = len(p);
    return scale(p, (-1.5 * rs * h2) / r ** 5);
  };
  let a = accel(x);
  const path = keepPath ? [x] : undefined;
  for (let i = 0; i < maxSteps; i++) {
    const r = len(x);
    if (r < rs * 1.0001) return { captured: true, direction: normalize(v), position: x, path };
    if (r > rFar && dot(x, v) > 0) return { captured: false, direction: normalize(v), position: x, path };
    const h = (stepScale * r) / len(v);
    x = add(x, add(scale(v, h), scale(a, 0.5 * h * h)));
    const an = accel(x);
    v = add(v, scale(add(a, an), 0.5 * h));
    a = an;
    path?.push(x);
  }
  return { captured: false, direction: normalize(v), position: x, path };
}

/** Bending angle of a ray with impact parameter b coming in from far away along +x. */
export function tracedDeflection(b: number, rs: number, stepScale = 0.01): number {
  const start: Vec3 = [-4000 * rs, b, 0];
  const res = traceRay(start, [1, 0, 0], rs, { stepScale, rFar: 4000 * rs, maxSteps: 400000 });
  if (res.captured) return Infinity;
  return Math.acos(Math.max(-1, Math.min(1, res.direction[0])));
}

/** Simpson's rule for ∫ₐᵇ f with n (even) intervals. */
function simpson(f: (x: number) => number, a: number, b: number, n: number): number {
  let sum = 0;
  for (let i = 0; i <= n; i++) sum += f(a + ((b - a) * i) / n) * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  return (sum * (b - a)) / (3 * n);
}

/** Exact bending angle: Δφ = 2∫₀^{u₀} du / √(1/b² − u² + rs u³) − π, with u₀ the turning point. */
export function exactDeflection(b: number, rs: number): number {
  if (b <= CRITICAL_IMPACT * rs) return Infinity;
  const G = (u: number) => 1 / (b * b) - u * u + rs * u * u * u;
  // Turning point: smallest positive root of G, found by bisection between 0 and 1/(1.5 rs).
  let lo = 0, hi = 1 / (PHOTON_SPHERE * rs);
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (G(mid) > 0) lo = mid;
    else hi = mid;
  }
  const u0 = lo;
  // u = u0 (1 − s²) removes the inverse-square-root singularity at the turning point.
  const dG = -2 * u0 + 3 * rs * u0 * u0; // G'(u0) < 0
  const f = (s: number) => (s === 0 ? (2 * u0) / Math.sqrt(-dG * u0) : (2 * u0 * s) / Math.sqrt(Math.max(1e-300, G(u0 * (1 - s * s)))));
  return 2 * simpson(f, 0, 1, 20000) - Math.PI;
}

/**
 * Angular radius of the Einstein ring that a static observer at r (> 1.5 rs) sees when a far-away source sits
 * exactly behind the hole: light leaving the observer at that angle sweeps exactly π on its way out to infinity.
 * That sweep is 2∫₀^{u₀} − ∫₀^{1/r} of du / √(1/b² − u² + rs u³), i.e. exactDeflection(b) + π − ∫₀^{1/r}.
 */
export function einsteinRingRadius(r: number, rs: number): number {
  // Below the turning point the integrand stays finite, so plain Simpson does.
  const toObserver = (b: number) => simpson((u) => 1 / Math.sqrt(1 / (b * b) - u * u + rs * u * u * u), 0, 1 / r, 2000);
  // Between the shadow's edge (endless bending) and a ray that grazes the observer's own radius.
  let lo = CRITICAL_IMPACT * rs, hi = r / Math.sqrt(1 - rs / r);
  for (let i = 0; i < 60; i++) {
    const b = 0.5 * (lo + hi);
    if (exactDeflection(b, rs) > toObserver(b)) lo = b;
    else hi = b;
  }
  return Math.asin(((0.5 * (lo + hi)) / r) * Math.sqrt(1 - rs / r));
}

/**
 * Angular radius of the black hole's shadow for a static observer at r, measured from the direction
 * of the hole: sin α = (b_c / r)·√(1 − rs/r). Inside the photon sphere the shadow covers more than half the sky.
 */
export function shadowAngularRadius(r: number, rs: number): number {
  if (r <= rs) return Math.PI;
  const a = Math.asin(Math.min(1, ((CRITICAL_IMPACT * rs) / r) * Math.sqrt(1 - rs / r)));
  return r < PHOTON_SPHERE * rs ? Math.PI - a : a;
}

/**
 * The hole's rs from its shadow's angular radius α seen at r, solved the way the tour teaches: leave the square root
 * out of sin α = (b_c / r)·√(1 − rs/r) at first, then put each answer back into it (`rounds` answers in all).
 * Outside the photon sphere this homes in on rs, each round cutting the error by a factor of about 2(r − rs)/rs.
 */
export function rsFromShadow(alpha: number, r: number, rounds = 2): number {
  let rs = 0;
  for (let i = 0; i < rounds; i++) rs = (r * Math.sin(alpha)) / (CRITICAL_IMPACT * Math.sqrt(1 - rs / r));
  return rs;
}

/**
 * Direction in which an outgoing ray at pos (moving along vel) finally leaves for infinity: the
 * weak-field bending still to come, Δ = (3/2)(rs/b)(2/3 − sin φ + sin³φ/3) with sin φ = r̂·v̂ and b the
 * distance of the ray's line from the hole, turned toward the hole. Lets the shader stop marching early.
 */
export function asymptoticDirection(pos: Vec3, vel: Vec3, rs: number): Vec3 {
  const vh = normalize(vel);
  const perp = sub(pos, scale(vh, dot(pos, vh)));
  const b = len(perp);
  if (b < 1e-12 || rs <= 0) return vh;
  const s = dot(pos, vh) / len(pos);
  const delta = 1.5 * (rs / b) * (2 / 3 - s + (s * s * s) / 3);
  return normalize(sub(vh, scale(perp, delta / b)));
}
