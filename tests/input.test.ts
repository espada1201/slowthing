import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from '../src/input';

/** A node-side stand-in for the page: just the event targets Input listens on. */
let win: EventTarget;
let doc: EventTarget & { pointerLockElement: unknown; documentElement: { classList: { add(c: string): void; remove(c: string): void; has: Set<string> } } };
let canvas: EventTarget & { requestPointerLock: () => Promise<void> };
let layer: EventTarget & { querySelector: () => unknown };

const pointer = (type: string, x: number, y: number) => Object.assign(new Event(type), { pointerType: 'mouse', button: 0, clientX: x, clientY: y, pointerId: 1 });

beforeEach(() => {
  const classes = new Set<string>();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { pointerLockElement: null as unknown, documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), has: classes } } });
  canvas = Object.assign(new EventTarget(), { requestPointerLock: () => Promise.resolve() });
  const knob = { style: {}, dataset: {} };
  layer = Object.assign(new EventTarget(), { querySelector: () => Object.assign({ querySelector: () => knob, style: {}, dataset: {} }) });
  vi.stubGlobal('window', Object.assign(win, { innerWidth: 1000 }));
  vi.stubGlobal('document', doc);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => vi.unstubAllGlobals());

const make = () => new Input(canvas as unknown as HTMLCanvasElement, layer as unknown as HTMLElement);

/** Press on the canvas, drag 100 px right, release; the yaw it turned. */
function drag(input: Input) {
  const before = input.state.yaw;
  canvas.dispatchEvent(pointer('pointerdown', 100, 100));
  win.dispatchEvent(pointer('pointermove', 200, 100));
  win.dispatchEvent(pointer('pointerup', 200, 100));
  return input.state.yaw - before;
}

describe('dragging to look around, where the pointer cannot be locked', () => {
  it('does nothing while the browser will lock the pointer on a click', () => {
    expect(drag(make())).toBe(0);
  });

  it('turns the view after the browser refuses the lock', () => {
    const input = make();
    doc.dispatchEvent(new Event('pointerlockerror'));
    expect(drag(input)).not.toBe(0);
  });

  it('stops once a lock has been granted, when the refusal was only a passing one', () => {
    const input = make();
    doc.dispatchEvent(new Event('pointerlockerror'));
    expect(drag(input)).not.toBe(0);
    doc.pointerLockElement = canvas;
    doc.dispatchEvent(new Event('pointerlockchange'));
    // Locked: the mouse looks by its movement, and a drag must not turn the view a second time.
    expect(drag(input)).toBe(0);
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event('pointerlockchange'));
    expect(drag(input), 'Esc gives the mouse back, and a click locks it again').toBe(0);
  });

  it('turns the view with no pointer lock at all (iPad Safari)', () => {
    canvas.requestPointerLock = undefined as never;
    expect(drag(make())).not.toBe(0);
  });

  it('keeps the page from selecting text under the drag, and lets it select again afterwards', () => {
    const input = make();
    doc.dispatchEvent(new Event('pointerlockerror'));
    canvas.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(doc.documentElement.classList.has.has('drag-look')).toBe(true);
    win.dispatchEvent(pointer('pointerup', 100, 100));
    expect(doc.documentElement.classList.has.has('drag-look')).toBe(false);
    expect(input.state.yaw).toBe(0);
  });
});
