import { describe, expect, it } from 'vitest';
import { AutoQuality } from '../src/autoQuality';
import type { Quality } from '../src/worlds/types';

const VSYNC = 1000 / 60;

/** A GPU with a fixed cost and a cost for the full frame of pixels (∝ scale²) per preset, ms; by default on a 60 Hz display. */
const gpu =
  (cost: Partial<Record<Quality, [number, number]>>, vsync = true) =>
  (q: Quality, scale: number) => {
    const [fixed, pixels] = cost[q]!;
    const ms = fixed + pixels * scale * scale;
    return vsync ? Math.ceil(ms / VSYNC - 1e-9) * VSYNC : ms;
  };

/** Run for `seconds` of wall time, returning every change with the time (s) it was made. */
function run(aq: AutoQuality, frameMs: (q: Quality, scale: number) => number, seconds: number) {
  const changes: { t: number; what: string; preset: Quality }[] = [];
  for (let t = 0; t < seconds * 1000; ) {
    const ms = frameMs(aq.preset, aq.scale);
    t += ms;
    const what = aq.frame(ms);
    if (what) changes.push({ t: t / 1000, what, preset: aq.preset });
  }
  return changes;
}

describe('auto quality', () => {
  it('draws fewer pixels while frames run long, and all of them again once there is headroom', () => {
    const aq = new AutoQuality('medium', false);
    run(aq, gpu({ medium: [4, 40] }), 20);
    expect(aq.scale).toBeLessThan(0.8);
    run(aq, gpu({ medium: [2, 6] }), 60);
    expect(aq.scale).toBe(1);
  });

  it('adapts a software renderer whose every frame takes seconds', () => {
    const aq = new AutoQuality('medium', true);
    run(aq, gpu({ low: [0, 1500], medium: [0, 4000], high: [0, 6000] }, false), 40);
    expect(aq.preset).toBe('low');
    expect(aq.scale).toBe(0.5);
  });

  it('settles at a vsync boundary instead of retrying a resolution that was too slow, over and over', () => {
    // Up to 0.9 of full resolution fits a 60 Hz frame; above that, every frame waits for the next vsync.
    const aq = new AutoQuality('medium', false);
    const changes = run(aq, (_, s) => (s <= 0.9 ? VSYNC : 2 * VSYNC), 15 * 60);
    expect(changes.length).toBeLessThan(30);
    expect(changes.filter((c) => c.t > 5 * 60).length).toBeLessThanOrEqual(4);
    expect(aq.scale).toBeGreaterThan(0.8);
  });

  it('on Auto, drops to a cheaper preset when even the lowest resolution is too slow, and stays there', () => {
    const aq = new AutoQuality('medium', true);
    const changes = run(aq, gpu({ low: [6, 6], medium: [30, 8], high: [60, 20] }), 120);
    expect(changes.filter((c) => c.what === 'preset').map((c) => c.preset)).toEqual(['low']);
    expect(aq.scale).toBe(1);
  });

  it('on Auto, moves up a preset when there is room to spare, and back for good if it proves too slow', () => {
    const roomy = new AutoQuality('medium', true);
    run(roomy, gpu({ low: [2, 2], medium: [3, 3], high: [5, 5] }), 30);
    expect(roomy.preset).toBe('high');

    const aq = new AutoQuality('medium', true);
    const changes = run(aq, gpu({ low: [2, 2], medium: [4, 6], high: [40, 20] }), 10 * 60);
    expect(changes.filter((c) => c.what === 'preset').map((c) => c.preset)).toEqual(['high', 'medium']);
  });

  it('on Auto, starts a later visit to a world below the presets found too slow there', () => {
    const tooSlow = new Set<Quality>();
    run(new AutoQuality('high', true, tooSlow), gpu({ low: [6, 6], medium: [30, 8], high: [60, 20] }), 60);
    expect([...tooSlow].sort()).toEqual(['high', 'medium']);
    expect(new AutoQuality('high', true, tooSlow).preset).toBe('low');
    expect(new AutoQuality('high', false, tooSlow).preset).toBe('high');
  });

  it('keeps the preset a visitor chose, trimming only the resolution', () => {
    const aq = new AutoQuality('high', false);
    run(aq, gpu({ high: [80, 40] }), 60);
    expect(aq.preset).toBe('high');
    expect(aq.scale).toBe(0.5);
  });
});
