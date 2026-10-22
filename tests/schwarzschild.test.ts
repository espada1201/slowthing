import { describe, expect, it } from 'vitest';
import {
  CRITICAL_IMPACT,
  asymptoticDirection,
  einsteinRingRadius,
  exactDeflection,
  gravitationalShift,
  rsFromShadow,
  schwarzschildRadius,
  shadowAngularRadius,
  timeDilation,
  traceRay,
  tracedDeflection,
} from '../src/physics/schwarzschild';
import { type Vec3, dot, len } from '../src/physics/vec';

const rs = 1;
const deg = Math.PI / 180;

describe('Schwarzschild light bending', () => {
  it('weak field: deflection → 4GM/(c²b) = 2 rs / b', () => {
    for (const b of [200, 500]) {
      const d = tracedDeflection(b, rs, 0.004);
      expect(Math.abs(d - (2 * rs) / b) / ((2 * rs) / b)).toBeLessThan(0.02);
    }
  });

  it('strong field: the shader integrator agrees with the exact orbit integral', () => {
    for (const b of [3, 4, 8]) {
      const traced = tracedDeflection(b, rs, 0.004);
      const exact = exactDeflection(b, rs);
      expect(Math.abs(traced - exact) / exact).toBeLessThan(0.01);
    }
  });

  it('photon sphere: a tangential ray at 1.5 rs circles the hole', () => {
    const res = traceRay([1.5, 0, 0], [0, 0, 1], rs, { stepScale: 0.002, maxSteps: 3000, keepPath: true });
    // Unstable orbit, but it should hold its radius for most of a revolution.
    const radii = res.path!.slice(0, 2500).map(len);
    expect(Math.max(...radii.map((r) => Math.abs(r - 1.5)))).toBeLessThan(0.01);
  });

  it('captures rays inside the critical impact parameter and frees those outside', () => {
    const bc = CRITICAL_IMPACT * rs;
    expect(traceRay([-500, bc * 0.98, 0], [1, 0, 0], rs, { stepScale: 0.01 }).captured).toBe(true);
    expect(traceRay([-500, bc * 1.02, 0], [1, 0, 0], rs, { stepScale: 0.01 }).captured).toBe(false);
  });
});

describe('gravitational time dilation and redshift', () => {
  it('clocks at r = 4 rs/3 run at half speed', () => {
    expect(timeDilation(4 / 3, 1)).toBeCloseTo(0.5, 12);
  });
  it('light climbing out is redshifted, falling in is blueshifted', () => {
    expect(gravitationalShift(2, 100, 1)).toBeLessThan(1);
    expect(gravitationalShift(100, 2, 1)).toBeGreaterThan(1);
    expect(gravitationalShift(3, 3, 1)).toBeCloseTo(1, 12);
  });
  it('the Sun has rs ≈ 2.95 km', () => {
    expect(schwarzschildRadius(6.674e-11, 1.989e30, 299792458)).toBeCloseTo(2954, -1);
  });
});

describe('black hole shadow seen by a hovering observer', () => {
  it('is a hemisphere at the photon sphere and b_c / r far away', () => {
    expect(shadowAngularRadius(1.5, 1)).toBeCloseTo(Math.PI / 2, 9);
    expect(shadowAngularRadius(1e4, 1)).toBeCloseTo(CRITICAL_IMPACT / 1e4, 6);
  });
  it('separates captured from escaping rays exactly where the ray tracer does', () => {
    for (const r of [1.2, 2, 3, 10]) {
      const alpha = shadowAngularRadius(r, 1);
      // Viewing direction at angle θ from the direction of the hole (which lies along −x).
      const look = (theta: number): Vec3 => [-Math.cos(theta), Math.sin(theta), 0];
      const opts = { stepScale: 0.004, maxSteps: 200000 };
      expect(traceRay([r, 0, 0], look(alpha * 0.99), 1, opts).captured).toBe(true);
      expect(traceRay([r, 0, 0], look(alpha * 1.01), 1, opts).captured).toBe(false);
    }
  });
});

describe('weighing a hole by its shadow, the way the tour teaches', () => {
  it('turns a ruler reading of 7.27° at 20 rs into rs to within 2%', () => {
    // World III's weighing stop: 80 m from a hole with rs = 4 m.
    const r = 80, rs = 4;
    expect(shadowAngularRadius(r, rs) / deg).toBeCloseTo(7.27, 2);
    expect(Math.abs(rsFromShadow(7.27 * deg, r) / rs - 1)).toBeLessThan(0.02);
    // Leaving the square root out altogether would not be close enough.
    expect(rsFromShadow(7.27 * deg, r, 1) / rs - 1).toBeLessThan(-0.02);
  });

  it('solves the shadow formula for rs anywhere outside the photon sphere, given enough rounds', () => {
    for (const r of [2, 3, 20, 1000]) expect(rsFromShadow(shadowAngularRadius(r, 1), r, 60)).toBeCloseTo(1, 9);
  });
});

describe('Einstein ring of a far-away source right behind the hole', () => {
  // Direction (from the hole's) in which a ray leaving the observer at angle θ ends up, traced like the shader.
  const escape = (r: number, theta: number) => {
    const ray = traceRay([r, 0, 0], [-Math.cos(theta), Math.sin(theta), 0], 1, { stepScale: 0.002, rFar: 100 * r, maxSteps: 1e6 });
    const d = asymptoticDirection(ray.position, ray.direction, 1);
    return Math.atan2(d[1], -d[0]);
  };

  it('is where rays traced like the shader leave straight away from you', () => {
    for (const r of [5, 20, 100]) {
      // The ray that ends up heading straight away (escape angle 0) lies between the shadow's edge and 1 radian.
      let lo = shadowAngularRadius(r, 1) * 1.001, hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = 0.5 * (lo + hi);
        if (escape(r, mid) < 0) lo = mid;
        else hi = mid;
      }
      expect(Math.abs(einsteinRingRadius(r, 1) - 0.5 * (lo + hi)) / deg).toBeLessThan(0.01);
    }
  });

  it('is wider than the weak-field √(2rs/r) close in, and tends to it far away', () => {
    expect(einsteinRingRadius(20, 1)).toBeGreaterThan(1.1 * Math.sqrt(2 / 20));
    expect(Math.abs(einsteinRingRadius(1e5, 1) / Math.sqrt(2 / 1e5) - 1)).toBeLessThan(0.005);
  });
});

describe('asymptotic tail used by the shader', () => {
  it('finishes the bending of a ray stopped at 30 rs', () => {
    const angle = (a: Vec3, b: Vec3) => Math.acos(Math.min(1, dot(a, b)));
    for (const [y, dir] of [[6, [1, 0, 0]], [20, [1, 0, 0]], [26, [1, 0.1, 0]], [12, [1, -0.1, 0.05]]] as [number, Vec3][]) {
      const n = dir.map((v) => v / len(dir)) as Vec3;
      const start: Vec3 = [-25, y, 0];
      const near = traceRay(start, n, 1, { stepScale: 0.005, rFar: 30 });
      const far = traceRay(start, n, 1, { stepScale: 0.005, rFar: 30000, maxSteps: 400000 });
      const tail = asymptoticDirection(near.position, near.direction, 1);
      const before = angle(near.direction, far.direction);
      const after = angle(tail, far.direction);
      // Leftover bending is second order in rs/b: the tail removes 97–99.9% of the error.
      expect(after).toBeLessThan(5e-4);
      expect(after).toBeLessThan(before / 30);
    }
  });
});
