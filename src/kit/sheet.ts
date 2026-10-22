// A world's student sheet and teacher page, derived from its lesson: the tour's own text, predictions, reveals and
// switches, each stop's classroom notes (TourStop.lesson), and the world's syllabus codes and before-and-after items
// (classroom.ts). Pure: no DOM, no WebGL.

import { isWorldId } from '../worlds';
import type { Authored, TourStop } from '../worlds/types';
import { CLASSROOM, type Classroom, type Syllabus } from './classroom';
import { setupAt, writeLink } from './link';

/** A multiple-choice item as a student sees it. It has no answer field, so a sheet cannot print one. */
export interface Question {
  readonly question: string;
  readonly options: readonly string[];
}

/** A multiple-choice item with its answer and the reason, as the teacher page prints it. */
export interface Answered extends Question {
  readonly answer: number;
  readonly why: string;
}

/** One stop of the lesson path, as the sheet prints it. */
export interface Activity {
  /** Numbered from 1. */
  readonly n: number;
  /** Tour index: the app shows it as `stop + 1 / stops`, so a student can also get there with Next. */
  readonly stop: number;
  readonly title: string;
  /** './?world=…&stop=…', which opens the stop as authored. */
  readonly link: string;
  readonly predict: Question | null;
  /** The stop's observe-and-explain prompts, or one reflection prompt when it has none. */
  readonly prompts: readonly string[];
}

export interface Sheet {
  readonly world: string;
  readonly title: string;
  /** How many stops the tour has. */
  readonly stops: number;
  readonly check: readonly Question[];
  readonly activities: readonly Activity[];
}

/** One stop of the lesson path, as the teacher page prints it. */
export interface Step {
  readonly activity: Activity;
  readonly minutes: number;
  /** The stop's tour text, as students read it on screen. */
  readonly text: string;
  /** The stop's prediction with its answer, and the tour's reveal as the reason. */
  readonly answer: Answered | null;
  readonly misconceptions: readonly string[];
  /** The switch behind each of the activity's prompts, and what it shows. */
  readonly switches: readonly { readonly label: string; readonly hint: string }[];
}

export interface Guide {
  /** The very sheet the students get, so numbers and links agree. */
  readonly sheet: Sheet;
  readonly syllabus: readonly Syllabus[];
  readonly minutes: number;
  readonly steps: readonly Step[];
  /** Every stop with its link and answer, so a stop added to the tour appears here with no other edit. */
  readonly tour: readonly { readonly stop: number; readonly title: string; readonly link: string; readonly answer: Answered | null }[];
  /** Every switch with what it shows, so a switch added to the world appears here with no other edit. */
  readonly switches: readonly { readonly id: string; readonly label: string; readonly hint: string }[];
  readonly check: readonly Answered[];
  /**
   * What the notes name that the world lacks (a switch id), and what one page cannot hold (more than 6 activities,
   * more than 4 options, minutes that don't add up to 15). The pages skip what doesn't resolve; a unit test requires
   * this to be empty for every shipped world.
   */
  readonly problems: readonly string[];
}

/** The student sheet: no answers, no reveals. */
export function sheetOf(lesson: Authored): Sheet {
  return plan(lesson).sheet;
}

/** The teacher page, built around the same activities as the sheet. */
export function guideOf(lesson: Authored): Guide {
  const { sheet, path, minutes, room, problems } = plan(lesson);
  const switches = new Map(lesson.toggles.map(({ id, label, hint }) => [id, { label, hint }]));
  return {
    sheet,
    syllabus: room.syllabus,
    minutes,
    steps: path.map((p, k) => {
      const stop = lesson.tour[p.stop];
      return { activity: sheet.activities[k], minutes: p.minutes, text: stop.text, answer: answerOf(stop), misconceptions: stop.lesson?.misconceptions ?? [], switches: p.explain.map((e) => switches.get(e.toggle)!) };
    }),
    tour: lesson.tour.map((stop, i) => ({ stop: i, title: stop.title, link: link(lesson, i), answer: answerOf(stop) })),
    switches: lesson.toggles.map(({ id, label, hint }) => ({ id, label, hint })),
    check: room.check,
    problems,
  };
}

const MAX_ACTIVITIES = 6;
const MAX_OPTIONS = 4;
const LESSON_MINUTES = 15;
const REFLECT = 'What did you see? Explain why it happens.';
const NO_CLASSROOM: Classroom = { syllabus: [], check: [] };

/**
 * The one place the lesson path is worked out, so the sheet, the teacher page and the problems agree. The path is
 * the stops with minutes, in tour order; a world whose stops have none gets its predictions, sharing the 15 minutes.
 */
function plan(lesson: Authored) {
  const problems: string[] = [];
  const timed = lesson.tour.flatMap((stop, i) => (stop.lesson?.minutes === undefined ? [] : [{ stop: i, minutes: stop.lesson.minutes }]));
  const predictions = lesson.tour.flatMap((stop, i) => (stop.predict ? [i] : [])).slice(0, MAX_ACTIVITIES);
  const share = (k: number) => Math.floor(LESSON_MINUTES / predictions.length) + (k < LESSON_MINUTES % predictions.length ? 1 : 0);
  const chosen = timed.length ? timed : predictions.map((stop, k) => ({ stop, minutes: share(k) }));
  if (chosen.length > MAX_ACTIVITIES) problems.push(`${chosen.length} stops have minutes, but a sheet holds ${MAX_ACTIVITIES} activities`);
  const known = new Set(lesson.toggles.map((t) => t.id));
  const path = chosen.slice(0, MAX_ACTIVITIES).map((p) => {
    const stop = lesson.tour[p.stop];
    for (const e of stop.lesson?.explain ?? []) if (!known.has(e.toggle)) problems.push(`"${stop.title}" explains switch "${e.toggle}", which ${lesson.title} does not have`);
    if (stop.predict && stop.predict.options.length > MAX_OPTIONS) problems.push(`"${stop.title}" has ${stop.predict.options.length} options; a sheet holds ${MAX_OPTIONS}`);
    return { ...p, explain: (stop.lesson?.explain ?? []).filter((e) => known.has(e.toggle)) };
  });
  const minutes = path.reduce((sum, p) => sum + p.minutes, 0);
  if (minutes !== LESSON_MINUTES) problems.push(`The lesson path takes ${minutes} minutes, not ${LESSON_MINUTES}`);
  const room = isWorldId(lesson.id) ? CLASSROOM[lesson.id] : NO_CLASSROOM;
  for (const item of room.check) if (item.options.length > MAX_OPTIONS) problems.push(`"${item.question}" has ${item.options.length} options; a sheet holds ${MAX_OPTIONS}`);
  const activities = path.map((p, k) => {
    const stop = lesson.tour[p.stop];
    return {
      n: k + 1,
      stop: p.stop,
      title: stop.title,
      link: link(lesson, p.stop),
      predict: stop.predict ? { question: stop.predict.question, options: stop.predict.options } : null,
      prompts: p.explain.length ? p.explain.map((e) => e.prompt) : [REFLECT],
    };
  });
  const sheet: Sheet = { world: lesson.id, title: lesson.title, stops: lesson.tour.length, check: room.check.map(({ question, options }) => ({ question, options })), activities };
  return { sheet, path, minutes, room, problems };
}

function answerOf(stop: TourStop): Answered | null {
  const p = stop.predict;
  return p ? { question: p.question, options: p.options, answer: p.answer, why: p.reveal } : null;
}

/** The link that opens a stop as authored. */
function link(lesson: Authored, stop: number): string {
  return writeLink(lesson, setupAt(lesson, stop));
}
