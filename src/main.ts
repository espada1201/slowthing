import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/style.css';
import * as THREE from 'three';
import { AutoQuality } from './autoQuality';
import { type ConstantKey, type Constants, DIALS, REAL } from './constants';
import { Input } from './input';
import { proofsView } from './ui/proofsView';
import { type Ruler, skyRuler } from './ui/ruler';
import { type Chrome, WORLD_CARDS, titleScreen, worldChrome } from './ui/ui';
import type { Quality, QualitySetting, World, WorldContext } from './worlds/types';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;
const params = new URLSearchParams(location.search);

const loaders: Record<string, () => Promise<new (ctx: WorldContext) => World>> = {
  'slow-light': () => import('./worlds/slowLight').then((m) => m.SlowLightWorld),
  'big-hbar': () => import('./worlds/bigHbar').then((m) => m.BigHbarWorld),
  'big-g': () => import('./worlds/bigG').then((m) => m.BigGWorld),
};

const storedQuality = (() => {
  try {
    return localStorage.getItem('slowlight-quality');
  } catch {
    return null;
  }
})();
let setting = (params.get('quality') ?? storedQuality ?? 'auto') as QualitySetting;
if (!['auto', 'low', 'medium', 'high'].includes(setting)) setting = 'auto';
/** Where Auto starts in each world: low on phones, high on Apple Silicon (it handles it comfortably), else medium. */
let autoStart: Quality = matchMedia('(pointer: coarse)').matches ? 'low' : 'medium';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const constants: Constants = { ...REAL };
let renderer: THREE.WebGLRenderer | null = null;
let startupError: string | null = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('e2e') });
  if (!renderer.extensions.has('EXT_color_buffer_float')) startupError = 'This browser cannot render to floating-point textures (EXT_color_buffer_float), which the physics needs. Try an up-to-date Chrome, Safari or Firefox.';
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/Apple M\d/.test(gpu) && autoStart === 'medium') autoStart = 'high';
} catch {
  startupError = 'WebGL2 is not available here, so the worlds cannot be drawn. Try an up-to-date Chrome, Safari or Firefox, with hardware acceleration on.';
}
// three.js asks the browser to restore a lost context and rebuilds itself; the visitor only needs telling.
const gpuReset = document.querySelector<HTMLElement>('#gpu-reset')!;
let gpuTimer = 0;
canvas.addEventListener('webglcontextlost', () => {
  gpuReset.textContent = 'The graphics card was reset. Restoring the view…';
  gpuTimer = window.setTimeout(() => (gpuReset.textContent = 'The graphics card was reset and the view did not come back. Reload the page to bring the world back.'), 5000);
});
canvas.addEventListener('webglcontextrestored', () => {
  clearTimeout(gpuTimer);
  gpuReset.textContent = '';
});
const input = new Input(canvas, document.querySelector('#touch')!);

let world: World | null = null;
let chrome: Chrome | null = null;
let ruler: Ruler | null = null;
let tourIndex = 0;
let frames = 0;
/** Under reduced motion a world holds still until the visitor first taps, clicks or presses a key in it. */
let still = false;
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => (still = false), true);
/** The action of the current tour stop, waiting for its Start button under reduced motion. */
let pending: string | null = null;
/** Presets Auto found too slow, per world, for the rest of the visit. */
const tooSlow: Record<string, Set<Quality>> = {};
let auto = new AutoQuality(setting === 'auto' ? autoStart : setting, setting === 'auto');
let quality = auto.preset;

function pixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return (quality === 'low' ? Math.min(dpr, 1) * 0.7 : quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2)) * auto.scale;
}

/** Let Auto quality judge the frame and apply what it changes. Off in end-to-end runs, which compare pixels. */
function adapt(ms: number) {
  if (params.has('e2e')) return;
  const change = auto.frame(ms);
  if (change === 'preset') {
    quality = auto.preset;
    world?.setQuality(quality, ctx());
    chrome?.showQuality(quality);
  }
  if (change) resize();
}

function resize() {
  if (!renderer) return;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);

const ctx = (): WorldContext => ({ renderer: renderer!, constants, quality });

/** A fresh Auto quality for the world: on Auto it starts from `start`, below any preset already too slow there. */
function startAuto(id: string, start: Quality) {
  auto = new AutoQuality(setting === 'auto' ? start : setting, setting === 'auto', (tooSlow[id] ??= new Set()));
  quality = auto.preset;
}

function setQuality(q: QualitySetting) {
  setting = q;
  try {
    localStorage.setItem('slowlight-quality', q);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
  if (!world) return;
  startAuto(world.id, quality);
  resize();
  world.setQuality(quality, ctx());
  chrome?.showQuality(auto.auto ? quality : null);
}

function showTitle() {
  const returning = world !== null;
  world?.dispose();
  world = null;
  chrome = null;
  ruler = null;
  document.body.dataset.mode = 'title';
  if (document.pointerLockElement) document.exitPointerLock();
  ui.replaceChildren(titleScreen(enter, showProofs, setting, setQuality, startupError));
  history.replaceState(null, '', location.pathname + (params.has('quality') ? `?quality=${setting}` : ''));
  // Coming back from a world, keep keyboard users on the plates; on first load, nothing looks pre-selected.
  if (returning) document.querySelector<HTMLButtonElement>('.plate')?.focus({ preventScroll: true });
}

function showProofs() {
  world?.dispose();
  world = null;
  chrome = null;
  ruler = null;
  document.body.dataset.mode = 'title';
  ui.replaceChildren(proofsView(startupError ? null : renderer, showTitle));
  history.replaceState(null, '', '?proofs');
}

async function enter(id: string) {
  if (!renderer || startupError) return;
  document.body.dataset.mode = 'loading';
  ui.replaceChildren(Object.assign(document.createElement('div'), { className: 'loading', role: 'status', textContent: 'Tuning the constants…' }));
  try {
    const W = await loaders[id]();
    await new Promise((r) => requestAnimationFrame(r));
    world?.dispose();
    startAuto(id, autoStart);
    resize();
    world = new W(ctx());
  } catch (err) {
    console.warn(err);
    startupError = `This world failed to start: ${(err as Error).message}`;
    showTitle();
    return;
  }
  const w = world;
  const card = WORLD_CARDS.find((c) => c.id === id)!;
  Object.assign(constants, REAL, w.preset);
  const view = w.view?.bind(w);
  ruler = view ? skyRuler(canvas, view, (on) => on && chrome?.flash('Ruler: tap or click two points to measure the angle between them')) : null;
  chrome = worldChrome(w, card, constants, {
    quality: setting,
    onBack: showTitle,
    onDial: (k, v) => {
      constants[k] = v;
      chrome?.syncDials(constants);
    },
    onReal: () => {
      Object.assign(constants, REAL);
      chrome?.syncDials(constants);
      chrome?.flash('Real universe: every constant at its measured value');
    },
    onPreset: () => {
      Object.assign(constants, REAL, w.preset);
      chrome?.syncDials(constants);
    },
    onShare: () => {
      const url = shareUrl(id);
      history.replaceState(null, '', url);
      navigator.clipboard?.writeText(url).then(
        () => chrome?.flash('Link to this universe copied'),
        () => chrome?.flash('Copy the address bar to share this universe'),
      ) ?? chrome?.flash('Copy the address bar to share this universe');
    },
    onAction: (a) => w.runAction(a, ctx()),
    onTour: goTour,
    onStart: () => {
      if (pending) w.runAction(pending, ctx());
      pending = null;
    },
    onQuality: setQuality,
    ruler,
  });
  document.body.dataset.mode = 'world';
  ui.replaceChildren(chrome.root);
  chrome.syncDials(constants);
  input.setKeyHandler((code) => {
    if (code === 'KeyN') goTour(tourIndex + 1);
    else if (code === 'KeyB') goTour(tourIndex - 1);
    else if (code === 'KeyR') ruler?.toggle();
    else if (code === 'Escape') {
      document.querySelector<HTMLElement>('.help')?.setAttribute('hidden', '');
      ruler?.toggle(false);
    }
    const a = w.actions.find((x) => x.key === code);
    if (a) w.runAction(a.id, ctx());
  });
  history.replaceState(null, '', `?world=${id}${params.has('quality') ? `&quality=${setting}` : ''}`);
  chrome.showQuality(auto.auto ? quality : null);
  still = reduceMotion.matches;
  hudTimer = 0;
  goTour(0, true);
  if (pendingShare && params.get('world') === id) {
    for (const k of w.dials) if (pendingShare[k] !== undefined) constants[k] = pendingShare[k];
    chrome.syncDials(constants);
  }
  pendingShare = null;
}

/** Dial values carried in the URL (?c=…&hbar=…&G=…), clamped to each dial's range. */
function sharedConstants(): Partial<Constants> {
  const out: Partial<Constants> = {};
  for (const k of Object.keys(DIALS) as ConstantKey[]) {
    const v = Number(params.get(k));
    if (params.has(k) && Number.isFinite(v) && v > 0) out[k] = Math.min(DIALS[k].max, Math.max(DIALS[k].min, v));
  }
  return out;
}

let pendingShare: Partial<Constants> | null = sharedConstants();

function shareUrl(id: string) {
  const q = new URLSearchParams({ world: id });
  for (const k of world?.dials ?? []) q.set(k, constants[k].toPrecision(4));
  return `${location.origin}${location.pathname}?${q}`;
}

function goTour(i: number, initial = false) {
  if (!world || !chrome) return;
  const stop = world.tour[Math.max(0, Math.min(world.tour.length - 1, i))];
  tourIndex = world.tour.indexOf(stop);
  if (stop.constants) Object.assign(constants, stop.constants);
  if (stop.toggles) for (const t of world.toggles) if (t.id in stop.toggles) t.value = stop.toggles[t.id];
  const pose = stop.pose ?? (initial ? world.start : undefined);
  if (pose) {
    world.setPose(pose);
    input.state.yaw = pose.yaw;
    input.state.pitch = pose.pitch;
  }
  pending = null;
  if (stop.action) {
    const calm = world.actions.filter((a) => a.calm).map((a) => a.id);
    if (!reduceMotion.matches || calm.includes(stop.action)) world.runAction(stop.action, ctx());
    else {
      pending = stop.action;
      // shortcut: World II has no calm action, so a roll still going from the previous stop runs on until Start; add one when that matters.
      for (const id of calm) world.runAction(id, ctx());
    }
  }
  // Marks made at the last stop would point at nothing in particular here.
  ruler?.clear();
  chrome.setTour(tourIndex, pending !== null);
  chrome.syncDials(constants);
  chrome.syncToggles();
}

let last = performance.now();
let hudTimer = 0;
/** End-to-end tests freeze time to compare a switch on and off on the very same moment, or step it at a fixed rate. */
let paused = false;
let step = 0;
/** The first frame after the tab was hidden spans the whole absence, which says nothing about speed. */
let resumed = false;
document.addEventListener('visibilitychange', () => (resumed = true));
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = paused ? step : still ? 0 : Math.min(0.05, (now - last) / 1000);
  step = 0;
  const ms = now - last;
  last = now;
  if (!world || !renderer) return;
  // Nor do frames while the context is lost, which draw nothing.
  if (!resumed && !renderer.getContext().isContextLost()) adapt(ms);
  resumed = false;
  input.poll(dt);
  world.frame(dt, input.state, ctx());
  ruler?.update();
  frames++;
  hudTimer -= dt;
  if (hudTimer <= 0 && chrome) {
    hudTimer = 0.1;
    chrome.setReadouts(world.readouts(ctx()), still ? 'Reduced motion: nothing moves until you tap or press a key.' : world.status(ctx()));
    chrome.showReticle(world.warping?.(ctx()) ?? false);
  }
}

resize();
requestAnimationFrame(loop);
const initial = params.get('world');
if (initial && initial in loaders && !startupError) void enter(initial);
else if (params.has('proofs')) showProofs();
else showTitle();

// Probe for the end-to-end tests: read-only, apart from freezing and stepping time.
(window as unknown as { slowlight: object }).slowlight = {
  pause(on: boolean) {
    paused = on;
  },
  /** While paused, run the next frame dt seconds on. */
  step(dt: number) {
    step = dt;
  },
  get world() {
    return world?.id ?? null;
  },
  get frames() {
    return frames;
  },
  get constants() {
    return { ...constants };
  },
  get tour() {
    return tourIndex;
  },
  readouts: () => (world ? world.readouts(ctx()) : []),
  status: () => (world ? world.status(ctx()) : ''),
};
