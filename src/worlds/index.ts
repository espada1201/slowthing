// The one list of worlds: the app enters them and the teaching kit prints them, both from here. ui.ts's WORLD_CARDS
// (title-screen art, needed before any world loads) must name the same ids, which a unit test checks.

import type { Authored, Lesson, World, WorldContext } from './types';

export interface WorldEntry {
  /** The world's lesson as written. Links and kit pages are built on this, never on a live World. */
  readonly lesson: Authored;
  readonly World: new (ctx: WorldContext) => World;
}

/** Each entry downloads the world's code, and three.js, only when the world is entered or printed. */
export const WORLDS = {
  'slow-light': () => import('./slowLight').then((m) => ({ lesson: author(new m.SlowLightLesson()), World: m.SlowLightWorld })),
  'big-hbar': () => import('./bigHbar').then((m) => ({ lesson: author(new m.BigHbarLesson()), World: m.BigHbarWorld })),
  'big-g': () => import('./bigG').then((m) => ({ lesson: author(new m.BigGLesson()), World: m.BigGWorld })),
} satisfies Record<string, () => Promise<WorldEntry>>;

export type WorldId = keyof typeof WORLDS;

/** A registered world id. '__proto__', 'constructor' and 'toString' are not worlds. */
export function isWorldId(s: string | null | undefined): s is WorldId {
  return typeof s === 'string' && Object.hasOwn(WORLDS, s);
}

/** Freeze a fresh lesson, all the way down, as authored content. WORLDS is the app's only caller; tests make fixtures with it. */
export function author(lesson: Lesson): Authored {
  return freeze(lesson) as Authored;
}

function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
