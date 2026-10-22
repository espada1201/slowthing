// Plain DOM for every page of the site: h() and the worlds' title cards. It imports nothing, so teach.html, which
// only prints, can draw with it without loading the in-world chrome or audio.

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
    dial: 'ħ = 0.25 J·s',
    blurb: 'A courtyard where a rolled ball is a wave. It fans out through a doorway, interferes through two openings and tunnels through glass.',
    art: `<svg viewBox="0 0 120 80" aria-hidden="true"><g fill="currentColor"><rect x="56" y="6" width="3" height="20"/><rect x="56" y="31" width="3" height="18"/><rect x="56" y="54" width="3" height="20"/></g><g fill="none" stroke="currentColor" stroke-width="1"><path d="M10 40 h30" /><path d="M36 36 l5 4 -5 4"/></g><g fill="none" stroke="var(--accent)" stroke-width="1.2">${[10, 18, 26, 34, 42].map((r) => `<path d="M58 28.5 m0 ${-r} a${r} ${r} 0 0 1 0 ${2 * r}"/><path d="M58 51.5 m0 ${-r} a${r} ${r} 0 0 1 0 ${2 * r}"/>`).join('')}</g><g fill="currentColor">${[14, 24, 33, 40, 47, 56, 66].map((y, i) => `<rect x="110" y="${y}" width="${[2, 4, 7, 9, 7, 4, 2][i]}" height="3"/>`).join('')}</g></svg>`,
  },
  {
    id: 'big-g',
    plate: 'Plate III',
    title: 'Big G',
    dial: 'G = 3.4×10²² × real',
    blurb: 'Turn up gravity until a boulder collapses into a black hole, then watch the sky bend around its shadow.',
    art: `<svg viewBox="0 0 120 80" aria-hidden="true"><circle cx="60" cy="40" r="11" fill="currentColor"/><circle cx="60" cy="40" r="17" fill="none" stroke="var(--accent)" stroke-width="1.6"/><g fill="none" stroke="currentColor" stroke-width="0.9" stroke-dasharray="2 3"><path d="M4 30 Q60 -6 116 30"/><path d="M4 50 Q60 86 116 50"/><circle cx="60" cy="40" r="26"/></g><g fill="currentColor"><circle cx="16" cy="12" r="1"/><circle cx="100" cy="70" r="1.2"/><circle cx="108" cy="16" r="0.8"/><circle cx="20" cy="66" r="0.8"/></g></svg>`,
  },
];
