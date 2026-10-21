// Keyboard + mouse (pointer lock) + touch (joystick and drag-to-look) folded into one input state.

export interface InputState {
  /** Desired movement in the camera's frame: x right, y up, z forward; each in [-1, 1]. */
  move: { x: number; y: number; z: number };
  sprint: boolean;
  yaw: number;
  pitch: number;
}

type KeyHandler = (key: string) => void;

const MOVE_KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1],
  KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  Space: [0, 1, 0], KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0], KeyC: [0, -1, 0],
};

export class Input {
  readonly state: InputState = { move: { x: 0, y: 0, z: 0 }, sprint: false, yaw: 0, pitch: 0 };
  private held = new Set<string>();
  private joy = { x: 0, y: 0 };
  private onKey: KeyHandler = () => {};

  constructor(canvas: HTMLCanvasElement, private readonly touchLayer: HTMLElement) {
    const isField = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
    this.listen(window, 'keydown', (e: KeyboardEvent) => {
      if (isField(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code in MOVE_KEYS || e.code.startsWith('Shift')) {
        this.held.add(e.code);
        if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      }
      if (!e.repeat) this.onKey(e.code);
    });
    this.listen(window, 'keyup', (e: KeyboardEvent) => this.held.delete(e.code));
    this.listen(window, 'blur', () => this.held.clear());
    this.listen(canvas, 'click', () => {
      if (matchMedia('(pointer: fine)').matches && document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    });
    this.listen(document, 'mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) this.look(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    this.setupTouch();
  }

  setKeyHandler(fn: KeyHandler) {
    this.onKey = fn;
  }

  look(dx: number, dy: number) {
    this.state.yaw -= dx;
    this.state.pitch = Math.max(-1.5, Math.min(1.5, this.state.pitch - dy));
  }

  /** Refresh `move` from held keys and the joystick. Call once per frame. */
  poll() {
    let x = this.joy.x, y = 0, z = this.joy.y;
    for (const k of this.held) {
      const m = MOVE_KEYS[k];
      if (m) {
        x += m[0];
        y += m[1];
        z += m[2];
      }
    }
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.state.move = { x: clamp(x), y: clamp(y), z: clamp(z) };
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
    this.listen(this.touchLayer, 'pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || (e.target as HTMLElement).closest('button')) return;
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
    this.listen(this.touchLayer, 'pointermove', (e: PointerEvent) => {
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
    this.listen(this.touchLayer, 'pointerup', end);
    this.listen(this.touchLayer, 'pointercancel', end);
  }

  private listen<K extends EventTarget>(target: K, type: string, fn: (e: any) => void) {
    target.addEventListener(type, fn);
  }
}
