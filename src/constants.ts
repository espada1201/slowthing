// The three dials. Values are SI; sliders move logarithmically between the real value and the
// largest/smallest value where the effect is still something you can walk around in.

export type ConstantKey = 'c' | 'hbar' | 'G';

export interface Constants {
  c: number;
  hbar: number;
  G: number;
}

export const REAL: Readonly<Constants> = { c: 299792458, hbar: 1.054571817e-34, G: 6.6743e-11 };

export interface Dial {
  key: ConstantKey;
  symbol: string;
  name: string;
  unit: string;
  min: number;
  max: number;
}

export const DIALS: Record<ConstantKey, Dial> = {
  c: { key: 'c', symbol: 'c', name: 'Speed of light', unit: 'm/s', min: 4, max: REAL.c },
  hbar: { key: 'hbar', symbol: 'ħ', name: "Planck's constant", unit: 'J·s', min: REAL.hbar, max: 1.5 },
  G: { key: 'G', symbol: 'G', name: 'Gravitational constant', unit: 'm³/kg·s²', min: REAL.G, max: 2e13 },
};

export const SLIDER_STEPS = 1000;

export function toSlider(dial: Dial, value: number): number {
  const t = Math.log(value / dial.min) / Math.log(dial.max / dial.min);
  return Math.round(Math.min(1, Math.max(0, t)) * SLIDER_STEPS);
}

export function fromSlider(dial: Dial, step: number): number {
  return dial.min * Math.pow(dial.max / dial.min, step / SLIDER_STEPS);
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => (n < 0 ? '⁻' : '') + String(Math.abs(n)).split('').map((d) => SUPERSCRIPT[+d]).join('');

/** Human formatting: plain numbers for everyday magnitudes, a × 10ⁿ otherwise. */
export function formatSI(v: number, digits = 3): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 1e5) return Number(v.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (a >= 1e5 && a < 1e9 && Number.isInteger(Math.round(v))) return Math.round(v).toLocaleString('en-US').replace(/,/g, ' ');
  const e = Math.floor(Math.log10(a));
  const m = v / 10 ** e;
  return `${m.toFixed(digits - 1)}×10${sup(e)}`;
}

/** How many times larger than reality, e.g. "×10²¹" or "real". */
export function ratioLabel(key: ConstantKey, v: number): string {
  const r = v / REAL[key];
  if (Math.abs(Math.log10(r)) < 0.01) return 'real';
  const e = Math.log10(r);
  if (Math.abs(e) < 2) return `×${r.toPrecision(2)}`;
  return `×10${sup(Math.round(e))}`;
}
