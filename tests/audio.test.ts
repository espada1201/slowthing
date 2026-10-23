import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Just enough of an AudioContext for audio.ts: a state the test can change, and a resume() that obeys it. */
class FakeContext {
  static all: FakeContext[] = [];
  state: 'suspended' | 'running' | 'interrupted' = 'suspended';
  onstatechange: (() => void) | null = null;
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  resumes = 0;
  constructor() {
    FakeContext.all.push(this);
  }
  resume() {
    this.resumes++;
    // A real browser only resumes inside a gesture; the test decides with `allowResume`.
    if (FakeContext.allowResume) this.set('running');
    return Promise.resolve();
  }
  static allowResume = true;
  set(state: FakeContext['state']) {
    this.state = state;
    this.onstatechange?.();
  }
  createGain() {
    return { gain: { value: 0, setTargetAtTime() {} }, connect: (n: unknown) => n };
  }
  createDynamicsCompressor() {
    return { connect: (n: unknown) => n };
  }
}

let target: EventTarget;

beforeEach(() => {
  vi.resetModules();
  FakeContext.all = [];
  FakeContext.allowResume = true;
  target = new EventTarget();
  const store = new Map<string, string>([['slowlight-sound', 'on']]);
  vi.stubGlobal('window', Object.assign(target, { AudioContext: FakeContext }));
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
});
afterEach(() => vi.unstubAllGlobals());

describe('sound after Safari interrupts the audio context', () => {
  it('starts on the first gesture when sound was left on', async () => {
    const { restoreSound } = await import('../src/audio');
    restoreSound();
    expect(FakeContext.all.length).toBe(0);
    target.dispatchEvent(new Event('click'));
    expect(FakeContext.all[0].state).toBe('running');
  });

  it('comes back on the next gesture after a call or an app switch interrupts it', async () => {
    const { restoreSound } = await import('../src/audio');
    restoreSound();
    target.dispatchEvent(new Event('click'));
    const ctx = FakeContext.all[0];
    expect(ctx.state).toBe('running');

    FakeContext.allowResume = false; // not inside a gesture: the browser refuses
    ctx.set('interrupted');
    expect(ctx.state).toBe('interrupted');

    FakeContext.allowResume = true;
    target.dispatchEvent(new Event('touchend'));
    expect(ctx.state).toBe('running');
    expect(FakeContext.all.length).toBe(1);
  });

  it('tries to resume by itself when the context leaves running, without waiting for a gesture', async () => {
    const { restoreSound } = await import('../src/audio');
    restoreSound();
    target.dispatchEvent(new Event('click'));
    const ctx = FakeContext.all[0];
    ctx.set('interrupted');
    expect(ctx.state).toBe('running');
  });

  it('leaves a muted page alone', async () => {
    localStorage.setItem('slowlight-sound', 'off');
    const { restoreSound } = await import('../src/audio');
    restoreSound();
    target.dispatchEvent(new Event('click'));
    expect(FakeContext.all.length).toBe(0);
  });
});
