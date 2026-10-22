// Sky ruler: mark two points on the view and read the angle between the directions they look along, like the
// scale in a telescope's eyepiece. Marks are kept as sky directions, so they stay on what they mark when the view
// turns, and the angle is between the very rays the world's shader drew there (viewRay in worlds/shared.ts).

import * as THREE from 'three';
import { viewPoint, viewRay } from '../worlds/shared';
import type { View } from '../worlds/types';
import { h } from './dom';

/** A press this close to a mark (CSS px) picks the mark up instead of starting a new one. */
const GRAB = 24;
/** Radius of the ring drawn round a mark (CSS px); it is hollow, so the point marked stays in view. */
const RING = 7;

export interface Ruler {
  /** The layer over the view that takes taps, clicks and keys while the ruler is on. */
  readonly root: HTMLElement;
  toggle(on?: boolean): void;
  clear(): void;
  /** A Ruler button, shown pressed while the ruler is on. */
  button(cls: string, ...extra: Node[]): HTMLButtonElement;
  /** Put the marks back on their sky directions after the view has moved; call after every frame. */
  update(): void;
}

export function skyRuler(canvas: HTMLCanvasElement, view: () => View, onToggle: (on: boolean) => void): Ruler {
  const marks: THREE.Vector3[] = [];
  const buttons: HTMLButtonElement[] = [];
  let on = false;
  /** The pointer moving a mark, and where on the mark it took hold (so a finger beside a mark can nudge it). */
  let drag: { pointer: number; mark: number; dx: number; dy: number } | null = null;
  /** Where Enter puts a mark; the arrow keys move it (page px). */
  const cursor = { x: 0, y: 0 };

  const svg = (tag: string, cls: string) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    el.setAttribute('class', cls);
    return el;
  };
  const line = svg('line', 'ruler-line');
  const dots = [svg('path', 'ruler-mark'), svg('path', 'ruler-mark')];
  // A ring, and a dot (a zero-length stroke with round caps) at the very point.
  for (const d of dots) d.setAttribute('d', `M${-RING} 0a${RING} ${RING} 0 1 0 ${2 * RING} 0a${RING} ${RING} 0 1 0 ${-2 * RING} 0M0 0h0`);
  const cross = svg('path', 'ruler-cursor');
  cross.setAttribute('d', 'M-10 0h7M3 0h7M0-10v7M0 3v7');
  const drawing = svg('svg', 'ruler-marks');
  drawing.setAttribute('aria-hidden', 'true');
  drawing.append(line, ...dots, cross);
  const angle = h('output', { class: 'ruler-angle', role: 'status' });
  const root = h(
    'div',
    { class: 'ruler', tabindex: 0, role: 'application', hidden: true, 'aria-label': 'Sky ruler: tap or click two points to measure the angle between them, or move the cross with the arrow keys and press Enter at each point' },
    drawing,
    angle,
  );

  const rect = () => canvas.getBoundingClientRect();
  /** The sky direction drawn at page point (x, y). */
  const rayAt = (x: number, y: number) => {
    const r = rect();
    return viewRay(view(), (x - r.left) / r.width, 1 - (y - r.top) / r.height);
  };
  /** The page point where direction d is drawn, or null if it is behind you. */
  const pointOf = (d: THREE.Vector3) => {
    const p = viewPoint(view(), d);
    const r = rect();
    return p && { x: r.left + p.x * r.width, y: r.top + (1 - p.y) * r.height };
  };
  /** A new mark at page point (x, y); a third one starts a new measurement. */
  const place = (x: number, y: number) => {
    if (marks.length === 2) marks.length = 0;
    return marks.push(rayAt(x, y)) - 1;
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    let mark = -1, nearest = GRAB;
    marks.forEach((d, i) => {
      const p = pointOf(d);
      const dist = p ? Math.hypot(p.x - e.clientX, p.y - e.clientY) : Infinity;
      if (dist < nearest) [mark, nearest] = [i, dist];
    });
    const held = mark >= 0 ? pointOf(marks[mark])! : { x: e.clientX, y: e.clientY };
    if (mark < 0) mark = place(e.clientX, e.clientY);
    drag = { pointer: e.pointerId, mark, dx: e.clientX - held.x, dy: e.clientY - held.y };
    root.setPointerCapture(e.pointerId);
    update();
  });
  root.addEventListener('pointermove', (e) => {
    if (e.pointerId !== drag?.pointer) return;
    marks[drag.mark] = rayAt(e.clientX - drag.dx, e.clientY - drag.dy);
    update();
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId === drag?.pointer) drag = null;
  };
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  const steps: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  root.addEventListener('keydown', (e) => {
    const step = steps[e.code];
    if (step) {
      const r = rect(), n = e.shiftKey ? 10 : 1;
      cursor.x = Math.min(r.right, Math.max(r.left, cursor.x + n * step[0]));
      cursor.y = Math.min(r.bottom, Math.max(r.top, cursor.y + n * step[1]));
    } else if (e.code === 'Enter' || e.code === 'Space') place(cursor.x, cursor.y);
    else return;
    // While the ruler has focus these keys are its own: they would otherwise turn the view or fly you up.
    e.preventDefault();
    e.stopPropagation();
    update();
  });

  function update() {
    if (!on) return;
    const box = root.getBoundingClientRect();
    const [a, b] = marks.map((d) => {
      const p = pointOf(d);
      return p && { x: p.x - box.left, y: p.y - box.top };
    });
    for (const [i, p] of [a, b].entries()) {
      dots[i].style.display = p ? '' : 'none';
      if (p) dots[i].setAttribute('transform', `translate(${p.x} ${p.y})`);
    }
    cross.setAttribute('transform', `translate(${cursor.x - box.left} ${cursor.y - box.top})`);
    const text = marks.length === 2 ? `${THREE.MathUtils.radToDeg(marks[0].angleTo(marks[1])).toFixed(2)}°` : '';
    // Rewriting an unchanged reading every frame would have screen readers announce it every frame.
    if (angle.value !== text) angle.value = text;
    angle.hidden = !(text && a && b);
    line.style.display = a && b ? '' : 'none';
    if (!(a && b)) return;
    // The line runs between the rings, not across the points they mark.
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const [ux, uy] = d > 0 ? [(b.x - a.x) / d, (b.y - a.y) / d] : [1, 0];
    const end = Math.min(RING, d / 2);
    for (const [k, v] of Object.entries({ x1: a.x + end * ux, y1: a.y + end * uy, x2: b.x - end * ux, y2: b.y - end * uy })) line.setAttribute(k, String(v));
    // The reading sits just past the second ring, on the far side from the first, whichever way the line points.
    const [sx, sy] = [ux, uy].map((c) => c / Math.max(Math.abs(ux), Math.abs(uy)));
    angle.style.transform = `translate(${b.x + (RING + 5) * ux}px, ${b.y + (RING + 5) * uy}px) translate(${50 * (sx - 1)}%, ${50 * (sy - 1)}%)`;
  }

  function toggle(next = !on) {
    on = next;
    root.hidden = !on;
    drag = null;
    for (const b of buttons) b.setAttribute('aria-pressed', String(on));
    onToggle(on);
    if (!on) return;
    // Aim with a visible pointer, not a locked one; the keyboard's cross starts in the middle of the view.
    if (document.pointerLockElement) document.exitPointerLock();
    const r = rect();
    cursor.x = r.left + r.width / 2;
    cursor.y = r.top + r.height / 2;
    root.focus({ preventScroll: true });
    update();
  }

  return {
    root,
    toggle,
    clear() {
      marks.length = 0;
      drag = null;
      update();
    },
    button(cls, ...extra) {
      const b = h('button', { class: cls, 'data-ruler': true, 'aria-pressed': String(on), title: 'Measure the angle between two points of the sky', onclick: () => toggle() }, 'Ruler', ...extra);
      buttons.push(b);
      return b;
    },
    update,
  };
}
