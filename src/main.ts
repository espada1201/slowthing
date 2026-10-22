import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/style.css';
import * as THREE from 'three';
import { restoreSound } from './audio';
import { AutoQuality } from './autoQuality';
import { type Constants, REAL } from './constants';
import { Input } from './input';
import { type Setup, applySetup, readLink, setupOf, writeLink } from './kit/link';
import { WORLD_CARDS } from './ui/dom';
import { proofsView } from './ui/proofsView';
import { type Ruler, skyRuler } from './ui/ruler';
import { type Chrome, titleScreen, worldChrome } from './ui/ui';
import { WORLDS, isWorldId } from './worlds';
import type { Authored, Quality, QualitySetting, World, WorldContext } from './worlds/types';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;
const params = new URLSearchParams(location.search);

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
/** Why the last world failed to start; the title screen says so, and the other worlds still open. */
let worldError: string | null = null;
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
restoreSound();

let world: World | null = null;
let chrome: Chrome | null = null;
let ruler: Ruler | null = null;
let tourIndex = 0;
/** The dials as the current tour stop set them, so the card can say when the visitor has turned them since. */
let stopDials: Constants | null = null;
let frames = 0;
/** Under reduced motion a world holds still until the visitor taps, clicks or presses a key: on arrival, and at each tour stop that waits for Start. */
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
  ui.replaceChildren(titleScreen(enter, showProofs, setting, setQuality, startupError ?? worldError));
  history.replaceState(null, '', location.pathname + (params.has('quality') ? `?quality=${setting}` : ''));
  // Coming back from a world, keep keyboard users on the plates; on first load, nothing looks pre-selected.
  if (returning) document.querySelector<HTMLButtonElement>('.plate')?.focus({ preventScroll: true });
}

function showProofs() {
  document.body.dataset.mode = 'title';
  ui.replaceChildren(proofsView(startupError ? null : renderer, showTitle));
  history.replaceState(null, '', '?proofs');
}

async function enter(id: string) {
  if (!renderer || startupError || !isWorldId(id)) return;
  document.body.dataset.mode = 'loading';
  ui.replaceChildren(Object.assign(document.createElement('div'), { className: 'loading', role: 'status', textContent: 'Tuning the constants…' }));
  let lesson: Authored;
  try {
    const { lesson: authored, World: W } = await WORLDS[id]();
    lesson = authored;
    await new Promise((r) => requestAnimationFrame(r));
    world?.dispose();
    startAuto(id, autoStart);
    resize();
    world = new W(ctx());
  } catch (err) {
    console.warn(err);
    world = null;
    worldError = `This world failed to start: ${(err as Error).message.replace(/\.?$/, '.')} Reload the page to try again.`;
    showTitle();
    return;
  }
  worldError = null;
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
      for (const t of w.toggles) if (t.effect) t.value = true;
      chrome?.syncDials(constants);
      chrome?.syncToggles();
      chrome?.flash('Real universe: every constant at its measured value, and every effect back on.');
    },
    onPreset: () => {
      Object.assign(constants, REAL, w.preset);
      chrome?.syncDials(constants);
    },
    onShare: () => {
      const url = new URL(writeLink(lesson, setupOf(w, tourIndex, constants)), location.href).href;
      history.replaceState(null, '', url);
      navigator.clipboard?.writeText(url).then(
        () => chrome?.flash('Link to this universe copied'),
        () => chrome?.flash('Copy the address bar to share this universe'),
      ) ?? chrome?.flash('Copy the address bar to share this universe');
    },
    onAction: (a) => w.runAction(a, ctx()),
    onTour: goTour,
    onStopDials: () => {
      if (stopDials) Object.assign(constants, stopDials);
      chrome?.syncDials(constants);
    },
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
  input.setKeyHandler((code, key) => {
    if (code === 'KeyN' || code === 'KeyB') {
      const next = tourIndex + (code === 'KeyN' ? 1 : -1);
      // Past either end the Back and Next buttons are disabled, and the keys do nothing either.
      if (next >= 0 && next < w.tour.length) goTour(next);
    } else if (code === 'KeyR') ruler?.toggle();
    else if (key === '?') chrome?.toggleHelp();
    else if (code === 'Escape') {
      chrome?.closeHelp();
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
  const shared = linkUnread ? readLink(lesson, params) : null;
  linkUnread = false;
  if (shared) {
    goTour(shared.stop, true, shared);
    history.replaceState(null, '', `${writeLink(lesson, shared)}${params.has('quality') ? `&quality=${setting}` : ''}`);
  }
}

/** The page's own address is a link into the first world entered, and only that one. */
let linkUnread = true;

/** Show stop i. A setup from a link then replaces the stop's own switches and dials, before its action runs. */
function goTour(i: number, initial = false, shared: Setup | null = null) {
  if (!world || !chrome) return;
  const stop = world.tour[Math.max(0, Math.min(world.tour.length - 1, i))];
  tourIndex = world.tour.indexOf(stop);
  if (stop.constants) Object.assign(constants, stop.constants);
  if (stop.toggles) for (const t of world.toggles) if (t.id in stop.toggles) t.value = stop.toggles[t.id];
  // The stop's own dials, before a link turns them, so the card can say when they differ.
  stopDials = { ...constants };
  if (shared) applySetup(world, constants, shared);
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
      for (const id of calm) world.runAction(id, ctx());
      // What the last stop set going and no calm action ends, like World II's roll, holds too.
      still = true;
    }
  }
  // Marks made at the last stop would point at nothing in particular here.
  ruler?.clear();
  chrome.setTour(tourIndex, pending !== null);
  chrome.syncDials(constants);
  chrome.syncToggles();
  // The instruments show the new stop on the next frame, even one in which the world holds still.
  hudTimer = 0;
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
  if (input.used) chrome?.controlsUsed();
  world.frame(dt, input.state, ctx());
  ruler?.update();
  frames++;
  hudTimer -= dt;
  if (hudTimer <= 0 && chrome) {
    hudTimer = 0.1;
    chrome.setReadouts(world.readouts(ctx()), still ? 'Reduced motion: nothing moves until you tap or press a key.' : world.status(ctx()));
    chrome.showReticle(world.warping?.(ctx()) ?? false);
    chrome.showTurned(!!stopDials && world.dials.some((k) => constants[k] !== stopDials![k]));
  }
}

resize();
requestAnimationFrame(loop);
const initial = params.get('world');
if (isWorldId(initial) && !startupError) void enter(initial);
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
  probe: () => world?.probe?.(ctx()),
  get setup() {
    return world ? setupOf(world, tourIndex, constants) : null;
  },
};
