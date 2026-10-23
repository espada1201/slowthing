import type * as THREE from 'three';
import { PROOFS, type Proof, worldProofs } from '../proofs';
import { WORLD_CARDS, h } from './dom';

const worldName = (plate: string) => WORLD_CARDS.find((c) => c.plate === `Plate ${plate}`)?.title;

/** What the GPU checks run on: a renderer that can draw into 32-bit float textures, or the reason this browser has none. */
export type ProofsGpu = { renderer: THREE.WebGLRenderer } | { unavailable: string };

/** The Proofs screen: runs every check in this browser and shows measured against expected. */
export function proofsView(target: ProofsGpu, onBack: () => void) {
  const renderer = 'renderer' in target ? target.renderer : null;
  const unavailable = 'unavailable' in target ? target.unavailable : '';
  const list = h('ol', { class: 'proofs' });
  const summary = h('p', { class: 'proofs-summary', role: 'status' }, 'Running…');
  const again = h('button', { class: 'btn', onclick: () => void run() }, 'Run again');
  const root = h(
    'main',
    { class: 'title proofs-page', id: 'proofs' },
    h('header', { class: 'title-head' },
      h('button', { class: 'btn ghost back', onclick: onBack }, '← Worlds'),
      h('p', { class: 'kicker' }, 'Proofs'),
      h('h1', { class: 'proofs-h' }, 'Computed, not faked'),
      h('p', { class: 'lede' }, 'Every check below runs now, in this browser. The CPU checks hold the physics engine to textbook results. The GPU checks run the very shaders the worlds draw with and hold them to that independent physics.'),
    ),
    h('div', { class: 'row' }, again, summary),
    list,
  );

  async function run() {
    again.disabled = true;
    const gpu = await worldProofs().then(
      (proofs) => ({ proofs, error: null }),
      (error: Error) => ({ proofs: [], error }),
    );
    const proofs: Proof[] = [...PROOFS, ...gpu.proofs];
    proofs.sort((a, b) => a.world.localeCompare(b.world) || Number(a.gpu) - Number(b.gpu));
    const rows = proofs.map((p) => {
      const state = h('span', { class: 'proof-state' }, 'waiting');
      const result = h('span', { class: 'proof-result' });
      const li = h('li', { class: 'proof', 'data-proof': p.id, 'data-state': 'waiting' },
        h('div', { class: 'proof-head' }, state, h('span', { class: 'proof-world' }, `${p.world} · ${worldName(p.world)}${p.gpu ? ' · GPU' : ''}`)),
        h('h2', {}, p.title),
        h('p', { class: 'proof-claim' }, p.claim),
        result,
      );
      return { p, li, state, result };
    });
    // GPU checks that cannot load count as a failure, so the summary never passes without them.
    const unloaded = gpu.error
      ? h('li', { class: 'proof', 'data-proof': 'gpu-load', 'data-state': 'fail' },
          h('div', { class: 'proof-head' }, h('span', { class: 'proof-state' }, 'error'), h('span', { class: 'proof-world' }, 'GPU')),
          h('h2', {}, 'GPU checks'),
          h('p', { class: 'proof-result' }, `They could not load: ${gpu.error.message}`),
        )
      : null;
    const total = rows.length + (unloaded ? 1 : 0);
    list.replaceChildren(...rows.map((r) => r.li), ...(unloaded ? [unloaded] : []));
    let passed = 0;
    for (const r of rows) {
      r.li.dataset.state = 'running';
      r.state.textContent = 'running';
      await new Promise((res) => setTimeout(res, 30));
      // Left for a world: stop, rather than draw on the renderer the world now uses.
      if (!root.isConnected) return;
      try {
        if (r.p.gpu && !renderer) throw new Error(unavailable);
        // CPU proofs ignore the renderer.
        const out = await r.p.run(renderer!);
        r.li.dataset.state = out.pass ? 'pass' : 'fail';
        r.state.textContent = out.pass ? 'pass' : 'fail';
        r.result.textContent = `Measured ${out.measured}. Expected ${out.expected}.`;
        if (out.pass) passed++;
      } catch (e) {
        r.li.dataset.state = 'fail';
        r.state.textContent = 'error';
        r.result.textContent = (e as Error).message;
      }
      summary.textContent = `${passed} of ${total} passed`;
    }
    again.disabled = false;
  }
  void run();
  return root;
}
