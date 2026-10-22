// Links that reopen a world exactly as someone left it: the tour stop, every effect switch and every dial.
//
//   ./?world=slow-light&stop=terrell-rotation&on=doppler&off=delay&c=30
//
// A link names its stop by key and lists only what differs from that stop as authored (the world's preset, its
// switches as declared, then the stop's own settings), so the links a sheet prints are short and still point at the
// right stop when stops are added or reordered. An old link (`?world=slow-light&c=50`) is a link to the first stop
// with one dial changed, and still works.

import { type ConstantKey, type Constants, DIALS, REAL } from '../constants';
import type { Authored, Lesson, TourStop } from '../worlds/types';

declare const minted: unique symbol;

/**
 * One world's state, complete and valid by construction: only this module makes one, so applying it never depends on
 * what the app showed before. `switches` holds every switch of the world and `dials` every dial. A dial is its stop's
 * own value exactly, or a value rounded to 4 significant figures inside the dial's range, with the range's ends (one
 * of them the real value) kept exact, so a link reads back to the very same Setup.
 */
export interface Setup {
  readonly world: string;
  readonly stop: number;
  readonly switches: Readonly<Record<string, boolean>>;
  readonly dials: Readonly<Partial<Record<ConstantKey, number>>>;
  readonly [minted]: true;
}

/** Departures from a stop as authored. Unknown switch ids are ignored, and dials rounded and clamped as in a link. */
export interface Change {
  readonly switches?: Readonly<Record<string, boolean>>;
  readonly dials?: Readonly<Partial<Constants>>;
}

/** A stop's name in links: its `key`, else the first four words of its title ('The late clock' → 'the-late-clock', 'Turn ħ up' → 'turn-hbar-up'). */
export function stopKey(stop: TourStop): string {
  return stop.key ?? stop.title.normalize('NFKD').toLowerCase().replace(/ħ/g, 'hbar').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 4).join('-');
}

/** The state stop `stop` opens in from its link, with `change` on top. */
export function setupAt(lesson: Authored, stop: number, change: Change = {}): Setup {
  const i = clampStop(lesson, stop);
  const base = authoredAt(lesson, i);
  const own = change.switches ?? {};
  const switches = Object.fromEntries(lesson.toggles.map((t) => [t.id, Object.hasOwn(own, t.id) ? own[t.id] === true : base.switches[t.id]]));
  return mint(lesson, i, switches, (k) => change.dials?.[k]);
}

/** What a live world shows now, for Share: its switches as they stand and its dials, at stop `stop`. */
export function setupOf(world: Lesson, stop: number, constants: Readonly<Constants>): Setup {
  return mint(world, clampStop(world, stop), Object.fromEntries(world.toggles.map((t) => [t.id, t.value])), (k) => constants[k]);
}

/** Put a setup's switches and dials into a live world. A setup for another world is ignored. */
export function applySetup(world: Lesson, constants: Constants, setup: Setup): void {
  if (setup.world !== world.id) return;
  for (const t of world.toggles) if (Object.hasOwn(setup.switches, t.id)) t.value = setup.switches[t.id];
  for (const k of world.dials) if (Object.hasOwn(setup.dials, k)) constants[k] = setup.dials[k]!;
}

/**
 * The link to a setup, relative to the app's folder ('./?world=…'), so it resolves to the app from index.html and
 * teach.html alike. It names the stop unless it is the first, then lists the switches turned on and off against the
 * stop as authored, in the world's order, and the dials that differ from the stop's own, by their constant keys.
 */
export function writeLink(lesson: Authored, setup: Setup): string {
  if (setup.world !== lesson.id) throw new Error(`A ${setup.world} setup is not a link into ${lesson.id}`);
  const base = authoredAt(lesson, setup.stop);
  const changed = lesson.toggles.filter((t) => setup.switches[t.id] !== base.switches[t.id]);
  const on = changed.filter((t) => setup.switches[t.id]).map((t) => t.id);
  const off = changed.filter((t) => !setup.switches[t.id]).map((t) => t.id);
  const query = [`world=${lesson.id}`];
  if (setup.stop > 0) query.push(`stop=${stopKey(lesson.tour[setup.stop])}`);
  if (on.length) query.push(`on=${on.join(',')}`);
  if (off.length) query.push(`off=${off.join(',')}`);
  for (const k of lesson.dials) if (setup.dials[k] !== base.dials[k]) query.push(`${k}=${figures(setup.dials[k]!)}`);
  return `./?${query.join('&')}`;
}

/**
 * The setup a link describes, or null when it is not a link into this lesson's world or names nothing beyond the
 * world. Nothing gets through raw: the stop must be one of this tour's keys (else the first stop), switch ids must be
 * this world's (an id both on and off counts as neither), a dial must be a plain decimal and is clamped, and a value
 * longer than MAX_VALUE characters is ignored whole. A repeated parameter counts once, the first.
 */
export function readLink(lesson: Authored, query: URLSearchParams): Setup | null {
  if (query.get('world') !== lesson.id || !['stop', 'on', 'off', ...lesson.dials].some((k) => query.has(k))) return null;
  const value = (k: string) => {
    const v = query.get(k);
    return v !== null && v.length <= MAX_VALUE ? v : null;
  };
  const known = new Set(lesson.toggles.map((t) => t.id));
  const ids = (k: string) => new Set((value(k) ?? '').split(',').filter((id) => known.has(id)));
  const on = ids('on');
  const off = ids('off');
  const switches: Record<string, boolean> = {};
  for (const id of on) if (!off.has(id)) switches[id] = true;
  for (const id of off) if (!on.has(id)) switches[id] = false;
  const dials: Partial<Constants> = {};
  for (const k of lesson.dials) {
    const v = value(k);
    if (v !== null && DECIMAL.test(v)) dials[k] = Number(v);
  }
  const stops = new Map(lesson.tour.map((s, i) => [stopKey(s), i] as const).reverse());
  return setupAt(lesson, stops.get(value('stop') ?? '') ?? 0, { switches, dials });
}

/** Longest query value read; anything longer is ignored whole. */
const MAX_VALUE = 256;
/** The numbers a link may carry: what writeLink and the old Share wrote, and plain decimals a teacher types. */
const DECIMAL = /^\d+(\.\d+)?(e[-+]?\d+)?$/i;

function clampStop(lesson: Lesson, stop: number): number {
  return Math.min(Math.max(Math.trunc(stop) || 0, 0), lesson.tour.length - 1);
}

/** Stop i as a fresh link opens it: the world's preset over the real constants, switches as declared, then the stop's own settings. */
function authoredAt(lesson: Lesson, i: number) {
  const stop = lesson.tour[i];
  const set = stop.toggles ?? {};
  return {
    switches: Object.fromEntries(lesson.toggles.map((t) => [t.id, Object.hasOwn(set, t.id) ? set[t.id] : t.value])),
    dials: Object.fromEntries(lesson.dials.map((k) => [k, ownDial(lesson, i, k)])),
  };
}

function ownDial(lesson: Lesson, i: number, k: ConstantKey): number {
  return lesson.tour[i].constants?.[k] ?? lesson.preset[k] ?? REAL[k];
}

/** The only place a Setup is made. A dial within rounding of the stop's own value is that value exactly. */
function mint(lesson: Lesson, stop: number, switches: Record<string, boolean>, dial: (k: ConstantKey) => number | undefined): Setup {
  const dials = Object.fromEntries(
    lesson.dials.map((k) => {
      const own = ownDial(lesson, stop, k);
      const v = dial(k);
      return [k, v !== undefined && Number.isFinite(v) && v > 0 && canonical(k, v) !== canonical(k, own) ? canonical(k, v) : own];
    }),
  );
  return { world: lesson.id, stop, switches, dials } as Setup;
}

/** Four significant figures inside the dial's range; a value that rounds like an end of the range is that end exactly. */
function canonical(k: ConstantKey, v: number): number {
  const { min, max } = DIALS[k];
  const r = round4(v);
  return r <= round4(min) ? min : r >= round4(max) ? max : r;
}

const round4 = (v: number) => Number(v.toPrecision(4));

/** A dial for a link: 4 significant figures. Every dial's range ends below 1e21, where String() would write an 'e+' that a query reads as a space. */
const figures = (v: number) => String(round4(v));
