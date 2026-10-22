// Keyboard + mouse (pointer lock) + touch (joystick and drag-to-look) folded into one input state.

export interface InputState {
  /** Desired movement in the camera's frame: x right, y up, z forward; each in [-1, 1]. */
  move: { x: number; y: number; z: number };
  sprint: boolean;
  yaw: number;
  pitch: number;
}

type KeyHandler = (code: string, key: string) => void;

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1],
  KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  Space: [0, 1, 0], KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0], KeyC: [0, -1, 0],
};
/** ← and → turn the view, so it can be steered without a mouse. Radians per second. */
const TURN_KEYS: Record<string, number> = { ArrowLeft: 1.8, ArrowRight: -1.8 };

/** Keys a focused control needs for itself: typing, a slider's arrows, Space or Enter on a switch or button. */
function ownedByControl(target: EventTarget | null, code: string) {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    if (target.type === 'range') return /^(Arrow|Home|End|Page)/.test(code);
    if (target.type === 'checkbox') return code === 'Space';
    return true;
  }
  return target instanceof HTMLButtonElement && (code === 'Space' || code === 'Enter');
}

export class Input {
  readonly state: InputState = { move: { x: 0, y: 0, z: 0 }, sprint: false, yaw: 0, pitch: 0 };
  private held = new Set<string>();
  private joy = { x: 0, y: 0 };
  private onKey: KeyHandler = () => {};
  /** Set once the visitor has walked or looked; clear it to watch for that again. */
  used = false;

  constructor(canvas: HTMLCanvasElement, private readonly touchLayer: HTMLElement) {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || ownedByControl(e.target, e.code)) return;
      if (e.code in MOVE_KEYS || e.code in TURN_KEYS || e.code.startsWith('Shift')) {
        this.held.add(e.code);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (!e.repeat) this.onKey(e.code, e.key);
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    canvas.addEventListener('click', () => {
      if (matchMedia('(pointer: fine)').matches && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    this.setupTouch();
  }

  setKeyHandler(fn: KeyHandler) {
    this.onKey = fn;
  }

  look(dx: number, dy: number) {
    this.used = true;
    this.state.yaw -= dx;
    this.state.pitch = Math.max(-1.5, Math.min(1.5, this.state.pitch - dy));
  }

  /** Refresh `move` from held keys and the joystick, and turn for held arrows. Call once per frame. */
  poll(dt: number) {
    let x = this.joy.x, y = 0, z = this.joy.y, turn = 0;
    for (const k of this.held) {
      const m = MOVE_KEYS[k];
      if (m) {
        x += m[0];
        y += m[1];
        z += m[2];
      }
      turn += TURN_KEYS[k] ?? 0;
    }
    if (turn) this.look(-turn * dt, 0);
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.state.move = { x: clamp(x), y: clamp(y), z: clamp(z) };
    if (x || y || z) this.used = true;
    this.state.sprint = this.held.has('ShiftLeft') || this.held.has('ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.92;
  }

  private setupTouch() {
    const stick = this.touchLayer.querySelector<HTMLElement>('[data-stick]')!;
    const knob = stick.querySelector<HTMLElement>('[data-knob]')!;
    let stickId: number | null = null;
    let lookId: number | null = null;
    let origin = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    const R = 56;
    this.touchLayer.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const left = e.clientX < window.innerWidth * 0.45;
      if (left && stickId === null) {
        stickId = e.pointerId;
        origin = { x: e.clientX, y: e.clientY };
        stick.style.left = `${e.clientX - 70}px`;
        stick.style.top = `${e.clientY - 70}px`;
        stick.dataset.active = 'true';
      } else if (lookId === null) {
        lookId = e.pointerId;
        last = { x: e.clientX, y: e.clientY };
      }
      this.touchLayer.setPointerCapture?.(e.pointerId);
    });
    this.touchLayer.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId === stickId) {
        let dx = e.clientX - origin.x, dy = e.clientY - origin.y;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx *= R / d;
          dy *= R / d;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.joy = { x: dx / R, y: -dy / R };
      } else if (e.pointerId === lookId) {
        this.look((e.clientX - last.x) * 0.006, (e.clientY - last.y) * 0.006);
        last = { x: e.clientX, y: e.clientY };
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === stickId) {
        stickId = null;
        this.joy = { x: 0, y: 0 };
        knob.style.transform = '';
        stick.dataset.active = 'false';
      }
      if (e.pointerId === lookId) lookId = null;
    };
    this.touchLayer.addEventListener('pointerup', end);
    this.touchLayer.addEventListener('pointercancel', end);
  }
}
