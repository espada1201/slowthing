import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/style.css';
import * as THREE from 'three';
import { type ConstantKey, type Constants, DIALS, REAL } from './constants';
import { Input } from './input';
import { type Chrome, WORLD_CARDS, titleScreen, worldChrome } from './ui/ui';
import type { Quality, World, WorldContext } from './worlds/types';

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
let quality: Quality = (params.get('quality') ?? storedQuality ?? (matchMedia('(pointer: coarse)').matches ? 'low' : 'medium')) as Quality;
if (!['low', 'medium', 'high'].includes(quality)) quality = 'medium';

const constants: Constants = { ...REAL };
let renderer: THREE.WebGLRenderer | null = null;
let startupError: string | null = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('e2e') });
  if (!renderer.extensions.has('EXT_color_buffer_float')) startupError = 'This browser cannot render to floating-point textures (EXT_color_buffer_float), which the physics needs. Try an up-to-date Chrome, Safari or Firefox.';
} catch {
  startupError = 'WebGL2 is not available here, so the worlds cannot be drawn. Try an up-to-date Chrome, Safari or Firefox, with hardware acceleration on.';
}
const input = new Input(canvas, document.querySelector('#touch')!);

let world: World | null = null;
let chrome: Chrome | null = null;
let tourIndex = 0;
let frames = 0;

function pixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return quality === 'low' ? Math.min(dpr, 1) * 0.7 : quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
}

function resize() {
  if (!renderer) return;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', resize);

const ctx = (): WorldContext => ({ renderer: renderer!, constants, quality });

function setQuality(q: Quality) {
  quality = q;
  try {
    localStorage.setItem('slowlight-quality', q);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
  resize();
  world?.setQuality(q, ctx());
}

function showTitle() {
  world?.dispose();
  world = null;
  chrome = null;
  document.body.dataset.mode = 'title';
  if (document.pointerLockElement) document.exitPointerLock();
  ui.replaceChildren(titleScreen(enter, quality, setQuality, startupError));
  history.replaceState(null, '', location.pathname + (params.has('quality') ? `?quality=${quality}` : ''));
  document.querySelector<HTMLButtonElement>('.plate')?.focus({ preventScroll: true });
}

async function enter(id: string) {
  if (!renderer || startupError) return;
  document.body.dataset.mode = 'loading';
  ui.replaceChildren(Object.assign(document.createElement('div'), { className: 'loading', role: 'status', textContent: 'Tuning the constants…' }));
  try {
    const W = await loaders[id]();
    await new Promise((r) => requestAnimationFrame(r));
    world?.dispose();
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
  chrome = worldChrome(w, card, constants, {
    quality,
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
    onToggle: () => {},
    onAction: (a) => w.runAction(a, ctx()),
    onTour: goTour,
    onQuality: setQuality,
  });
  document.body.dataset.mode = 'world';
  ui.replaceChildren(chrome.root);
  chrome.syncDials(constants);
  input.setKeyHandler((code) => {
    if (code === 'KeyN') goTour(tourIndex + 1);
    else if (code === 'KeyB') goTour(tourIndex - 1);
    else if (code === 'Escape') document.querySelector<HTMLElement>('.help')?.setAttribute('hidden', '');
    const a = w.actions.find((x) => x.key === code);
    if (a) w.runAction(a.id, ctx());
  });
  history.replaceState(null, '', `?world=${id}${params.has('quality') ? `&quality=${quality}` : ''}`);
  goTour(0, true);
  if (pendingShare && params.get('world') === id) {
    Object.assign(constants, pendingShare);
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
  for (const k of Object.keys(DIALS) as ConstantKey[]) q.set(k, constants[k].toPrecision(4));
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
  if (stop.action) world.runAction(stop.action, ctx());
  input.consumeTouched();
  chrome.setTour(tourIndex);
  chrome.syncDials(constants);
  chrome.syncToggles();
}

let last = performance.now();
let hudTimer = 0;
function loop(now: number) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!world || !renderer) return;
  input.poll();
  world.frame(dt, input.state, ctx());
  input.consumeTouched();
  frames++;
  hudTimer -= dt;
  if (hudTimer <= 0 && chrome) {
    hudTimer = 0.1;
    chrome.setReadouts(world.readouts(ctx()), world.status(ctx()));
  }
}

resize();
requestAnimationFrame(loop);
const initial = params.get('world');
if (initial && initial in loaders && !startupError) void enter(initial);
else showTitle();

// Read-only probe for the end-to-end tests.
(window as unknown as { slowlight: object }).slowlight = {
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
