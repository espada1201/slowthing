import { describe, expect, expectTypeOf, it } from 'vitest';
import { type ConstantKey, type Constants, DIALS, REAL, SLIDER_STEPS, fromSlider, toSlider } from '../src/constants';
import { type Setup, applySetup, readLink, setupAt, setupOf, stopKey, writeLink } from '../src/kit/link';
import { WORLDS } from '../src/worlds';
import { seeded } from '../src/worlds/shared';
import { SlowLightLesson } from '../src/worlds/slowLight';
import type { Authored } from '../src/worlds/types';

const lessons = await Promise.all(Object.values(WORLDS).map(async (load) => (await load()).lesson));
const [slowLight, bigHbar, bigG] = lessons;
const terrell = slowLight.tour.findIndex((s) => s.title === 'Terrell rotation');

/** Read a link the way the app reads its own address. A link that names nothing beyond its world opens stop 1. */
const open = (lesson: Authored, link: string) => readLink(lesson, new URL(link, 'https://school.example/slowlight/').searchParams) ?? setupAt(lesson, 0);

/** A dial value a visitor could reach, or a wild one: slider steps, the range ends, the real value, outside the range. */
function anyDial(k: ConstantKey, rand: () => number) {
  const d = DIALS[k];
  const picks = [d.min, d.max, REAL[k], fromSlider(d, Math.floor(rand() * (SLIDER_STEPS + 1))), d.min * (d.max / d.min) ** rand(), d.min / 3, d.max * 7];
  return picks[Math.floor(rand() * picks.length)];
}

describe('links', () => {
  it('read back every setup they write, and write it again the same way', () => {
    const rand = seeded(7);
    for (const lesson of lessons) {
      for (let i = 0; i < lesson.tour.length; i++) {
        for (let n = 0; n < 50; n++) {
          const switches = Object.fromEntries(lesson.toggles.filter(() => rand() < 0.5).map((t) => [t.id, rand() < 0.5]));
          const dials = Object.fromEntries(lesson.dials.filter(() => rand() < 0.7).map((k) => [k, anyDial(k, rand)]));
          const s = setupAt(lesson, i, { switches, dials });
          const link = writeLink(lesson, s);
          expect(link, link).not.toMatch(/[+ %]/);
          expect(open(lesson, link), link).toEqual(s);
          expect(writeLink(lesson, open(lesson, link))).toBe(link);
        }
      }
    }
  });

  it('name just the world and the stop for a stop as authored, and add only what differs', () => {
    for (const lesson of lessons) {
      expect(writeLink(lesson, setupAt(lesson, 0))).toBe(`./?world=${lesson.id}`);
      for (let i = 1; i < lesson.tour.length; i++) expect(writeLink(lesson, setupAt(lesson, i))).toBe(`./?world=${lesson.id}&stop=${stopKey(lesson.tour[i])}`);
    }
    expect(writeLink(slowLight, setupAt(slowLight, terrell, { switches: { doppler: true } }))).toBe('./?world=slow-light&stop=terrell-rotation&on=doppler');
    expect(writeLink(slowLight, setupAt(slowLight, terrell, { switches: { delay: false, beaming: true, doppler: true }, dials: { c: 30 } }))).toBe('./?world=slow-light&stop=terrell-rotation&on=doppler,beaming&off=delay&c=30');
  });

  it('write dials to 4 significant figures, never with a "+"', () => {
    expect(writeLink(slowLight, setupAt(slowLight, 0, { dials: { c: 12.08741 } }))).toBe('./?world=slow-light&c=12.09');
    expect(writeLink(bigHbar, setupAt(bigHbar, 0, { dials: { hbar: 2.345678e-20 } }))).toBe('./?world=big-hbar&hbar=2.346e-20');
    expect(writeLink(bigG, setupAt(bigG, 0, { dials: { G: 1.23456e12 } }))).toBe('./?world=big-g&G=1235000000000');
    expect(writeLink(slowLight, setupAt(slowLight, 0, { dials: { c: REAL.c } }))).toBe('./?world=slow-light&c=299800000');
  });

  it('still open the links Share wrote when they carried only dials', () => {
    expect(open(slowLight, '?world=slow-light&c=50')).toEqual(setupAt(slowLight, 0, { dials: { c: 50 } }));
    expect(open(slowLight, '?world=slow-light&c=50').dials.c).toBe(50);
    expect(open(slowLight, '?world=slow-light&c=2.998e%2B8').dials.c).toBe(REAL.c);
    expect(open(slowLight, '?world=slow-light&c=1').dials.c).toBe(DIALS.c.min);
    expect(open(slowLight, '?world=slow-light&c=abc')).toEqual(setupAt(slowLight, 0));
    expect(open(slowLight, '?world=slow-light&c=abc').dials.c).toBe(12);
    expect(open(bigHbar, '?world=big-hbar&hbar=0.5').dials.hbar).toBe(0.5);
    expect(open(bigHbar, '?world=big-hbar&hbar=1.055e-34').dials.hbar).toBe(REAL.hbar);
    expect(open(bigG, '?world=big-g&G=6.674e-11').dials.G).toBe(REAL.G);
    // The old Share wrote every dial with toPrecision(4); at the first stop's own value that is the world as authored.
    for (const lesson of lessons) {
      const k = lesson.dials[0];
      const own = lesson.tour[0].constants?.[k] ?? lesson.preset[k]!;
      expect(open(lesson, `?world=${lesson.id}&${new URLSearchParams({ [k]: own.toPrecision(4) })}`)).toEqual(setupAt(lesson, 0));
    }
  });

  it('ignore or clamp hostile values, and never throw', () => {
    const first = setupAt(slowLight, 0);
    const cases: [string, Setup | null][] = [
      ['stop=__proto__', first],
      ['stop=constructor', first],
      ['stop=toString', first],
      ['stop=9999', first],
      ['stop=-1', first],
      ['on=__proto__,x', first],
      ['on=constructor&off=hasOwnProperty', first],
      ['on=delay&off=delay', first],
      ['on=,,,&off=', first],
      ['c=0x10', first],
      ['c=-5', first],
      ['c=NaN', first],
      ['c=Infinity', first],
      ['c=1e999', first],
      ['c=0', first],
      ['c=1e-999', first],
      ['c=%2010', first],
      ['c=10.', first],
      ['c=.5', first],
      [`c=${'1'.repeat(10_000)}`, first],
      [`stop=${'a'.repeat(10_000)}`, first],
      [`on=${'delay,'.repeat(2000)}`, first],
      ['c=50&c=1e999', setupAt(slowLight, 0, { dials: { c: 50 } })],
      ['c=1e999&c=50', first],
      ['hbar=1', null],
      ['view=%3Cscript%3E', null],
      ['stop=the-late-clock&hbar=1&view=%3Cscript%3E', setupAt(slowLight, 1)],
      ['stop=terrell-rotation&on=doppler,doppler,__proto__&off=delay,adapt,delay&c=3e10', setupAt(slowLight, terrell, { switches: { doppler: true, delay: false, adapt: false }, dials: { c: REAL.c } })],
    ];
    for (const [query, want] of cases) expect(readLink(slowLight, new URLSearchParams(`world=slow-light&${query}`)), query.slice(0, 60)).toEqual(want);
  });

  it('read nothing from a link into another world, or one that names nothing beyond its world', () => {
    for (const query of ['world=big-g&G=1', 'c=50', 'stop=the-late-clock', 'world=slow-light', 'world=slow-light&quality=low&e2e', 'world=SLOW-LIGHT&c=50', 'world=slow-light%00&c=50', '']) {
      expect(readLink(slowLight, new URLSearchParams(query)), query).toBeNull();
    }
  });

  it('name every stop and switch with a unique, link-safe id', () => {
    for (const lesson of lessons) {
      const keys = lesson.tour.map(stopKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const id of [...keys, ...lesson.toggles.map((t) => t.id)]) expect(id, lesson.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(stopKey({ title: 'The late clock', text: '' })).toBe('the-late-clock');
    expect(stopKey({ title: 'Colours you cannot normally see', text: '' })).toBe('colours-you-cannot-normally');
    expect(stopKey({ title: 'Ça marche, à côté!', text: '' })).toBe('ca-marche-a-cote');
    expect(stopKey({ title: 'Renamed for clarity', key: 'the-late-clock', text: '' })).toBe('the-late-clock');
  });

  it('keep every slider step through the 4-figure rounding, and the real values exactly', () => {
    for (const lesson of lessons) {
      for (const k of lesson.dials) {
        const d = DIALS[k];
        for (let step = 0; step <= SLIDER_STEPS; step++) {
          const back = open(lesson, writeLink(lesson, setupAt(lesson, 0, { dials: { [k]: fromSlider(d, step) } })));
          expect(toSlider(d, back.dials[k]!), `${k} step ${step}`).toBe(step);
        }
        for (let i = 0; i < lesson.tour.length; i++) {
          for (const v of [REAL[k], d.min, d.max]) expect(open(lesson, writeLink(lesson, setupAt(lesson, i, { dials: { [k]: v } }))).dials[k], `${k} = ${v} at stop ${i + 1}`).toBe(v);
        }
      }
    }
  });
});

describe('a live world', () => {
  it('shares exactly the setup a link put into it', () => {
    const live = new SlowLightLesson();
    const constants: Constants = { ...REAL };
    const rand = seeded(11);
    for (let i = 0; i < slowLight.tour.length; i++) {
      const s = setupAt(slowLight, i, { switches: { delay: false, adapt: rand() < 0.5 }, dials: { c: fromSlider(DIALS.c, Math.floor(rand() * SLIDER_STEPS)) } });
      applySetup(live, constants, s);
      expect(setupOf(live, i, constants)).toEqual(s);
      expect(live.toggles.find((t) => t.id === 'delay')!.value).toBe(false);
      expect(constants.c).toBe(s.dials.c);
    }
  });

  it('writes a switch the visitor turned off against the authored defaults, not the live ones', () => {
    const live = new SlowLightLesson();
    const constants: Constants = { ...REAL };
    applySetup(live, constants, setupAt(slowLight, terrell));
    live.toggles.find((t) => t.id === 'adapt')!.value = false;
    expect(writeLink(slowLight, setupOf(live, terrell, constants))).toBe('./?world=slow-light&stop=terrell-rotation&off=adapt');
  });

  it('keeps a stop’s own dial value exactly, and a dial nudged within rounding of it', () => {
    const live = new SlowLightLesson();
    expect(setupOf(live, 0, { ...REAL, c: 12.0004 }).dials.c).toBe(12);
    expect(writeLink(slowLight, setupOf(live, 0, { ...REAL, c: 12.0004 }))).toBe('./?world=slow-light');
    const g = bigG.preset.G!;
    expect(writeLink(bigG, setupAt(bigG, 0, { dials: { G: g * (1 + 1e-5) } }))).toBe('./?world=big-g');
  });

  it('ignores a setup for another world', () => {
    const live = new SlowLightLesson();
    const constants: Constants = { ...REAL };
    applySetup(live, constants, setupAt(bigHbar, 2, { switches: { wave: false }, dials: { hbar: 1 } }));
    expect(constants).toEqual(REAL);
    expect(live.toggles).toEqual(new SlowLightLesson().toggles);
  });

  it('cannot be written as a link: links are written against authored lessons only', () => {
    expectTypeOf(writeLink).parameter(0).toEqualTypeOf<Authored>();
    expectTypeOf(readLink).parameter(0).toEqualTypeOf<Authored>();
    expectTypeOf(setupAt).parameter(0).toEqualTypeOf<Authored>();
    expectTypeOf<SlowLightLesson>().not.toExtend<Authored>();
    expect(() => writeLink(slowLight, setupAt(bigG, 0))).toThrow();
  });
});
