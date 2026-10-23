// DOM for the title screen and the in-world instruments. Plain elements, no framework.

import { setSound, soundOn } from '../audio';
import { type ConstantKey, type Constants, DIALS, REAL, SLIDER_STEPS, formatSI, fromSlider, keyedSlider, parseNumber, ratioLabel, toSlider } from '../constants';
import type { Quality, QualitySetting, Readout, Toggle, World } from '../worlds/types';
import { WORLD_CARDS, type WorldCard, h } from './dom';
import type { Ruler } from './ruler';

export function titleScreen(onEnter: (id: string) => void, onProofs: () => void, quality: QualitySetting, onQuality: (q: QualitySetting) => void, error: string | null) {
  const plates = WORLD_CARDS.map((c) =>
    h(
      'button',
      { class: 'plate', 'data-world': c.id, onclick: () => onEnter(c.id) },
      h('span', { class: 'plate-no' }, c.plate),
      h('span', { class: 'plate-art', html: c.art }),
      h('span', { class: 'plate-title' }, c.title),
      h('span', { class: 'plate-dial' }, c.dial, h('span', { class: 'plate-gloss' }, `, ${c.gloss}`)),
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
      h('span', { class: 'title-hint' }, 'Click to look · WASD to move · Shift to run · on phones: left thumb moves, right thumb looks'),
      h(
        'span',
        { class: 'title-links' },
        h('button', { class: 'btn ghost proofs-link', 'data-proofs': true, onclick: onProofs }, 'Check the physics →'),
        h('a', { class: 'btn ghost proofs-link', 'data-teach': true, href: 'teach.html' }, 'For teachers →'),
      ),
      h('label', { class: 'quality' }, 'Quality ', select),
    ),
  );
}

function qualitySelect(q: QualitySetting, onChange: (q: QualitySetting) => void) {
  const s = h('select', { 'aria-label': 'Rendering quality', onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as QualitySetting) });
  for (const v of ['auto', 'low', 'medium', 'high'] as QualitySetting[]) s.append(h('option', { value: v, ...(v === q ? { selected: true } : {}) }, v[0].toUpperCase() + v.slice(1)));
  return s;
}

export interface Chrome {
  root: HTMLElement;
  setReadouts(r: Readout[], status: string): void;
  syncDials(c: Constants): void;
  syncToggles(): void;
  /** Show tour stop i; `waiting` offers the Start button for its action. */
  setTour(i: number, waiting?: boolean): void;
  /** Name the preset Auto is running (null when a preset was chosen by hand). */
  showQuality(q: Quality | null): void;
  /** Show the level reticle while the view warps, unless the visitor switched it off. */
  showReticle(warping: boolean): void;
  /** What Esc does first: put away one thing, a definition before the controls help before the open Dials panel. Whether any was up. */
  dismiss(): boolean;
  /** Show or hide the controls help, as its ? button and the ? key do. */
  toggleHelp(): void;
  /** Say on the tour card that the dials have been turned since the stop set them, so it may not look as described. */
  showTurned(turned: boolean): void;
  /** The visitor is stepping through the tour, so the how-to-move hint has been read: drop it for this visit (not for later ones). */
  dismissHint(): void;
  /** The visitor has walked or looked: drop the how-to-move hint, for this and later visits. */
  controlsUsed(): void;
  /** Say something calm over the view (or stop saying it, with null): a screen gone black needs a reason. */
  showNotice(text: string | null): void;
  flash(msg: string): void;
}

export function worldChrome(
  world: World,
  card: WorldCard,
  constants: Constants,
  opts: {
    quality: QualitySetting;
    onBack: () => void;
    onDial: (k: ConstantKey, v: number) => void;
    onReal: () => void;
    onPreset: () => void;
    onShare: () => void;
    onAction: (id: string) => void;
    onTour: (i: number) => void;
    /** Put the dials back as the current tour stop set them. */
    onStopDials: () => void;
    onStart: () => void;
    onQuality: (q: QualitySetting) => void;
    /** The sky ruler, for a world that reports its view. */
    ruler: Ruler | null;
  },
): Chrome {
  const { ruler } = opts;
  const dialRows = world.dials.map((k) => {
    const d = DIALS[k];
    const input = h('input', { type: 'range', min: 0, max: SLIDER_STEPS, step: 1, value: toSlider(d, constants[k]), 'aria-label': `${d.name} (${d.symbol})`, 'data-dial': k });
    const val = h('output', { class: 'dial-value' });
    const ratio = h('span', { class: 'dial-ratio' });
    input.addEventListener('input', () => opts.onDial(k, fromSlider(d, Number(input.value))));
    input.addEventListener('keydown', (e) => {
      const to = e.ctrlKey || e.altKey || e.metaKey ? null : keyedSlider(d, e.key, e.shiftKey, Number(input.value));
      if (to === null) return;
      e.preventDefault();
      input.value = String(to);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return { k, input, val, ratio, el: h('div', { class: 'dial' }, h('div', { class: 'dial-head' }, h('span', { class: 'dial-sym' }, d.symbol), h('span', { class: 'dial-name' }, d.name), ratio), input, val) };
  });
  const switchFor = (t: Toggle) => {
    const box = h('input', { type: 'checkbox', role: 'switch', 'data-toggle': t.id, ...(t.value ? { checked: true } : {}) });
    box.addEventListener('change', () => {
      t.value = box.checked;
    });
    return { t, box, el: h('label', { class: 'switch', title: t.hint }, box, h('span', { class: 'track' }), h('span', { class: 'switch-label' }, t.label)) };
  };
  const toggles = world.toggles.filter((t) => !t.view).map(switchFor);
  // On by default: it only shows at speed, which is where a visitor reported feeling dizzy.
  const level: Toggle = { id: 'reticle', label: 'Level reticle', hint: 'A fixed level mark at the centre while you move near light speed, to steady your eyes', value: true };
  try {
    level.value = localStorage.getItem('slowlight-reticle') !== 'off';
  } catch {
    /* storage blocked: keep the default */
  }
  const steady = switchFor(level);
  steady.box.addEventListener('change', () => {
    try {
      localStorage.setItem('slowlight-reticle', level.value ? 'on' : 'off');
    } catch {
      /* not remembered */
    }
  });
  const reticle = h('div', {
    class: 'reticle',
    hidden: true,
    html: '<svg viewBox="0 0 72 12" width="72" height="12" aria-hidden="true"><g stroke-linecap="round"><path d="M4 6h22M46 6h22" stroke="rgba(16,18,22,.6)" stroke-width="5"/><path d="M4 6h22M46 6h22" stroke="#fff" stroke-width="2"/></g><circle cx="36" cy="6" r="2.2" fill="#fff" stroke="rgba(16,18,22,.6)" stroke-width="1.5"/></svg>',
  });
  const actions = world.actions.map((a) => h('button', { class: 'btn', 'data-action': a.id, onclick: () => opts.onAction(a.id) }, a.label, h('kbd', {}, a.key.replace('Key', ''))));
  if (ruler) actions.push(ruler.button('btn', h('kbd', {}, 'R')));
  // A view toggle has a button in the top bar and, for phones, one on the tour card.
  const viewButton = (t: Toggle) => {
    const flip = () => {
      t.value = !t.value;
      syncViews();
    };
    return h('button', { class: 'btn ghost', 'data-view': t.id, 'aria-pressed': String(t.value), title: t.hint, onclick: flip }, t.label);
  };
  const views = world.toggles.filter((t) => t.view).map((t) => ({ t, top: viewButton(t), quick: viewButton(t) }));
  const syncViews = () => views.forEach(({ t, top, quick }) => [top, quick].forEach((b) => b.setAttribute('aria-pressed', String(t.value))));
  // On a phone the panel hides behind a toggle, so the main actions also sit on the tour card.
  const quick = h('div', { class: 'quick' }, ...world.actions.slice(0, 2).map((a) => h('button', { class: 'btn ghost', 'data-action': a.id, onclick: () => opts.onAction(a.id) }, a.label)), ruler?.button('btn ghost') ?? null, ...views.map((v) => v.quick));
  const selects = [0, 1].map(() =>
    qualitySelect(opts.quality, (q) => {
      for (const s of selects) s.value = q;
      opts.onQuality(q);
    }),
  );

  // An action, outlined like its neighbours; it shows pressed only while the world's dials are at their real values.
  const realBtn = h('button', { class: 'btn ghost', 'data-reset': 'real', 'aria-pressed': 'false', onclick: opts.onReal }, 'Real universe');
  const panel = h(
    'aside',
    { class: 'panel', id: 'panel', 'aria-label': 'Constants and effects' },
    h('h2', { class: 'panel-h' }, 'Dials'),
    ...dialRows.map((d) => d.el),
    h('div', { class: 'row' }, realBtn, h('button', { class: 'btn ghost', 'data-reset': 'preset', onclick: opts.onPreset }, 'World preset'), h('button', { class: 'btn ghost', 'data-share': true, title: 'Copy a link to this universe', onclick: opts.onShare }, 'Share')),
    toggles.length ? h('h2', { class: 'panel-h' }, 'Effects') : null,
    toggles.length ? h('div', { class: 'switches' }, ...toggles.map((t) => t.el)) : null,
    actions.length ? h('div', { class: 'row actions' }, ...actions) : null,
    world.warping ? h('h2', { class: 'panel-h' }, 'Comfort') : null,
    world.warping ? steady.el : null,
    h('label', { class: 'panel-quality' }, 'Quality ', selects[1]),
  );
  const readoutList = h('dl', { class: 'readouts' });
  const statusLine = h('p', { class: 'status' });
  // What a Greek letter in the instruments means, shown under them. The button's own name carries the same words for screen readers.
  const defTip = h('p', { class: 'sym-tip', hidden: true, 'aria-hidden': 'true' });
  const hud = h('section', { class: 'hud', 'aria-label': 'Instruments', 'aria-live': 'off' }, readoutList, statusLine, defTip);
  /** The letter whose definition is showing, and whether a click or tap (not just hover or focus) is holding it up. */
  let defShown: HTMLElement | null = null;
  let defHeld = false;
  const showDef = (btn: HTMLElement) => {
    defShown = btn;
    defTip.textContent = btn.getAttribute('aria-label');
    defTip.hidden = false;
  };
  const hideDef = () => {
    defShown = null;
    defHeld = false;
    defTip.hidden = true;
  };
  const symbolButton = (symbol: string, define: string) => {
    const btn = h('button', { class: 'sym', type: 'button', 'aria-label': define }, symbol);
    btn.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && showDef(btn));
    btn.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && !defHeld && document.activeElement !== btn && hideDef());
    btn.addEventListener('focus', () => showDef(btn));
    btn.addEventListener('blur', () => !defHeld && hideDef());
    // A tap or click holds it up (a finger has no hover, and Safari gives a tapped button no focus); Enter and Space have focus to do it.
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) return;
      if (defShown === btn && defHeld) hideDef();
      else {
        showDef(btn);
        defHeld = true;
      }
    });
    return btn;
  };
  // Anywhere else that takes focus or a press puts the definition away.
  const away = (e: Event) => {
    if (!hud.isConnected) return document.removeEventListener(e.type, away, true);
    if (defShown && !(e.target instanceof Node && defShown.contains(e.target))) hideDef();
  };
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('focusin', away, true);

  const tourNo = h('span', { class: 'tour-no' });
  const tourTitle = h('h3', { class: 'tour-title' });
  const tourText = h('p', { class: 'tour-text' });
  const predictBox = h('div', { class: 'predict', hidden: true });
  const prev = h('button', { class: 'btn ghost', 'aria-label': 'Previous tour stop', onclick: () => opts.onTour(current - 1) }, '←');
  const next = h('button', { class: 'btn', 'data-tour-next': true, 'aria-label': 'Next tour stop', onclick: () => opts.onTour(current + 1) }, 'Next →');
  const start = h('button', { class: 'btn start', hidden: true }, 'Start');
  start.addEventListener('click', () => {
    start.hidden = true;
    opts.onStart();
  });
  // Said once, at the last stop: the card has nowhere further to go, and Next greys out without a word.
  const tourEnd = h('p', { class: 'tour-end', hidden: true, tabindex: -1 }, 'That is the end of the tour. Keep walking and turning the dials, or go back to the Worlds for another.');
  // Above the text, which keeps saying what this stop's own dials show (a size, a speed): that is no longer what the view shows.
  const turned = h('p', { class: 'tour-turned', hidden: true }, 'The dials differ from this stop’s. The text below is for this stop’s setting, so the view may not look as described. ', h('button', { class: 'linkish', onclick: opts.onStopDials }, 'Use this stop’s dials'));
  // The card's words scroll above its buttons, never under them; this says so while there is more below.
  const more = h('div', { class: 'tour-more', 'aria-hidden': 'true' }, h('span', {}, 'More below ↓'));
  const tourBody = h('div', { class: 'tour-body' }, h('div', { class: 'tour-head' }, tourNo, tourTitle), turned, predictBox, tourText, tourEnd, more);
  const tour = h('section', { class: 'tour', 'aria-label': 'Guided tour', 'aria-live': 'polite' }, tourBody, h('div', { class: 'row tour-actions' }, quick, start, prev, next));
  const syncMore = () => tourBody.toggleAttribute('data-more', tourBody.scrollHeight - tourBody.scrollTop - tourBody.clientHeight > 2);
  tourBody.addEventListener('scroll', syncMore, { passive: true });
  // What the card says changes its height without changing its size, so watch both.
  let moreFrame = 0;
  const soon = () => {
    cancelAnimationFrame(moreFrame);
    moreFrame = requestAnimationFrame(syncMore);
  };
  new MutationObserver(soon).observe(tourBody, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(soon).observe(tourBody);
  window.addEventListener('resize', soon);
  let current = 0;
  /** The readouts left up while a measurement waits for its answer. */
  let given: string[] | null = null;

  // The chevron says it opens something: with Measured up, the dials fold behind this button.
  const chevron = h('span', { class: 'chev', 'aria-hidden': 'true' }, '▾');
  const panelToggle = h('button', { class: 'btn ghost panel-toggle', 'aria-controls': 'panel', 'aria-expanded': 'false' }, 'Dials', chevron);
  panelToggle.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    panelToggle.setAttribute('aria-expanded', String(open));
    chevron.textContent = open ? '▴' : '▾';
    // From the keyboard, carry focus into what just opened.
    if (open && panelToggle.matches(':focus-visible')) panel.querySelector<HTMLElement>('input, button, select')?.focus();
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
    h('p', {}, h('kbd', {}, 'W A S D'), ' move, ', h('kbd', {}, '← →'), ' turn, ', h('kbd', {}, 'Shift'), ' runs.'),
    ...(world.help ?? []).map((l) => h('p', {}, ...l.keys.flatMap((k, i) => [i ? ' / ' : null, h('kbd', {}, k)]), ` ${l.text}`)),
    ...world.actions.map((a) => h('p', {}, h('kbd', {}, a.key.replace('Key', '')), ` ${a.label.toLowerCase()}.`)),
    ruler ? h('p', {}, h('kbd', {}, 'R'), ' ruler: click two points to measure the angle between them, or move with the arrows and mark with Enter.') : null,
    h('p', {}, h('kbd', {}, 'N'), ' next tour stop, ', h('kbd', {}, 'B'), ' previous.'),
    h('p', {}, h('kbd', {}, '?'), ' shows or hides this list.'),
    h('p', {}, h('kbd', {}, 'Esc'), ' closes what is open, and leaves the world when nothing is.'),
    ...(world.glossary ?? []).map((g) => h('p', { class: 'help-def' }, g)),
    h('p', {}, 'On a phone: drag the left side to walk, the right side to look.'),
  );
  helpBtn.addEventListener('click', () => {
    help.hidden = !help.hidden;
    helpBtn.setAttribute('aria-expanded', String(!help.hidden));
  });
  const toast = h('div', { class: 'toast', role: 'status' });
  // Always rendered, so screen readers hear its text arrive; it only takes up room while it says something.
  const notice = h('p', { class: 'view-notice', role: 'status' });
  // Until a visitor has once walked or looked around, say how, over the view: the title screen's line is easy to miss.
  const hint = h(
    'aside',
    { class: 'move-hint', 'aria-label': 'How to move', hidden: remembered(MOVED) },
    matchMedia('(pointer: coarse)').matches
      ? 'Drag on the left of the screen to walk, on the right to look around.'
      : `Click the view to look around · W A S D to walk, ← → to turn, Shift to run · ${world.actions.slice(0, 1).map((a) => `${a.key.replace('Key', '')} ${a.label.toLowerCase()} · `).join('')}N next tour stop · ? lists every key`,
  );

  const top = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn ghost', 'data-back': true, onclick: opts.onBack }, '←', h('span', { class: 'wide-only' }, ' Worlds')),
    h('div', { class: 'world-name' }, h('span', { class: 'plate-no' }, card.plate), h('span', {}, world.title)),
    // Dials comes last, ahead of the panel in the page, so that Shift+Tab from the first dial lands on it and not on the ? button.
    h('div', { class: 'top-right' }, ...views.map((v) => v.top), soundBtn, selects[0], helpBtn, panelToggle),
  );
  // The ruler goes first so that it lies under the panels: they stay usable while it is on.
  const root = h('div', { class: 'chrome', 'data-world': world.id }, ruler?.root ?? null, reticle, hint, top, help, panel, hud, tour, toast, notice, world.overlay ?? null);
  // A mouse or finger leaves focus on the switch, slider or button it touched, which would keep Space and the
  // arrows for itself; hand the keyboard back to the world. Keyboard users keep their focus.
  root.addEventListener('pointerup', (e) => {
    const el = (e.target as Element).closest('button, input[type="checkbox"], input[type="range"]');
    if (el instanceof HTMLElement) setTimeout(() => el.blur());
  });

  let toastTimer = 0;
  let rowKey = '';
  let rowValues: { value: Text; gauge: HTMLElement | null }[] = [];
  return {
    root,
    setReadouts(rs, status) {
      const shown = rs.filter((r) => !given || given.includes(r.label));
      // The instruments refresh ten times a second: keep the same elements while the same ones are listed, so a focused
      // letter keeps its focus, and only the values change.
      const key = shown.map((r) => [r.label, r.gloss, r.define, r.gauge !== undefined].join('|')).join('\n');
      if (key !== rowKey) {
        rowKey = key;
        rowValues = [];
        readoutList.replaceChildren(
          ...shown.flatMap((r) => {
            const value = document.createTextNode('');
            const dd = h('dd', {}, value);
            const gauge = r.gauge === undefined ? null : h('span', { class: 'gauge' });
            if (gauge) dd.append(gauge);
            rowValues.push({ value, gauge });
            const name = r.symbol && r.define && r.label.startsWith(r.symbol) ? [symbolButton(r.symbol, r.define), r.label.slice(r.symbol.length)] : [r.label];
            return [h('dt', {}, ...name, r.gloss ? h('span', { class: 'gloss' }, r.gloss) : null), dd];
          }),
        );
        if (defShown && !defShown.isConnected) hideDef();
      }
      shown.forEach((r, i) => {
        const row = rowValues[i];
        if (row.value.data !== r.value) row.value.data = r.value;
        row.gauge?.style.setProperty('--g', String(Math.max(0, Math.min(1, r.gauge ?? 0))));
      });
      statusLine.textContent = given ? '' : status;
    },
    syncDials(c) {
      realBtn.setAttribute('aria-pressed', String(world.dials.every((k) => c[k] === REAL[k])));
      for (const d of dialRows) {
        if (document.activeElement !== d.input) d.input.value = String(toSlider(DIALS[d.k], c[d.k]));
        d.val.textContent = `${formatSI(c[d.k])} ${DIALS[d.k].unit}`;
        d.ratio.textContent = ratioLabel(d.k, c[d.k]);
      }
    },
    syncToggles() {
      for (const t of toggles) t.box.checked = t.t.value;
      syncViews();
    },
    setTour(i, waiting = false) {
      // A keyboard user who stepped here with Next or Back goes straight to a question's answers.
      const fromKeys = [next, prev].some((b) => b.matches(':focus-visible'));
      const had = document.activeElement;
      /** Where focus goes if the button it is on greys out and this stop has a question to answer. */
      let firstAnswer: HTMLElement | null = null;
      current = i;
      tourBody.scrollTop = 0;
      const last = i === world.tour.length - 1;
      start.hidden = !waiting;
      const stop = world.tour[i];
      tourNo.textContent = `${i + 1} / ${world.tour.length}`;
      tourTitle.textContent = stop.title;
      tourText.textContent = stop.text;
      const { predict: p, measure: m } = stop;
      predictBox.hidden = !p && !m;
      tourText.hidden = !!(p || m);
      // After a question's answer, when its reveal shows.
      tourEnd.hidden = !last || !!(p || m);
      // The instruments would give the answer away, so they wait until the visitor has committed.
      root.classList.toggle('predicting', !!p);
      given = m?.given ?? null;
      // The answer takes focus so it is read out; Tab from it goes on to Next, not through the stop's actions first.
      const toNext = (e: Event) => {
        const { key, shiftKey } = e as KeyboardEvent;
        if (key !== 'Tab' || shiftKey || next.disabled) return;
        e.preventDefault();
        next.focus();
      };
      // The tail both kinds of question share. Showing the answer ends the question: its skip link and its note go,
      // the instruments come back, and focus moves to the answer so it is read out.
      const optionalNote = () => h('span', { class: 'predict-opt' }, 'Optional: Next goes on without an answer.');
      const answerBox = () => h('p', { class: 'predict-reveal', hidden: true, tabindex: -1, onkeydown: toNext });
      const revealAnswer = (box: HTMLElement, text: string, ...done: HTMLElement[]) => {
        box.textContent = text;
        box.hidden = false;
        tourText.hidden = false;
        tourEnd.hidden = !last;
        root.classList.remove('predicting');
        given = null;
        for (const el of done) el.hidden = true;
        box.focus();
      };
      if (p) {
        // Answering disables the button that had focus, so focus moves on to the answer.
        const reveal = answerBox();
        const choose = (k: number | null) => {
          for (const [j, b] of buttons.entries()) {
            b.disabled = true;
            if (j === p.answer) b.dataset.state = 'right';
            else if (j === k) b.dataset.state = 'wrong';
            else continue;
            // The marks are only drawn, so screen readers get them in the name.
            b.setAttribute('aria-label', `${p.options[j]} (${j === p.answer ? 'right answer' : 'your answer, wrong'})`);
          }
          revealAnswer(reveal, (k === null ? '' : k === p.answer ? 'Right. ' : 'Not quite. ') + p.reveal, skip, optional);
        };
        const optional = optionalNote();
        const buttons = p.options.map((o, k) => h('button', { class: 'choice', 'data-choice': k, onclick: () => choose(k) }, o));
        const skip = h('button', { class: 'linkish', onclick: () => choose(null) }, 'Just show me');
        predictBox.replaceChildren(h('p', { class: 'predict-q' }, h('span', { class: 'predict-tag' }, 'Predict'), p.question), h('div', { class: 'choices' }, ...buttons), skip, optional, reveal);
        firstAnswer = buttons[0];
        if (fromKeys) buttons[0].focus();
      }
      if (m) {
        const inputs = m.asks.map((a) => h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `${a.symbol} in ${a.unit}`, 'data-ask': a.symbol, oninput: (e: Event) => (e.target as HTMLInputElement).setCustomValidity('') }));
        const check = h('button', { class: 'btn', 'data-check': true }, 'Check');
        const reveal = answerBox();
        const commit = (mine: number[] | null) => {
          const { values, reveal: text } = m.answer(world.measureState?.());
          const yours = mine?.map((v, k) => {
            const off = (100 * (v - values[k])) / values[k];
            return `${m.asks[k].symbol} = ${formatSI(v)} ${m.asks[k].unit} (${Math.abs(off).toFixed(1)}% ${off < 0 ? 'low' : 'high'})`;
          });
          for (const el of [...inputs, check]) el.disabled = true;
          revealAnswer(reveal, (yours ? `Yours: ${yours.join(', ')}. ` : '') + text, skip, optional);
        };
        const skip = h('button', { class: 'linkish', onclick: () => commit(null) }, 'Just show me');
        const optional = optionalNote();
        const onsubmit = (e: Event) => {
          e.preventDefault();
          const mine = inputs.map((el) => parseNumber(el.value));
          for (const [k, el] of inputs.entries()) el.setCustomValidity(mine[k] === null ? 'Type a number, such as 4.1 or 9×10^4' : '');
          if ((e.target as HTMLFormElement).reportValidity()) commit(mine as number[]);
        };
        firstAnswer = inputs[0];
        const form = h('form', { class: 'row answers', novalidate: true, onsubmit }, ...m.asks.map((a, k) => h('label', { class: 'answer' }, a.symbol, inputs[k], a.unit)), check);
        predictBox.replaceChildren(h('p', { class: 'predict-q' }, h('span', { class: 'predict-tag' }, 'Measure'), m.question), h('ol', { class: 'steps' }, ...m.steps.map((t) => h('li', {}, t))), form, skip, optional, reveal);
      }
      prev.disabled = i === 0;
      next.disabled = last;
      // A disabled button cannot keep focus, and focus would fall to the page, where Space and the arrows move the
      // world. So a keyboard user on the one that just greyed out goes to what is left in the card: Back at the first
      // stop to Next; Next at the last to the first answer, or else the closing line.
      const stranded = [prev, next].find((b) => b.disabled && had === b);
      if (stranded && fromKeys) (stranded === prev ? next : firstAnswer ?? tourEnd).focus();
    },
    showQuality(q) {
      for (const s of selects) s.options[0].textContent = q ? `Auto (${q})` : 'Auto';
    },
    showReticle(warping) {
      reticle.hidden = !(warping && level.value);
    },
    showTurned(on) {
      if (turned.hidden === on) turned.hidden = !on;
    },
    dismissHint() {
      hint.hidden = true;
    },
    controlsUsed() {
      if (hint.hidden) return;
      hint.hidden = true;
      remember(MOVED);
    },
    dismiss() {
      if (!defTip.hidden) hideDef();
      else if (!help.hidden) {
        help.hidden = true;
        helpBtn.setAttribute('aria-expanded', 'false');
      } else if (panel.classList.contains('open')) panelToggle.click();
      else return false;
      return true;
    },
    toggleHelp() {
      helpBtn.click();
    },
    showNotice(text) {
      if (notice.textContent !== (text ?? '')) notice.textContent = text ?? '';
    },
    flash(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
    },
  };
}

const MOVED = 'slowlight-moved';

function remembered(key: string) {
  try {
    return localStorage.getItem(key) === 'yes';
  } catch {
    return false;
  }
}

function remember(key: string) {
  try {
    localStorage.setItem(key, 'yes');
  } catch {
    /* not remembered: the hint shows again next visit */
  }
}
