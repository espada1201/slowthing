import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { WORLD_CARDS } from '../src/ui/ui';
import { WORLDS, isWorldId } from '../src/worlds';
import { SlowLightLesson } from '../src/worlds/slowLight';
import type { Authored } from '../src/worlds/types';

vi.mock('../src/audio', () => ({ soundOn: () => false, setSound: () => {}, chime: () => {}, click: () => {}, tick: () => {} }));

describe('the world list', () => {
  it('names the same worlds as the title screen, in the same order', () => {
    expect(Object.keys(WORLDS)).toEqual(WORLD_CARDS.map((c) => c.id));
  });

  it('loads each lesson without WebGL, under its own id', async () => {
    for (const [id, load] of Object.entries(WORLDS)) {
      const { lesson } = await load();
      expect(lesson.id).toBe(id);
      expect(lesson.tour.length).toBeGreaterThan(1);
    }
  });

  it('freezes each lesson all the way down, so nothing can move a default', async () => {
    const { lesson } = await WORLDS['slow-light']();
    for (const v of [lesson, lesson.toggles, lesson.toggles[0], lesson.tour, lesson.tour[5], lesson.tour[5].toggles, lesson.tour[1].predict!.options, lesson.start.position]) expect(Object.isFrozen(v)).toBe(true);
    expect(() => {
      (lesson.toggles[0] as { value: boolean }).value = false;
    }).toThrow(TypeError);
  });

  it('accepts only its own ids', () => {
    for (const id of ['slow-light', 'big-hbar', 'big-g']) expect(isWorldId(id)).toBe(true);
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null, undefined]) expect(isWorldId(id)).toBe(false);
  });

  it('tells a live lesson from an authored one', () => {
    expectTypeOf<SlowLightLesson>().not.toExtend<Authored>();
  });
});
