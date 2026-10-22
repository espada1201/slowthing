// The Measured view's DOM: a heading-up map of your now and a spacetime diagram along your motion, drawn as SVG in
// CSS pixels so the labels stay legible from a phone to a desktop. Colours come from style.css.

import { formatSI } from '../constants';
import type { DiagramPoint, MapPoint, MeasuredModel } from '../worlds/measured';
import { clockString } from '../worlds/shared';
import { h } from './dom';

/** Metres from you to the map's sides. You sit a quarter of the way up, so it reaches three times as far ahead as behind. */
const MAP_HALF = 45;
/** Metres along your motion from you to the diagram's sides. */
const DIAGRAM_HALF = 90;
/** Width of a label character (IBM Plex Mono at 10.5 px), to keep labels from overlapping. */
const CHAR = 6.3;

type Attrs = Record<string, string | number>;
type Box = [number, number, number, number];
const set = (e: Element, attrs: Attrs) => {
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
};
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (SVGElement | string)[]) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  set(e, attrs);
  e.append(...children);
  return e;
};
const path = (rings: [number, number][][], close: boolean) => rings.map((r) => r.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + (close ? 'Z' : '')).join('');
const apart = (a: Box, b: Box) => a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3];

/** A drawing surface that tracks its own size in CSS pixels. */
function surface(className: string, label: string) {
  const el = svg('svg', { class: className, role: 'img', 'aria-label': label });
  const size = { w: 0, h: 0 };
  new ResizeObserver(([e]) => {
    size.w = e.contentRect.width;
    size.h = e.contentRect.height;
    set(el, { viewBox: `0 0 ${size.w} ${size.h}` });
  }).observe(el);
  return { el, size };
}

export class MeasuredView {
  /** The map and the diagram, with a tag naming the 3D view as Seen; hidden until the world shows it. */
  readonly root: HTMLElement;
  private map = surface('m-map', 'Map of the town at your now, in your frame: where everything is and what each clock reads');
  private diagram = surface('m-diagram', 'Spacetime diagram along your motion: the events at your now, which the map shows, and the events whose light reaches you now, which you see');
  private grid = svg('path', { class: 'm-grid' });
  private track = svg('path', { class: 'm-track' });
  private blocks = svg('path', { class: 'm-block' });
  private trams = svg('path', { class: 'm-tram' });
  private lamps = svg('g');
  private clocks = svg('g');
  private clockMarks = new Map<string, { dot: SVGCircleElement; label: SVGTextElement }>();
  private carText = svg('text', { class: 'm-label m-car' });
  private motion = svg('line', { class: 'm-motion' });
  private you = svg('path', { class: 'm-you', d: 'M0 -7L5 5L0 2L-5 5Z' });
  private north = svg('g', { class: 'm-north' }, svg('path', { d: 'M0 -9L3.5 -1H-3.5Z' }), svg('text', { y: 9, 'text-anchor': 'middle' }, 'N'));
  private scaleBar = svg('path', { class: 'm-scale' });
  private scaleText = svg('text', { class: 'm-small' }, '20 m');
  private cone = svg('path', { class: 'd-cone' });
  private coneEdge = svg('path', { class: 'd-seen' });
  private nowLine = svg('line', { class: 'd-now' });
  private yourLine = svg('line', { class: 'd-you' });
  private lines = svg('g');
  private dots = svg('g');
  private nowText = svg('text', { class: 'd-label d-now-label' }, 'your now · Measured');
  private seenText = svg('text', { class: 'd-label d-seen-label' }, 'light reaching you · Seen');
  private towerNow = svg('text', { class: 'd-label d-now-label', 'data-clock': 'tower' });
  private towerSeen = svg('text', { class: 'd-label d-seen-label', 'data-clock': 'tower' });
  private ticks = svg('g');
  private ticksFor = '';
  private axisText = svg('text', { class: 'm-small', 'text-anchor': 'end' });

  constructor(private readonly clockStart: number) {
    this.map.el.append(this.grid, this.track, this.blocks, this.trams, this.lamps, this.clocks, this.carText, this.motion, this.you, this.north, this.scaleBar, this.scaleText);
    this.diagram.el.append(this.cone, this.ticks, this.lines, this.coneEdge, this.nowLine, this.yourLine, this.dots, this.nowText, this.seenText, this.towerNow, this.towerSeen, this.axisText);
    this.root = h(
      'div',
      { class: 'measured-view', hidden: true },
      h('section', { class: 'measured', 'aria-label': 'Measured view' }, h('h2', { class: 'measured-h' }, 'Measured ', h('span', {}, 'your now, in your frame')), this.map.el, this.diagram.el),
      h('p', { class: 'seen-tag' }, 'Seen ', h('span', {}, 'the light reaching you now')),
    );
  }

  update(m: MeasuredModel, c: number) {
    this.drawMap(m);
    this.drawDiagram(m, c);
  }

  private reading(seconds: number, full: boolean) {
    const s = clockString(this.clockStart + seconds);
    return full ? s : s.slice(-7);
  }

  private drawMap(m: MeasuredModel) {
    const { w, h: ht } = this.map.size;
    if (!w) return;
    const k = w / (2 * MAP_HALF), y0 = ht * 0.75;
    const px = ([x, y]: MapPoint): [number, number] => [w / 2 + x * k, y0 - y * k];
    const lines: [number, number][][] = [];
    for (let g = -100; g <= 100; g += 20) lines.push([px([g, -100]), px([g, 100])], [px([-100, g]), px([100, g])]);
    set(this.grid, { d: path(lines, false) });
    set(this.blocks, { d: path(m.blocks.map((b) => b.map(px)), true) });
    set(this.track, { d: path([m.track.map(px)], false) });
    set(this.trams, { d: path(m.trams.map((t) => t.corners.map(px)), true) });

    while (this.lamps.childElementCount < m.lamps.length) this.lamps.append(svg('circle', { class: 'm-lamp' }));
    m.lamps.forEach((l, i) => {
      const [x, y] = px(l.at);
      // A sharp flash at each multiple of the blink period, fading as slow-surface.glsl fades it.
      const phase = (((l.tau / m.blink) % 1) + 1) % 1;
      const lit = Math.exp(-9 * phase);
      set(this.lamps.children[i], { cx: x, cy: y, r: 2.2 + 2.2 * lit, 'fill-opacity': 0.4 + 0.6 * lit });
    });

    // A label goes beside its point, on the first side where it stays inside the map and clear of the scale bar, the
    // north arrow, every clock and the labels already placed; otherwise it is left out. The top stays clear: far ahead.
    const spots = m.clocks.map((ck) => px(ck.at));
    const placed: Box[] = [[0, ht - 22, 44 + 20 * k, ht], [w - 26, ht - 34, w, ht], ...spots.map(([x, y]): Box => [x - 3, y - 3, x + 3, y + 3])];
    const place = (label: SVGTextElement, text: string, [x, y]: [number, number], sides: number[]) => {
      label.textContent = text;
      const width = text.length * CHAR;
      const base = Math.min(ht - 3, Math.max(11, y + 3.5));
      for (const side of sides) {
        const left = side > 0 ? x + 6 : x - 6 - width;
        const box: Box = [left, base - 11, left + width, base + 1];
        if (box[0] < 0 || box[2] > w || y < 0 || y > ht || !placed.every((b) => apart(box, b))) continue;
        placed.push(box);
        set(label, { x: left, y: base, display: 'inline' });
        return;
      }
      set(label, { display: 'none' });
    };
    m.clocks.forEach((ck, i) => {
      let mark = this.clockMarks.get(ck.id);
      if (!mark) {
        mark = { dot: svg('circle', { class: 'm-clock', r: 3 }), label: svg('text', { class: 'm-label', 'data-clock': ck.id }) };
        this.clocks.append(mark.dot, mark.label);
        this.clockMarks.set(ck.id, mark);
      }
      set(mark.dot, { cx: spots[i][0], cy: spots[i][1] });
    });
    // The tower first, as the clock to compare with the instruments, then the nearest.
    const order = m.clocks.map((ck, i) => ({ ck, at: spots[i] })).sort((a, b) => Number(b.ck.id === 'tower') - Number(a.ck.id === 'tower') || Math.hypot(...a.ck.at) - Math.hypot(...b.ck.at));
    for (const { ck, at } of order) place(this.clockMarks.get(ck.id)!.label, this.reading(ck.reads, ck.id === 'tower'), at, ck.id === 'tower' ? [1, -1] : [-1, 1]);
    const car = m.trams
      .map(({ corners: [a, , b], length }) => ({ length, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as MapPoint }))
      .sort((p, q) => Math.hypot(...p.mid) - Math.hypot(...q.mid))[0];
    if (car) place(this.carText, `${car.length.toFixed(2)} m`, px(car.mid), [1, -1]);

    this.you.setAttribute('transform', `translate(${w / 2} ${y0})`);
    const [mx, my] = px(m.motion ? [m.motion[0] * 30 * m.beta, m.motion[1] * 30 * m.beta] : [0, 0]);
    set(this.motion, { x1: w / 2, y1: y0, x2: mx, y2: my, display: m.motion ? 'inline' : 'none' });
    set(this.north, { transform: `translate(${w - 14} ${ht - 20}) rotate(${(Math.atan2(m.north[0], m.north[1]) * 180) / Math.PI})` });
    set(this.scaleBar, { d: `M10 ${ht - 10}h${20 * k}` });
    set(this.scaleText, { x: 14 + 20 * k, y: ht - 6 });
  }

  private drawDiagram(m: MeasuredModel, c: number) {
    const { w, h: ht } = this.diagram.size;
    if (!w) return;
    // Light cones at 45°: one metre across is one light-metre (1/c seconds) up.
    const k = w / (2 * DIAGRAM_HALF), y0 = ht * 0.2;
    const px = ([x, t]: DiagramPoint): [number, number] => [w / 2 + x * k, y0 - t * c * k];
    const deep = (ht - y0) / k;
    set(this.cone, { d: path([[px([0, 0]), px([-deep, -deep / c]), px([deep, -deep / c])]], true) });
    set(this.coneEdge, { d: path([[px([-deep, -deep / c]), px([0, 0]), px([deep, -deep / c])]], false) });
    set(this.nowLine, { x1: 0, y1: y0, x2: w, y2: y0 });
    set(this.yourLine, { x1: w / 2, y1: ht, x2: w / 2, y2: y0 });
    // Narrow diagrams keep only the names that tie them to the map and to the view.
    const wide = w > 220;
    this.nowText.textContent = wide ? 'your now · Measured' : 'Measured';
    this.seenText.textContent = wide ? 'light reaching you · Seen' : 'Seen';
    set(this.nowText, { x: 4, y: y0 - 5 });
    const nowBox: Box = [0, y0 - 14, 8 + this.nowText.textContent.length * CHAR, y0];
    // Along the cone's edge behind you, outside it: ahead is where the tower's readings go.
    const back = Math.min(deep, w / 2) * 0.9;
    set(this.seenText, { transform: `translate(${w / 2 - back * k} ${y0 + back * k}) rotate(-45)`, x: 4, y: -5 });

    while (this.lines.childElementCount < m.worldlines.length) this.lines.append(svg('path'));
    while (this.dots.childElementCount < 2 * m.worldlines.length) this.dots.append(svg('circle', { r: 2.6 }));
    m.worldlines.forEach((l, i) => {
      // Within 8 m of your line of motion a worldline shows in full; by 16 m it has faded out.
      const opacity = Math.min(1, Math.max(0, (16 - l.aside) / 8));
      set(this.lines.children[i], { d: path([l.points.map(px)], false), class: l.id === 'tram' ? 'd-tram' : l.id === 'tower' ? 'd-clock d-tower' : 'd-clock', opacity });
      const [nx, ny] = px(l.now), [sx, sy] = px(l.seen);
      set(this.dots.children[2 * i], { cx: nx, cy: ny, class: 'd-now-dot', opacity });
      set(this.dots.children[2 * i + 1], { cx: sx, cy: sy, class: 'd-seen-dot', opacity });
    });

    // The tower's two events: what it reads at your now, and what its light reaching you shows.
    const tower = m.worldlines.find((l) => l.id === 'tower');
    const towerClock = m.clocks.find((ck) => ck.id === 'tower');
    const shown = !!tower && !!towerClock && tower.aside < 8 && Math.abs(tower.now[0]) < DIAGRAM_HALF;
    for (const [text, at, reads] of [
      [this.towerNow, tower?.now, towerClock?.reads],
      [this.towerSeen, tower?.seen, towerClock?.seen],
    ] as const) {
      if (!shown || !at || reads === undefined) {
        set(text, { display: 'none' });
        continue;
      }
      const [x, y] = px(at);
      const label = this.reading(reads, false);
      const width = label.length * CHAR;
      const left = x + 6 + width <= w ? x + 6 : x - 6 - width;
      const free = left >= 0 && apart([left, y - 14, left + width, y], nowBox);
      set(text, { display: free ? 'inline' : 'none', x: left, y: y - 5 });
      text.textContent = label;
    }

    // A tick for each whole step of your time down the left edge.
    const key = `${w}x${ht}@${c}`;
    if (key !== this.ticksFor) {
      this.ticksFor = key;
      const step = niceStep(deep / c / 3);
      const marks: SVGElement[] = [];
      for (let t = step; t * c * k < ht - y0 - 4; t += step) {
        const y = y0 + t * c * k;
        marks.push(svg('text', { class: 'm-small', x: 4, y: y + 3 }, `−${formatSI(t, 2)} s`));
      }
      this.ticks.replaceChildren(...marks);
    }
    this.axisText.textContent = m.beta > 1e-3 ? 'along your motion →' : 'ahead of you →';
    set(this.axisText, { x: w - 4, y: ht - 5 });
  }
}

function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= x)!;
}
