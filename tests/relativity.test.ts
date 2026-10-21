import { describe, expect, it } from 'vitest';
import {
  aberrationAngle,
  dopplerFactor,
  lorentzFactor,
  observerToWorldDirection,
  retardedTime,
  sourceDopplerFactor,
  velocityFromProper,
} from '../src/physics/relativity';
import { type Vec3, add, dot, len, scale, sub } from '../src/physics/vec';

const deg = Math.PI / 180;

describe('Lorentz factor', () => {
  it('matches textbook values', () => {
    expect(lorentzFactor(0)).toBe(1);
    expect(lorentzFactor(0.6)).toBeCloseTo(1.25, 12);
    expect(lorentzFactor(0.8)).toBeCloseTo(5 / 3, 12);
    expect(lorentzFactor(0.99)).toBeCloseTo(7.0888120, 6);
  });
  it('rejects β ≥ 1', () => {
    expect(() => lorentzFactor(1)).toThrow(RangeError);
  });
});

describe('aberration', () => {
  it('a source at 90° appears at 60° when β = 0.5', () => {
    expect(aberrationAngle(90 * deg, 0.5) / deg).toBeCloseTo(60, 10);
  });
  it('a source directly behind stays behind, ahead stays ahead', () => {
    expect(aberrationAngle(0, 0.9)).toBeCloseTo(0, 6);
    expect(aberrationAngle(Math.PI, 0.9)).toBeCloseTo(Math.PI, 6);
  });
  it('the vector transform inverts the textbook angle formula', () => {
    for (const beta of [0.1, 0.5, 0.9, 0.99]) {
      for (const theta of [10, 45, 90, 135, 170]) {
        const thetaObs = aberrationAngle(theta * deg, beta);
        const nObs: Vec3 = [Math.sin(thetaObs), 0, Math.cos(thetaObs)];
        const nWorld = observerToWorldDirection(nObs, [0, 0, beta]);
        expect(len(nWorld)).toBeCloseTo(1, 10);
        expect(Math.acos(nWorld[2]) / deg).toBeCloseTo(theta, 8);
      }
    }
  });
});

describe('Doppler factor', () => {
  it('head-on at β = 0.6 doubles the frequency, receding halves it', () => {
    expect(dopplerFactor([0, 0, 1], [0, 0, 0.6])).toBeCloseTo(2, 12);
    expect(dopplerFactor([0, 0, -1], [0, 0, 0.6])).toBeCloseTo(0.5, 12);
  });
  it('looking perpendicular in the observer frame gives pure transverse redshift 1/γ', () => {
    const beta: Vec3 = [0.8, 0, 0];
    const nWorld = observerToWorldDirection([0, 1, 0], beta);
    expect(dopplerFactor(nWorld, beta)).toBeCloseTo(1 / lorentzFactor(0.8), 12);
  });
  it('a moving source approaching the eye is blueshifted by √((1+β)/(1−β))', () => {
    expect(sourceDopplerFactor([0.6, 0, 0], [1, 0, 0])).toBeCloseTo(2, 12);
  });
});

describe('proper velocity', () => {
  it('never exceeds c', () => {
    const v = velocityFromProper([1e6, 0, 0], 10);
    expect(len(v)).toBeLessThan(10);
    expect(len(v)).toBeGreaterThan(9.99);
  });
});

describe('retarded time', () => {
  it('matches the closed form for uniform straight-line motion', () => {
    const c = 10;
    const x0: Vec3 = [-30, 0, 5];
    const u: Vec3 = [8, 0, 0];
    const path = (t: number) => add(x0, scale(u, t));
    const vel = () => u;
    const obs: Vec3 = [0, 1.7, 0];
    const t = 4;
    const tr = retardedTime(path, vel, obs, t, c);
    // |obs − x0 − u tr|² = c² (t − tr)²  →  quadratic in tr, take the past root.
    const d = sub(obs, x0);
    const A = dot(u, u) - c * c;
    const B = -2 * dot(d, u) + 2 * c * c * t;
    const C = dot(d, d) - c * c * t * t;
    const roots = [(-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A), (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A)];
    const past = roots.filter((r) => r <= t).sort((a, b) => b - a)[0];
    expect(tr).toBeCloseTo(past, 9);
  });
  it('converges on a circular orbit at 0.95 c', () => {
    const c = 12, R = 6, w = (0.95 * c) / R;
    const path = (t: number): Vec3 => [R * Math.cos(w * t), 1, R * Math.sin(w * t)];
    const vel = (t: number): Vec3 => [-R * w * Math.sin(w * t), 0, R * w * Math.cos(w * t)];
    const obs: Vec3 = [20, 1.7, 3];
    const t = 2.3;
    const tr = retardedTime(path, vel, obs, t, c);
    expect(c * (t - tr)).toBeCloseTo(len(sub(obs, path(tr))), 9);
  });
});
