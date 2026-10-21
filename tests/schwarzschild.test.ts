import { describe, expect, it } from 'vitest';
import {
  CRITICAL_IMPACT,
  exactDeflection,
  gravitationalShift,
  schwarzschildRadius,
  timeDilation,
  traceRay,
  tracedDeflection,
} from '../src/physics/schwarzschild';
import { len } from '../src/physics/vec';

const rs = 1;

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
