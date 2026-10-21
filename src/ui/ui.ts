// DOM for the title screen and the in-world instruments. Plain elements, no framework.

import { setSound, soundOn } from '../audio';
import { type ConstantKey, type Constants, DIALS, SLIDER_STEPS, formatSI, fromSlider, ratioLabel, toSlider } from '../constants';
import type { Quality, Readout, World } from '../worlds/types';

type Attrs = Record<string, string | boolean | number | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v as EventListener);
    else if (v === false) continue;
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

export interface WorldCard {
  id: string;
  plate: string;
  title: string;
  dial: string;
  blurb: string;
  art: string;
}

export const WORLD_CARDS: WorldCard[] = [
  {
    id: 'slow-light',
    plate: 'Plate I',
    title: 'Slow Light',
    dial: 'c = 12 m/s',
    blurb: 'A town where light crawls at cycling speed. Run, and the world folds into a tunnel of shifted colour.',
    art: `<svg viewBox="0 0 120 80" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1"><path d="M60 70 L20 10 M60 70 L100 10" stroke-dasharray="2 3"/><path d="M60 70 L60 6"/><ellipse cx="60" cy="14" rx="40" ry="6"/></g><g stroke="var(--accent)" stroke-width="1.4" fill="none"><path d="M60 70 Q48 40 38 14"/><path d="M60 70 Q72 40 82 14"/><path d="M60 70 Q55 40 50 12"/><path d="M60 70 Q65 40 70 12"/></g><circle cx="60" cy="70" r="2.5" fill="currentColor"/></svg>`,
  },
  {
    id: 'big-hbar',
    plate: 'Plate II',
    title: 'Big ħ',
    dial: 'ħ = 0.2 J·s',
    blurb: 'A courtyard where a thrown ball is a wave. It diffracts through doorways, interferes through columns and tunnels through glass.',
    art: `<svg viewBox="0 0 120 80" aria-hidden="true"><g fill="currentColor"><rect x="56" y="6" width="3" height="20"/><rect x="56" y="31" width="3" height="18"/><rect x="56" y="54" width="3" height="20"/></g><g fill="none" stroke="currentColor" stroke-width="1"><path d="M10 40 h30" /><path d="M36 36 l5 4 -5 4"/></g><g fill="none" stroke="var(--accent)" stroke-width="1.2">${[10, 18, 26, 34, 42].map((r) => `<path d="M58 28.5 m0 ${-r} a${r} ${r} 0 0 1 0 ${2 * r}"/><path d="M58 51.5 m0 ${-r} a${r} ${r} 0 0 1 0 ${2 * r}"/>`).join('')}</g><g fill="currentColor">${[14, 24, 33, 40, 47, 56, 66].map((y, i) => `<rect x="110" y="${y}" width="${[2, 4, 7, 9, 7, 4, 2][i]}" height="3"/>`).join('')}</g></svg>`,
  },
  {
    id: 'big-g',
    plate: 'Plate III',
    title: 'Big G',
    dial: 'G = 10²² × real',
    blurb: 'Turn up gravity until a boulder collapses into a black hole, then watch the sky bend around its shadow.',
    art: `<svg viewBox="0 0 120 80" aria-hidden="true"><circle cx="60" cy="40" r="11" fill="currentColor"/><circle cx="60" cy="40" r="17" fill="none" stroke="var(--accent)" stroke-width="1.6"/><g fill="none" stroke="currentColor" stroke-width="0.9" stroke-dasharray="2 3"><path d="M4 30 Q60 -6 116 30"/><path d="M4 50 Q60 86 116 50"/><circle cx="60" cy="40" r="26"/></g><g fill="currentColor"><circle cx="16" cy="12" r="1"/><circle cx="100" cy="70" r="1.2"/><circle cx="108" cy="16" r="0.8"/><circle cx="20" cy="66" r="0.8"/></g></svg>`,
  },
];

export function titleScreen(onEnter: (id: string) => void, onProofs: () => void, quality: Quality, onQuality: (q: Quality) => void, error: string | null) {
  const plates = WORLD_CARDS.map((c) =>
    h(
      'button',
      { class: 'plate', 'data-world': c.id, onclick: () => onEnter(c.id) },
      h('span', { class: 'plate-no' }, c.plate),
      h('span', { class: 'plate-art', html: c.art }),
      h('span', { class: 'plate-title' }, c.title),
      h('span', { class: 'plate-dial' }, c.dial),
      h('span', { class: 'plate-blurb' }, c.blurb),
    ),
  );
  const select = qualitySelect(quality, onQuality);
  return h(
    'main',
    { class: 'title', id: 'title' },
    h(
      'header',
      { class: 'title-head' },
      h('p', { class: 'kicker' }, 'Three universes, real physics, one dial each'),
      h('h1', {}, 'Slowlight'),
      h('p', { class: 'lede' }, 'What would you see if light crawled, if a ball were a wave, if a boulder could be a black hole? Turn the constants of nature and walk in. Every effect is computed, not faked.'),
    ),
    error ? h('p', { class: 'error', role: 'alert' }, error) : null,
    h('nav', { class: 'plates', 'aria-label': 'Choose a world' }, ...plates),
    h(
      'footer',
      { class: 'title-foot' },
      h('span', {}, 'Click to look · WASD to move · Shift to run · on phones: left thumb moves, right thumb looks'),
      h('button', { class: 'btn ghost proofs-link', 'data-proofs': true, onclick: onProofs }, 'Check the physics →'),
      h('label', { class: 'quality' }, 'Quality ', select),
    ),
  );
}

export function qualitySelect(q: Quality, onChange: (q: Quality) => void) {
  const s = h('select', { 'aria-label': 'Rendering quality', onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as Quality) });
  for (const v of ['low', 'medium', 'high'] as Quality[]) s.append(h('option', { value: v, ...(v === q ? { selected: true } : {}) }, v[0].toUpperCase() + v.slice(1)));
  return s;
}

export interface Chrome {
  root: HTMLElement;
  setReadouts(r: Readout[], status: string): void;
  syncDials(c: Constants): void;
  syncToggles(): void;
  setTour(i: number): void;
  flash(msg: string): void;
}

export function worldChrome(
  world: World,
  card: WorldCard,
  constants: Constants,
  opts: {
    quality: Quality;
    onBack: () => void;
    onDial: (k: ConstantKey, v: number) => void;
    onReal: () => void;
    onPreset: () => void;
    onShare: () => void;
    onToggle: () => void;
    onAction: (id: string) => void;
    onTour: (i: number) => void;
    onQuality: (q: Quality) => void;
  },
): Chrome {
  const dialRows = world.dials.map((k) => {
    const d = DIALS[k];
    const input = h('input', { type: 'range', min: 0, max: SLIDER_STEPS, step: 1, value: toSlider(d, constants[k]), 'aria-label': `${d.name} (${d.symbol})`, 'data-dial': k });
    const val = h('output', { class: 'dial-value' });
    const ratio = h('span', { class: 'dial-ratio' });
    input.addEventListener('input', () => opts.onDial(k, fromSlider(d, Number(input.value))));
    return { k, input, val, ratio, el: h('div', { class: 'dial' }, h('div', { class: 'dial-head' }, h('span', { class: 'dial-sym' }, d.symbol), h('span', { class: 'dial-name' }, d.name), ratio), input, val) };
  });
  const toggles = world.toggles.map((t) => {
    const box = h('input', { type: 'checkbox', role: 'switch', 'data-toggle': t.id, ...(t.value ? { checked: true } : {}) });
    box.addEventListener('change', () => {
      t.value = box.checked;
      opts.onToggle();
    });
    return { t, box, el: h('label', { class: 'switch', title: t.hint }, box, h('span', { class: 'track' }), h('span', { class: 'switch-label' }, t.label)) };
  });
  const actions = world.actions.map((a) => h('button', { class: 'btn', 'data-action': a.id, onclick: () => opts.onAction(a.id) }, a.label, h('kbd', {}, a.key.replace('Key', ''))));

  const panel = h(
    'aside',
    { class: 'panel', id: 'panel', 'aria-label': 'Constants and effects' },
    h('h2', { class: 'panel-h' }, 'Dials'),
    ...dialRows.map((d) => d.el),
    h('div', { class: 'row' }, h('button', { class: 'btn', 'data-reset': 'real', onclick: opts.onReal }, 'Real universe'), h('button', { class: 'btn ghost', 'data-reset': 'preset', onclick: opts.onPreset }, 'World preset'), h('button', { class: 'btn ghost', 'data-share': true, title: 'Copy a link to this universe', onclick: opts.onShare }, 'Share')),
    toggles.length ? h('h2', { class: 'panel-h' }, 'Effects') : null,
    toggles.length ? h('div', { class: 'switches' }, ...toggles.map((t) => t.el)) : null,
    actions.length ? h('div', { class: 'row actions' }, ...actions) : null,
  );
  const readoutList = h('dl', { class: 'readouts' });
  const statusLine = h('p', { class: 'status' });
  const hud = h('section', { class: 'hud', 'aria-label': 'Instruments', 'aria-live': 'off' }, readoutList, statusLine);

  const tourNo = h('span', { class: 'tour-no' });
  const tourTitle = h('h3', { class: 'tour-title' });
  const tourText = h('p', { class: 'tour-text' });
  const predictBox = h('div', { class: 'predict', hidden: true });
  const prev = h('button', { class: 'btn ghost', 'aria-label': 'Previous tour stop', onclick: () => opts.onTour(current - 1) }, '←');
  const next = h('button', { class: 'btn', 'data-tour-next': true, 'aria-label': 'Next tour stop', onclick: () => opts.onTour(current + 1) }, 'Next →');
  const tour = h('section', { class: 'tour', 'aria-label': 'Guided tour', 'aria-live': 'polite' }, h('div', { class: 'tour-head' }, tourNo, tourTitle), predictBox, tourText, h('div', { class: 'row' }, prev, next));
  let current = 0;

  const panelToggle = h('button', { class: 'btn ghost panel-toggle', 'aria-controls': 'panel', 'aria-expanded': 'false' }, 'Dials');
  panelToggle.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    panelToggle.setAttribute('aria-expanded', String(open));
  });
  const helpBtn = h('button', { class: 'btn ghost', 'aria-label': 'Controls help', 'aria-expanded': 'false' }, '?');
  const soundBtn = h('button', { class: 'btn ghost', 'data-sound': true, 'aria-pressed': String(soundOn()), title: 'Hear the physics: Doppler-shifted bells, detector clicks, distant clocks' }, 'Sound');
  soundBtn.addEventListener('click', () => {
    setSound(!soundOn());
    soundBtn.setAttribute('aria-pressed', String(soundOn()));
  });
  const help = h(
    'div',
    { class: 'help', hidden: true, role: 'dialog', 'aria-label': 'Controls' },
    h('p', {}, h('kbd', {}, 'Click'), ' the view to look around (Esc releases the mouse).'),
    h('p', {}, h('kbd', {}, 'W A S D'), ' or arrows move, ', h('kbd', {}, 'Shift'), ' runs.'),
    world.id === 'big-g' ? h('p', {}, h('kbd', {}, 'Space'), ' / ', h('kbd', {}, 'Q'), ' fly up and down.') : null,
    ...world.actions.map((a) => h('p', {}, h('kbd', {}, a.key.replace('Key', '')), ` ${a.label.toLowerCase()}.`)),
    h('p', {}, h('kbd', {}, 'N'), ' next tour stop, ', h('kbd', {}, 'B'), ' previous.'),
    h('p', {}, 'On a phone: drag the left side to walk, the right side to look.'),
  );
  helpBtn.addEventListener('click', () => {
    help.hidden = !help.hidden;
    helpBtn.setAttribute('aria-expanded', String(!help.hidden));
  });
  const toast = h('div', { class: 'toast', role: 'status' });

  const top = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn ghost', 'data-back': true, onclick: opts.onBack }, '← Worlds'),
    h('div', { class: 'world-name' }, h('span', { class: 'plate-no' }, card.plate), h('span', {}, world.title)),
    h('div', { class: 'top-right' }, panelToggle, soundBtn, qualitySelect(opts.quality, opts.onQuality), helpBtn),
  );
  const root = h('div', { class: 'chrome', 'data-world': world.id }, top, help, panel, hud, tour, toast);

  let toastTimer = 0;
  return {
    root,
    setReadouts(rs, status) {
      readoutList.replaceChildren(
        ...rs.flatMap((r) => {
          const dd = h('dd', {}, r.value);
          if (r.gauge !== undefined) dd.append(h('span', { class: 'gauge', style: `--g:${Math.max(0, Math.min(1, r.gauge))}` }));
          return [h('dt', {}, r.label), dd];
        }),
      );
      statusLine.textContent = status;
    },
    syncDials(c) {
      for (const d of dialRows) {
        if (document.activeElement !== d.input) d.input.value = String(toSlider(DIALS[d.k], c[d.k]));
        d.val.textContent = `${formatSI(c[d.k])} ${DIALS[d.k].unit}`;
        d.ratio.textContent = ratioLabel(d.k, c[d.k]);
      }
    },
    syncToggles() {
      for (const t of toggles) t.box.checked = t.t.value;
    },
    setTour(i) {
      current = i;
      const stop = world.tour[i];
      tourNo.textContent = `${i + 1} / ${world.tour.length}`;
      tourTitle.textContent = stop.title;
      tourText.textContent = stop.text;
      const p = stop.predict;
      predictBox.hidden = !p;
      tourText.hidden = !!p;
      if (p) {
        const reveal = h('p', { class: 'predict-reveal', hidden: true });
        const choose = (k: number | null) => {
          for (const [j, b] of buttons.entries()) {
            b.disabled = true;
            if (j === p.answer) b.dataset.state = 'right';
            else if (j === k) b.dataset.state = 'wrong';
          }
          reveal.textContent = (k === null ? '' : k === p.answer ? 'Right. ' : 'Not quite. ') + p.reveal;
          reveal.hidden = false;
          tourText.hidden = false;
          skip.hidden = true;
        };
        const buttons = p.options.map((o, k) => h('button', { class: 'choice', 'data-choice': k, onclick: () => choose(k) }, o));
        const skip = h('button', { class: 'linkish', onclick: () => choose(null) }, 'Just show me');
        predictBox.replaceChildren(h('p', { class: 'predict-q' }, h('span', { class: 'predict-tag' }, 'Predict'), p.question), h('div', { class: 'choices' }, ...buttons), skip, reveal);
      }
      prev.disabled = i === 0;
      next.disabled = i === world.tour.length - 1;
    },
    flash(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
    },
  };
}
