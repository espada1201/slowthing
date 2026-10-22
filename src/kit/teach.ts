// teach.html, the kit's own page: no canvas, no WebGL, nothing from the app shell. `?sheet=<world>` is the student
// sheet, `?guide=<world>` the teacher page, and anything else (or an id that is not a world) the index of worlds.

import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './kit.css';
import { WORLD_CARDS, h } from '../ui/dom';
import { WORLDS, isWorldId } from '../worlds';
import { type Activity, type Answered, type Guide, type Question, type Sheet, type Step, guideOf, sheetOf } from './sheet';

type Card = (typeof WORLD_CARDS)[number];
/** Inline SVG markup of a QR code for an absolute URL. */
type Qr = (url: string) => string;

const FACES = ['400 1em "Instrument Serif"', 'italic 400 1em "Instrument Serif"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];

/** Draw the page the query names, then set body[data-ready] once its fonts are in, so a printout has them. */
async function show(query: URLSearchParams, root: HTMLElement): Promise<void> {
  const id = query.get('sheet') ?? query.get('guide');
  const card = WORLD_CARDS.find((c) => c.id === id);
  if (!isWorldId(id) || !card) root.replaceChildren(indexPage());
  else if (query.has('sheet')) {
    const [{ lesson }, qr] = await Promise.all([WORLDS[id](), qrCodes()]);
    document.title = `${lesson.title} · Student sheet · Slowlight`;
    root.replaceChildren(sheetPage(sheetOf(lesson), card, qr));
  } else {
    const { lesson } = await WORLDS[id]();
    document.title = `${lesson.title} · Teacher page · Slowlight`;
    root.replaceChildren(guidePage(guideOf(lesson), card));
  }
  await Promise.all(FACES.map((f) => document.fonts.load(f)));
  document.body.dataset.ready = '';
}

/** uqr, imported here only, so the app never downloads it. Level M and a 4-module margin survive a photocopier. */
async function qrCodes(): Promise<Qr> {
  const { renderSVG } = await import('uqr');
  return (url) => renderSVG(url, { ecc: 'M', border: 4 });
}

function indexPage(): HTMLElement {
  return h(
    'div',
    { class: 'index' },
    h('nav', { class: 'bar', 'aria-label': 'Slowlight' }, h('a', { class: 'btn ghost', href: './' }, '← Slowlight')),
    h(
      'header',
      { class: 'head' },
      h('p', { class: 'kicker' }, 'For teachers'),
      h('h1', {}, 'Slowlight in class'),
      h('p', { class: 'lede' }, 'Each world has a one-page student sheet and a teacher page, both made from its guided tour. Every code and link on them opens the stop it names, with the same switches and dials.'),
    ),
    h(
      'ul',
      { class: 'worlds' },
      ...WORLD_CARDS.filter((c) => isWorldId(c.id)).map((c) =>
        h(
          'li',
          { class: 'world', 'data-world': c.id },
          h('span', { class: 'plate-no' }, c.plate),
          h('span', { class: 'art', html: c.art }),
          h('h2', {}, c.title),
          h('p', { class: 'dial' }, c.dial),
          h('p', { class: 'blurb' }, c.blurb),
          h('p', { class: 'links' }, h('a', { class: 'btn', href: `?guide=${c.id}` }, 'Teacher page'), ' ', h('a', { class: 'btn ghost', href: `?sheet=${c.id}` }, 'Student sheet')),
        ),
      ),
    ),
    h(
      'section',
      { class: 'how-to' },
      h('h2', {}, 'A lesson in fifteen minutes'),
      h('p', {}, 'Students answer the before-and-after questions on the sheet, then work through its activities: predict, look, explain. Each activity’s QR code opens its stop. At the end they answer the same questions again. The teacher page has the answers and the reasons, what to watch for, and every link.'),
    ),
  );
}

/**
 * The student sheet, one A4 or Letter page: name and class lines, the check items with Before and After boxes, then
 * per activity its QR code, its stop, the prediction as tick boxes or a measurement's blanks, and each prompt with
 * lines to write on. A Sheet holds no answers, so none can print.
 */
function sheetPage(sheet: Sheet, card: Card, qr: Qr): HTMLElement {
  const site = new URL('./', location.href);
  const address = (site.host + site.pathname).replace(/\/$/, '');
  return h(
    'div',
    { class: 'desk' },
    bar(h('a', { class: 'btn ghost', href: `?guide=${sheet.world}` }, 'Teacher page'), h('button', { class: 'btn', onclick: () => window.print() }, 'Print'), h('span', { class: 'bar-note' }, 'One page on A4 or Letter, at 100% scale.')),
    localOnly(),
    h(
      'article',
      { class: 'paper', 'aria-label': `${sheet.title}, student sheet` },
      h(
        'div',
        { class: 'sheet' },
        h(
          'header',
          { class: 'sheet-head' },
          h('div', {}, h('p', { class: 'kicker' }, `Slowlight · ${card.plate} · Student sheet`), h('h1', {}, sheet.title)),
          h('p', { class: 'who' }, ...['Name', 'Class', 'Date'].flatMap((label) => [h('span', {}, label), ' '])),
        ),
        h('p', { class: 'how' }, 'Before each activity, tick what you predict. Then scan its code (or open ', h('code', {}, address), ' and press Next to its stop), look, and write what you saw and why.'),
        h(
          'section',
          { class: 'check', 'aria-label': 'Before and after' },
          h('div', { class: 'check-head' }, h('div', {}, h('h2', {}, 'Before and after'), h('p', {}, 'Answer at the start, and again at the end: a letter in each box.')), h('span', {}, 'Before'), h('span', {}, 'After')),
          h('ol', {}, ...sheet.check.map((q) => h('li', {}, h('p', {}, q.question, ...inline(q)), h('span', { class: 'box' }), h('span', { class: 'box' })))),
        ),
        h('ol', { class: 'activities' }, ...sheet.activities.map((a) => activity(a, sheet.stops, qr))),
      ),
    ),
  );
}

function activity(a: Activity, stops: number, qr: Qr): HTMLElement {
  const url = absolute(a.link);
  return h(
    'li',
    { class: 'activity' },
    h(
      'div',
      { class: 'act-head' },
      h('a', { class: 'qr', href: url, html: qr(url), 'aria-label': `Open activity ${a.n}, ${a.title}, in Slowlight` }),
      h(
        'div',
        {},
        h('h2', {}, h('span', { class: 'n' }, String(a.n)), a.title),
        h('p', { class: 'stop' }, `Stop ${a.stop + 1} of ${stops}`),
        a.predict ? h('p', { class: 'predict' }, h('span', { class: 'tag' }, 'Predict'), a.predict.question) : null,
        a.measure ? h('p', { class: 'measure' }, h('span', { class: 'tag' }, 'Measure'), a.measure.question) : null,
      ),
    ),
    a.predict ? h('ul', { class: 'ticks' }, ...a.predict.options.map((o, i) => h('li', {}, h('span', { class: 'letter' }, letter(i)), ' ', o))) : null,
    a.measure ? h('p', { class: 'asks' }, ...a.measure.asks.map((q) => h('span', {}, `${q.symbol} =`, h('span', { class: 'blank' }), q.unit))) : null,
    ...a.prompts.flatMap((p) => [h('p', { class: 'prompt' }, p), h('div', { class: 'write' })]),
  );
}

/**
 * The teacher page: syllabus codes; the lesson path, each step with its minutes, the stop's text, the answer and why
 * or a measurement's steps, what to watch for and the switch behind each prompt; the check's answers; every stop's
 * link, with a button that copies them all; every switch; and how to hand links out.
 */
function guidePage(guide: Guide, card: Card): HTMLElement {
  const { sheet } = guide;
  const onSheet = new Map(sheet.activities.map((a) => [a.stop, a.n]));
  const links = guide.tour.map((t) => `${t.stop + 1}. ${t.title}: ${absolute(t.link)}`).join('\n');
  const copied = h('span', { class: 'copied', role: 'status' });
  const blocked = () => (copied.textContent = 'Copying is blocked here: select the links below instead.');
  const copy = () => navigator.clipboard?.writeText(links).then(() => (copied.textContent = `Copied ${guide.tour.length} links.`), blocked) ?? blocked();
  return h(
    'div',
    { class: 'guide' },
    bar(h('button', { class: 'btn', onclick: () => window.print() }, 'Print'), h('a', { class: 'btn ghost', href: `?sheet=${sheet.world}` }, 'Student sheet to print for the class')),
    localOnly(),
    h('header', { class: 'head' }, h('p', { class: 'kicker' }, `${card.plate} · Teacher page`), h('h1', {}, sheet.title), h('p', { class: 'lede' }, card.blurb)),
    section(
      'Where it fits',
      h(
        'table',
        { class: 'syllabus' },
        h('thead', {}, h('tr', {}, ...['Course', 'Code', 'Topic'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...guide.syllabus.map((s) => h('tr', {}, h('td', {}, s.course), h('td', {}, s.code), h('td', {}, s.topic)))),
      ),
    ),
    section(
      `A ${guide.minutes}-minute lesson`,
      h('p', {}, 'Ask the before-and-after questions first. Then take the class through the activities on the student sheet: predict, look, explain. Ask the same questions again at the end.'),
      h('ol', { class: 'steps' }, ...guide.steps.map((s) => step(s, sheet.stops))),
    ),
    section('Before and after', h('p', {}, 'Not graded: the change from before to after is your evidence of learning.'), h('ol', { class: 'checks' }, ...guide.check.map((q) => h('li', {}, answered(q))))),
    section(
      'Every stop',
      h('p', {}, 'Each link opens its stop as the tour shows it. Post them on your class’s learning platform.'),
      h('p', { class: 'copy' }, h('button', { class: 'btn', 'data-copy-links': true, onclick: copy }, 'Copy all links'), copied),
      h(
        'ol',
        { class: 'stops' },
        ...guide.tour.map((t) => {
          const url = absolute(t.link);
          const n = onSheet.get(t.stop);
          return h('li', {}, h('p', { class: 'meta' }, `Stop ${t.stop + 1} of ${sheet.stops}`), h('h3', {}, t.title), h('p', {}, h('a', { class: 'link', href: url }, url)), n ? h('p', { class: 'on-sheet' }, `Activity ${n} on the student sheet.`) : t.answer ? answered(t.answer) : null);
        }),
      ),
    ),
    section('Switches', h('dl', { class: 'switches' }, ...guide.switches.flatMap((s) => [h('dt', {}, s.label), h('dd', {}, s.hint)]))),
    section(
      'Handing out links',
      h(
        'ul',
        { class: 'hand-out' },
        h('li', {}, 'Print the student sheet. Each activity’s QR code opens its stop: a Chromebook’s camera app reads it, and so does a phone’s camera.'),
        h('li', {}, 'Or post the links on your class’s learning platform: press Copy all links above and paste them in.'),
        h('li', {}, `With neither, students open Slowlight, choose ${sheet.title} and press Next until they reach the stop number on the sheet.`),
        h('li', {}, 'For a setup of your own, press Share in the world: it copies a link to the stop, switches and dials you are looking at.'),
      ),
    ),
  );
}

function step(s: Step, stops: number): HTMLElement {
  const a = s.activity;
  const url = absolute(a.link);
  return h(
    'li',
    { class: 'step' },
    h('p', { class: 'meta' }, `${s.minutes} min · Activity ${a.n} · Stop ${a.stop + 1} of ${stops}`),
    h('h3', {}, a.title),
    h('p', {}, h('a', { class: 'link', href: url }, url)),
    h('p', { class: 'text' }, s.text),
    s.answer ? answered(s.answer) : null,
    a.measure
      ? h(
          'div',
          { class: 'measure' },
          h('p', { class: 'q' }, a.measure.question),
          h('ol', {}, ...s.method.map((t) => h('li', {}, t))),
          h('p', { class: 'note' }, 'The app gives the true values when a student answers or presses Just show me, worked out from where they stand.'),
        )
      : null,
    s.misconceptions.length ? h('div', { class: 'watch' }, h('p', { class: 'label' }, 'Watch for'), h('ul', {}, ...s.misconceptions.map((m) => h('li', {}, m)))) : null,
    h('div', { class: 'prompts' }, h('p', { class: 'label' }, 'On the sheet'), h('ul', {}, ...a.prompts.map((p, i) => h('li', {}, p, s.switches[i] ? h('span', { class: 'note' }, ` ${s.switches[i].label} switch: ${s.switches[i].hint}.`) : null)))),
  );
}

function answered(q: Answered): HTMLElement {
  return h('div', { class: 'answered' }, h('p', { class: 'q' }, q.question, ...inline(q)), h('p', { class: 'answer' }, `Answer: ${letter(q.answer)} ${q.options[q.answer]}`), h('p', { class: 'why' }, q.why));
}

const inline = (q: Question) => q.options.flatMap((o, i) => [' ', h('span', { class: 'opt' }, h('span', { class: 'letter' }, letter(i)), '\u00a0', o)]);
const letter = (i: number) => `${String.fromCharCode(97 + i)})`;
const section = (title: string, ...children: Node[]) => h('section', {}, h('h2', {}, title), ...children);

/** The screen-only toolbar: back to the index, then the page's own buttons. */
const bar = (...items: Node[]) => h('nav', { class: 'bar', 'aria-label': 'Teaching kit' }, h('a', { class: 'btn ghost', href: location.pathname }, '← All worlds'), ...items);

/** Served from this computer, every code and link names an address students' devices cannot reach. Screen only. */
const localOnly = () =>
  /^(localhost|127(\.\d+){3}|\[::1\])$/.test(location.hostname)
    ? h('p', { class: 'local', role: 'note' }, 'These codes and links point at this computer (localhost), so students’ devices cannot open them. Print from the published site instead; the README says how to publish it.')
    : null;

/** A kit link ('./?world=…') as the absolute URL a QR code or a learning platform needs: teach.html sits beside index.html. */
const absolute = (link: string) => new URL(link, location.href).href;

const root = document.querySelector<HTMLElement>('#kit')!;
show(new URLSearchParams(location.search), root).catch((e: Error) => root.replaceChildren(h('p', { class: 'error', role: 'alert' }, `This page could not load: ${e.message}`)));
