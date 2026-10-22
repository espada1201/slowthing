import { describe, expect, it } from 'vitest';
import type { Observer } from '../src/physics/simultaneity';
import { type MapPoint, type Rider, type Town, measure } from '../src/worlds/measured';

const C = 12;
// World I's movers at c = 12 m/s: the tram (proper speed 24 m/s on 45 m) and a carousel lamp (13 m/s on 7 m, turning the other way).
const rider = (radius: number, u: number, dir: 1 | -1, phase: number): Rider => {
  const gamma = Math.sqrt(1 + (u / C) ** 2);
  return { radius, phase, omega: (dir * u) / gamma / radius, squash: 1 / gamma };
};
const lampGamma = Math.sqrt(1 + (13 / C) ** 2);
const town: Town = {
  blocks: [[-3, -29, 3, -23]],
  clocks: [{ id: 'tower', at: [0, 14.5, -23.48] }, { id: 'a', at: [-4, 3.2, 0] }, { id: 'b', at: [-4, 3.2, -20] }],
  trams: [rider(45, 24, 1, 1.2)],
  lamps: Array.from({ length: 8 }, (_, i) => rider(7, 13, -1, (i / 8) * 2 * Math.PI)),
  lampGamma,
  blink: 0.6,
};
const gap = (a: MapPoint, b: MapPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clock = (m: ReturnType<typeof measure>, id: string) => m.clocks.find((k) => k.id === id)!;

describe('the Measured map', () => {
  it('standing at the late clock: the tower reads the town time, 65 m ahead, while its light shows it 5.4 s behind', () => {
    const m = measure(town, { x: [0, 1.7, 40], t: 100, beta: [0, 0, 0] }, 0, C);
    const tower = clock(m, 'tower');
    expect(tower.reads).toBe(100);
    expect(tower.reads - tower.seen).toBeCloseTo(5.4, 1);
    expect(tower.at[1]).toBeCloseTo(63.48, 6);
    expect(tower.at[0]).toBeCloseTo(0, 9);
    expect(m.motion).toBeNull();
    // Diagram: the tower's worldline crosses your now there, and your past light cone 5.4 s earlier.
    const line = m.worldlines.find((w) => w.id === 'tower')!;
    expect(line.now).toEqual([expect.closeTo(63.48, 6), 0]);
    expect(line.seen[1]).toBeCloseTo(-5.4, 1);
    expect(line.aside).toBeCloseTo(0, 9);
  });

  it('standing still, a tram car measures 3.22 m of its 7.2 m', () => {
    const [car] = measure(town, { x: [0, 1.7, 30], t: 7, beta: [0, 0, 0] }, 0.3, C).trams;
    expect(car.length).toBeCloseTo(3.22, 2);
    expect(gap(car.corners[0], car.corners[3])).toBeCloseTo(3.22, 2);
    expect(gap(car.corners[0], car.corners[1])).toBeCloseTo(2.5, 9);
  });

  it('cruising north at 0.9 c: the clock 20 m ahead reads 1.50 s later and sits 20/γ m ahead; turning round flips it', () => {
    const north: Observer = { x: [4, 1.7, 30], t: 100, beta: [0, 0, -0.9] };
    const m = measure(town, north, 0, C);
    expect(clock(m, 'b').reads - clock(m, 'a').reads).toBeCloseTo(1.5, 12);
    expect(clock(m, 'b').at[1] - clock(m, 'a').at[1]).toBeCloseTo(20 * Math.sqrt(1 - 0.81), 9);
    expect(m.motion![1]).toBeCloseTo(1, 12);
    const south = measure(town, { ...north, beta: [0, 0, 0.9] }, Math.PI, C);
    expect(clock(south, 'b').reads - clock(south, 'a').reads).toBeCloseTo(-1.5, 12);
    // In your frame the town's clocks move back past you at 0.9 c: their worldlines lean that way.
    const line = m.worldlines.find((w) => w.id === 'a')!;
    const [p, q] = line.points;
    expect((q[0] - p[0]) / (q[1] - p[1])).toBeCloseTo(-0.9 * C, 9);
    // The clocks stand 8 m to the side of your path, so the diagram shows them in full.
    expect(line.aside).toBeCloseTo(8, 9);
  });

  it('standing at the carousel: all eight lamps flash together, every 0.885 s', () => {
    const clocks = (t: number) => measure(town, { x: [0, 1.7, 19], t, beta: [0, 0, 0] }, 0, C).lamps.map((l) => l.tau);
    for (const t of [3, 3.2, 3.45]) {
      const tau = clocks(t);
      expect(Math.max(...tau) - Math.min(...tau)).toBeLessThan(1e-12);
      // One flash per 0.6 s of the lamps' time is one per 0.6 γ s of yours.
      expect(clocks(t + 0.6 * lampGamma)[0] - tau[0]).toBeCloseTo(0.6, 12);
    }
    expect(0.6 * lampGamma).toBeCloseTo(0.885, 3);
  });
});
