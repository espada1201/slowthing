import { describe, expect, it } from 'vitest';
import { lorentzFactor, retardedTime } from '../src/physics/relativity';
import { type Observer, inYourFrame, nowAt, simultaneousTime } from '../src/physics/simultaneity';
import { type Vec3, add, len, scale, sub } from '../src/physics/vec';

const C = 12;
const still = (x: Vec3, t = 100): Observer => ({ x, t, beta: [0, 0, 0] });

/** A point riding a circle as World I's movers do: proper speed u, direction ±1, and an offset (along, up, out) contracted along the track. */
function rider(R: number, u: number, c: number, phase: number, dir: 1 | -1 = 1, local: Vec3 = [0, 0, 0], centre: Vec3 = [0, 0, 0]) {
  const gamma = Math.sqrt(1 + (u / c) ** 2), w = (dir * u) / gamma / R;
  const at = (t: number): Vec3 => {
    const a = phase + w * t;
    const radial: Vec3 = [Math.cos(a), 0, Math.sin(a)], forward: Vec3 = [-dir * Math.sin(a), 0, dir * Math.cos(a)];
    return add(add(add(centre, [0, local[1], 0]), scale(radial, R + local[2])), scale(forward, local[0] / gamma));
  };
  return { gamma, path: at, vel: (t: number) => scale(sub(at(t + 1e-6), at(t - 1e-6)), 5e5) };
}

describe('your now', () => {
  it('standing still, the tower clock reads the town time, while its light shows it 5.4 s behind', () => {
    const eye = still([0, 1.7, 40]), face: Vec3 = [0, 14.5, -23.48];
    expect(nowAt(eye, face, C)).toBe(eye.t);
    expect(eye.t - retardedTime(() => face, () => [0, 0, 0], eye.x, eye.t, C)).toBeCloseTo(5.4, 1);
  });

  it('cruising at 0.9 c, a clock 20 m further along your motion reads 1.50 s later; turning round flips it', () => {
    const north: Observer = { x: [4, 1.7, 30], t: 100, beta: [0, 0, -0.9] };
    const a: Vec3 = [-6, 3, 0], b: Vec3 = [-6, 3, -20];
    expect(nowAt(north, b, C) - nowAt(north, a, C)).toBeCloseTo(1.5, 12);
    expect(nowAt({ ...north, beta: [0, 0, 0.9] }, b, C) - nowAt({ ...north, beta: [0, 0, 0.9] }, a, C)).toBeCloseTo(-1.5, 12);
  });

  it('stopping from 0.9 c moves the reading of a clock 100 m ahead by 7.5 s', () => {
    const cruising: Observer = { x: [0, 1.7, 0], t: 100, beta: [0.9, 0, 0] };
    expect(nowAt(cruising, [100, 1.7, 0], C) - nowAt({ ...cruising, beta: [0, 0, 0] }, [100, 1.7, 0], C)).toBeCloseTo(7.5, 12);
  });
});

describe('a moving point on your now', () => {
  it('standing still, a tram car (0.894 c) measures 3.22 m of its 7.2 m', () => {
    const eye = still([0, 1.7, 30]);
    const ends = [3.6, -3.6].map((x) => rider(45, 24, C, 1.2, 1, [x, 1.2, 0]));
    expect(1 / ends[0].gamma).toBeCloseTo(0.447, 3);
    const [front, back] = ends.map(({ path, vel }) => {
      const s = simultaneousTime(path, vel, eye, C);
      return inYourFrame(eye, s, path(s), C).x;
    });
    expect(len(sub(front, back))).toBeCloseTo(3.22, 2);
  });

  it('a car at 0.894 c, measured by you running at 0.5 c toward it, is 7.2 m / γ of the closing speed', () => {
    const gamma = lorentzFactor(0.894), beta = (0.894 + 0.5) / (1 + 0.894 * 0.5);
    const you: Observer = { x: [60, 1.7, 3], t: 2, beta: [-0.5, 0, 0] };
    const [front, back] = [3.6, -3.6].map((x) => {
      const path = (t: number): Vec3 => [x / gamma + 0.894 * C * t, 1.2, 0];
      const s = simultaneousTime(path, () => [0.894 * C, 0, 0], you, C);
      return inYourFrame(you, s, path(s), C).x;
    });
    expect(len(sub(front, back))).toBeCloseTo(7.2 / lorentzFactor(beta), 10);
  });

  it('standing at the carousel, all eight lamps flash together every 0.885 s, but their light arrives bunched', () => {
    const eye = still([0, 1.7, 19]);
    const lamps = Array.from({ length: 8 }, (_, i) => rider(7, 13, C, (i / 8) * 2 * Math.PI, -1, [0, 3, 0]));
    const gamma = lamps[0].gamma;
    expect(Math.sqrt(1 - 1 / gamma ** 2)).toBeCloseTo(0.735, 3);
    expect(0.6 * gamma).toBeCloseTo(0.885, 3);
    // Each lamp's own clock (town time / γ) at your now, and when the light now arriving left it.
    const measured = lamps.map(({ path, vel }) => simultaneousTime(path, vel, eye, C) / gamma);
    const seen = lamps.map(({ path, vel }) => retardedTime(path, vel, eye.x, eye.t, C) / gamma);
    expect(Math.max(...measured) - Math.min(...measured)).toBeLessThan(1e-12);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.6);
  });

  it('lands on the hyperplane for every view of the tram and the carousel, cruising up to 0.95 c', () => {
    let worst = 0;
    for (const c of [4, 12, 20])
      for (const [R, u, dir, corner] of [[45, 24, 1, [3.6, 1.2, 1.35]], [7, 13, -1, [0, 3, 0]]] as const)
        for (let k = 0; k < 6; k++) {
          const { path, vel } = rider(R, u, c, k * 1.1, dir, [...corner], [3, 0, -2]);
          for (const r of [3, 46, 260])
            for (const b of [0.3, 0.9, 0.95]) {
              const q = k * 0.9 + r;
              const eye: Observer = { x: [r * Math.cos(q), 1.7, r * Math.sin(q)], t: 1000 + k, beta: [b * Math.cos(2 * q), 0, b * Math.sin(2 * q)] };
              const s = simultaneousTime(path, vel, eye, c);
              worst = Math.max(worst, Math.abs(s - nowAt(eye, path(s), c)));
            }
        }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe('your frame', () => {
  const eye: Observer = { x: [10, 1.7, -5], t: 50, beta: [0.6, 0, -0.48] };
  const gamma = lorentzFactor(len(eye.beta));

  it('puts you at the origin of space and time', () => {
    const me = inYourFrame(eye, eye.t, eye.x, C);
    expect(me.t).toBe(0);
    expect(len(me.x)).toBe(0);
  });

  it('measures the town on your now contracted by 1/γ along your motion, and unchanged across it', () => {
    const along = scale(eye.beta, 30 / len(eye.beta)), across = scale([0.48, 0, 0.6], 20 / Math.hypot(0.48, 0.6));
    for (const [d, length] of [[along, 30 / gamma], [across, 20]] as const) {
      const x = add(eye.x, d);
      const e = inYourFrame(eye, nowAt(eye, x, C), x, C);
      expect(e.t).toBeCloseTo(0, 12);
      expect(len(e.x)).toBeCloseTo(length, 10);
    }
  });

  it('keeps light-like separations light-like', () => {
    const x = add(eye.x, [17, 3, 25]);
    const e = inYourFrame(eye, eye.t - len(sub(x, eye.x)) / C, x, C);
    expect(-e.t * C).toBeCloseTo(len(e.x), 10);
  });
});
