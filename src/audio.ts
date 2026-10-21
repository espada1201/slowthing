// Sonification: the worlds turn physical events into sound. Off until the visitor switches it on.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = false;

const STORE = 'slowlight-sound';
try {
  enabled = localStorage.getItem(STORE) === 'on';
} catch {
  /* storage blocked: start muted */
}

export function soundOn() {
  return enabled;
}

/** Must be called from a user gesture the first time, so the browser lets audio start. */
export function setSound(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(STORE, on ? 'on' : 'off');
  } catch {
    /* not remembered */
  }
  if (on) ensure();
  if (master && ctx) master.gain.setTargetAtTime(on ? 0.5 : 0, ctx.currentTime, 0.05);
}

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.5 : 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function voice(pan: number) {
  const c = ensure();
  if (!c || !master || !enabled) return null;
  const p = c.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(master);
  return { c, out: p, t: c.currentTime };
}

/** A bell: fundamental plus an inharmonic partial, exponential decay. */
export function chime(freq: number, gain: number, pan = 0) {
  const v = voice(pan);
  if (!v || freq < 20 || freq > 16000 || gain < 1e-3) return;
  for (const [mult, amp, decay] of [[1, 1, 1.2], [2.76, 0.35, 0.5], [5.4, 0.12, 0.25]]) {
    const o = v.c.createOscillator();
    const g = v.c.createGain();
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0, v.t);
    g.gain.linearRampToValueAtTime(gain * amp * 0.3, v.t + 0.004);
    g.gain.exponentialRampToValueAtTime(1e-4, v.t + decay);
    o.connect(g).connect(v.out);
    o.start(v.t);
    o.stop(v.t + decay + 0.05);
  }
}

/** A detector click: a few milliseconds of filtered noise, like a Geiger counter. */
export function click(gain = 1, pan = 0) {
  const v = voice(pan);
  if (!v) return;
  const n = Math.floor(v.c.sampleRate * 0.006);
  const buf = v.c.createBuffer(1, n, v.c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  const src = v.c.createBufferSource();
  src.buffer = buf;
  const hp = v.c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;
  const g = v.c.createGain();
  g.gain.value = 0.6 * gain;
  src.connect(hp).connect(g).connect(v.out);
  src.start(v.t);
}

/** A soft tick, for a distant clock's pulses. */
export function tick(freq = 1200, gain = 0.5, pan = 0) {
  const v = voice(pan);
  if (!v) return;
  const o = v.c.createOscillator();
  const g = v.c.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain * 0.25, v.t);
  g.gain.exponentialRampToValueAtTime(1e-4, v.t + 0.06);
  o.connect(g).connect(v.out);
  o.start(v.t);
  o.stop(v.t + 0.08);
}
