// Your "now": the events your own frame calls simultaneous with you. In the town frame they lie on the
// hyperplane t − t_you = β·(x − x_you)/c, so a clock ahead of you along your motion reads later.

import { lorentzFactor } from './relativity';
import { type Vec3, add, dot, len, scale, sub } from './vec';

/** Your event (position x and town time t) and your velocity β = v / c, all in the town frame. */
export interface Observer {
  x: Vec3;
  t: number;
  beta: Vec3;
}

/** Town time of the event at x that happens at your now. */
export function nowAt(o: Observer, x: Vec3, c: number): number {
  return o.t + dot(o.beta, sub(x, o.x)) / c;
}

/**
 * The town time at which a moving point crosses your now: the root of g(s) = s − nowAt(path(s)), found by Newton
 * inside a bracket that each evaluation narrows (as in retardedTime). Below light speed the slope g′ = 1 − β·u/c is
 * at least 1 − |β|, so the root lies within |g| / (1 − |β|) of any s: until it is bracketed the search steps that far,
 * and a step that would leave the bracket, or a smaller slope (a tram's outer corner passes c at the lowest c), bisects.
 */
export function simultaneousTime(path: (t: number) => Vec3, velocity: (t: number) => Vec3, o: Observer, c: number, iterations = 20): number {
  const least = 1 - len(o.beta);
  let s = o.t, lo = -Infinity, hi = Infinity;
  for (let i = 0; i < iterations; i++) {
    const g = s - nowAt(o, path(s), c);
    if (g > 0) hi = s;
    else lo = s;
    const slope = 1 - dot(o.beta, velocity(s)) / c;
    let next = s - g / slope;
    if (!(slope >= least && next >= lo && next <= hi)) next = Number.isFinite(lo + hi) ? 0.5 * (lo + hi) : s - g / least;
    const step = next - s;
    s = next;
    if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(o.t))) break;
  }
  return s;
}

/** The town event (t, x) in your frame, relative to you: your time t′ and position x′ (Lorentz boost by β). */
export function inYourFrame(o: Observer, t: number, x: Vec3, c: number): { t: number; x: Vec3 } {
  const b = len(o.beta);
  const dt = t - o.t, dx = sub(x, o.x);
  if (b < 1e-12) return { t: dt, x: dx };
  const g = lorentzFactor(b), along = dot(o.beta, dx) / b;
  return { t: g * (dt - (b * along) / c), x: add(dx, scale(o.beta, ((g - 1) * along) / b - g * c * dt)) };
}
