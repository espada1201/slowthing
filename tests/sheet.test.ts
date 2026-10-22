import { describe, expect, it } from 'vitest';
import { CLASSROOM } from '../src/kit/classroom';
import { readLink, setupAt } from '../src/kit/link';
import { guideOf, sheetOf } from '../src/kit/sheet';
import { WORLDS, author, isWorldId } from '../src/worlds';
import { SlowLightLesson } from '../src/worlds/slowLight';
import type { Authored } from '../src/worlds/types';

const lessons = await Promise.all(Object.values(WORLDS).map(async (load) => (await load()).lesson));
const open = (lesson: Authored, link: string) => readLink(lesson, new URL(link, 'https://school.example/slowlight/teach.html?sheet=x').searchParams) ?? setupAt(lesson, 0);

/** World I, edited the way an author edits a tour: no notes on any stop, then whatever `edit` does. */
function slowLight(edit: (l: SlowLightLesson) => void = () => {}): Authored {
  const l = new SlowLightLesson();
  for (const stop of l.tour) delete stop.lesson;
  edit(l);
  return author(l);
}

const stopNamed = (l: SlowLightLesson, title: string) => l.tour.find((s) => s.title === title)!;

describe('the sheet and the teacher page', () => {
  it('resolve for every shipped world: one page, 15 minutes, nothing missing', () => {
    for (const lesson of lessons) {
      const guide = guideOf(lesson);
      expect(guide.problems, lesson.id).toEqual([]);
      expect(guide.minutes).toBe(15);
      expect(guide.steps.reduce((sum, s) => sum + s.minutes, 0)).toBe(15);
      expect(guide.sheet.activities.length).toBeGreaterThan(0);
      expect(guide.sheet.activities.length).toBeLessThanOrEqual(6);
      expect(guide.syllabus.length).toBeGreaterThan(0);
      expect(guide.check.length).toBeGreaterThan(0);
    }
  });

  it('put no answers and no reveals on a sheet', () => {
    for (const lesson of lessons) {
      const json = JSON.stringify(sheetOf(lesson));
      expect(json).not.toMatch(/"(answer|why|reveal)"/);
      for (const stop of lesson.tour) if (stop.predict) expect(json).not.toContain(stop.predict.reveal);
      for (const item of guideOf(lesson).check) expect(json).not.toContain(item.why);
    }
  });

  it('give every activity a link that opens its stop as authored', () => {
    for (const lesson of lessons) {
      for (const a of sheetOf(lesson).activities) {
        expect(a.link).toMatch(new RegExp(`^\\./\\?world=${lesson.id}(&stop=[a-z0-9-]+)?$`));
        expect(open(lesson, a.link)).toEqual(setupAt(lesson, a.stop));
      }
    }
  });

  it('answer each prediction with the tour’s own reveal, on the path and in the full tour', () => {
    for (const lesson of lessons) {
      const guide = guideOf(lesson);
      for (const step of guide.steps) {
        const predict = lesson.tour[step.activity.stop].predict;
        expect(step.answer).toEqual(predict ? { question: predict.question, options: predict.options, answer: predict.answer, why: predict.reveal } : null);
        expect(step.text).toBe(lesson.tour[step.activity.stop].text);
      }
      expect(guide.tour.map((t) => t.title)).toEqual(lesson.tour.map((s) => s.title));
      expect(guide.tour.filter((t) => t.answer).length).toBe(lesson.tour.filter((s) => s.predict).length);
    }
  });

  it('take a world without notes through its predictions, at most 6, sharing the 15 minutes', () => {
    const plain = slowLight();
    const guide = guideOf(plain);
    expect(guide.sheet.activities.map((a) => a.stop)).toEqual(plain.tour.flatMap((s, i) => (s.predict ? [i] : [])).slice(0, 6));
    expect(guide.steps.every((s) => Math.abs(s.minutes - 15 / guide.steps.length) < 1)).toBe(true);
    expect(guide.sheet.activities.every((a) => a.prompts.length === 1)).toBe(true);
    expect(guide.problems).toEqual([]);

    const many = slowLight((l) => {
      for (let i = 0; i < 4; i++) l.tour.push({ title: `Extra ${i + 1}`, text: 'More.', predict: { question: 'Which?', options: ['this', 'that'], answer: 0, reveal: 'This.' } });
    });
    expect(sheetOf(many).activities.length).toBe(6);
    expect(guideOf(many).minutes).toBe(15);
    expect(guideOf(many).problems).toEqual([]);
  });

  it('follow the stops’ own notes: minutes in tour order, prompts tied to switches, misconceptions', () => {
    const lesson = slowLight((l) => {
      stopNamed(l, 'Terrell rotation').lesson = { minutes: 9, misconceptions: ['A moving object looks squashed.'], explain: [{ toggle: 'delay', prompt: 'Turn Light delay off. What changes, and why?' }] };
      stopNamed(l, 'The late clock').lesson = { minutes: 6 };
    });
    const guide = guideOf(lesson);
    expect(guide.problems).toEqual([]);
    expect(guide.sheet.activities.map((a) => [a.n, a.title])).toEqual([
      [1, 'The late clock'],
      [2, 'Terrell rotation'],
    ]);
    expect(guide.sheet.activities[0].prompts).toEqual(['What did you see? Explain why it happens.']);
    expect(guide.sheet.activities[1].prompts).toEqual(['Turn Light delay off. What changes, and why?']);
    expect(guide.steps[1].switches).toEqual([{ label: 'Light delay', hint: lesson.toggles.find((t) => t.id === 'delay')!.hint }]);
    expect(guide.steps[1].misconceptions).toEqual(['A moving object looks squashed.']);
    expect(guide.steps.map((s) => s.minutes)).toEqual([6, 9]);
  });

  it('print a measurement’s question, what to work out and its steps, and never work out its answer', () => {
    const lesson = slowLight((l) => {
      const stop = stopNamed(l, 'Stopping');
      stop.measure = {
        question: 'How far did the clock 100 m ahead jump?',
        steps: ['Read it on the map just before and just after you stop.'],
        given: [],
        asks: [{ symbol: 'Δt', unit: 's' }],
        answer: () => {
          throw new Error('the kit worked out an answer');
        },
      };
      stop.lesson = { minutes: 15 };
    });
    const guide = guideOf(lesson);
    expect(guide.problems).toEqual([]);
    expect(guide.sheet.activities[0].measure).toEqual({ question: 'How far did the clock 100 m ahead jump?', asks: [{ symbol: 'Δt', unit: 's' }] });
    expect(guide.sheet.activities[0].prompts).toEqual(['Show your working.']);
    expect(guide.steps[0].method).toEqual(['Read it on the map just before and just after you stop.']);
    expect(guide.steps[0].answer).toBeNull();
  });

  it('pick up a new stop or switch with no other edit', () => {
    const reveal = 'Because the new stop says so.';
    const lesson = slowLight((l) => {
      l.tour.push({ title: 'A new stop', text: 'Look again.', toggles: { beaming: false }, predict: { question: 'What now?', options: ['this', 'that'], answer: 1, reveal } });
      l.toggles.push({ id: 'grid', label: 'Grid', hint: 'Lines every metre', value: false });
    });
    const guide = guideOf(lesson);
    const added = guide.tour.at(-1)!;
    expect(added.title).toBe('A new stop');
    expect(added.answer?.why).toBe(reveal);
    expect(added.link).toBe('./?world=slow-light&stop=a-new-stop');
    expect(open(lesson, added.link).switches).toMatchObject({ beaming: false, grid: false });
    expect(guide.switches.at(-1)).toEqual({ id: 'grid', label: 'Grid', hint: 'Lines every metre' });
  });

  it('report what does not resolve or fit, and leave it off the sheet', () => {
    const lesson = slowLight((l) => {
      stopNamed(l, 'Terrell rotation').lesson = { minutes: 5, explain: [{ toggle: 'squash', prompt: 'Turn Squash off.' }, { toggle: 'delay', prompt: 'Turn Light delay off.' }] };
      stopNamed(l, 'The late clock').lesson = { minutes: 5 };
      stopNamed(l, 'The late clock').predict!.options.push('a day behind', 'a year behind');
    });
    const guide = guideOf(lesson);
    expect(guide.problems).toEqual([
      '"The late clock" has 5 options; a sheet holds 4',
      '"Terrell rotation" explains switch "squash", which Slow Light does not have',
      'The lesson path takes 10 minutes, not 15',
    ]);
    expect(guide.sheet.activities[1].prompts).toEqual(['Turn Light delay off.']);

    const crowded = slowLight((l) => l.tour.slice(0, 7).forEach((stop) => (stop.lesson = { minutes: 2 })));
    expect(guideOf(crowded).problems).toEqual(['7 stops have minutes, but a sheet holds 6 activities', 'The lesson path takes 12 minutes, not 15']);
    expect(sheetOf(crowded).activities.length).toBe(6);
  });
});

describe('the classroom content', () => {
  it('gives every world syllabus codes and before-and-after items with reasons', () => {
    for (const id of Object.keys(WORLDS)) {
      if (!isWorldId(id)) throw new Error(id);
      const room = CLASSROOM[id];
      expect(room.syllabus.length).toBeGreaterThan(0);
      for (const item of room.check) {
        expect(item.answer).toBeGreaterThanOrEqual(0);
        expect(item.answer).toBeLessThan(item.options.length);
        expect(item.why.length).toBeGreaterThan(0);
      }
    }
  });
});
