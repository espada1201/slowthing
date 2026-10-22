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
  let e = Math.floor(Math.log10(a));
  // 9.996×10¹² rounds to 10.00: carry it, as ratioLabel does.
  if (Math.abs(Number((v / 10 ** e).toFixed(digits - 1))) >= 10) e++;
  return `${(v / 10 ** e).toFixed(digits - 1)}×10${sup(e)}`;
}

/**
 * A number as people type it: "4.1" or "4,1", "90 000" or "90,000", "9e4", "9×10^4", "9 x 10⁴". A comma between
 * groups of three digits separates thousands; any other comma is a decimal point. Null if it is not a number.
 */
export function parseNumber(text: string): number | null {
  const fromSup = (t: string) => t.replace(/[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => (ch === '⁻' ? '-' : ch === '⁺' ? '+' : String(SUPERSCRIPT.indexOf(ch))));
  let s = text.replace(/\s/g, '').replace(/−/g, '-');
  s = s.replace(/[×x*·]10(?:\^([+-]?\d+)|([⁻⁺]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))$/i, (_, plain?: string, sup?: string) => `e${plain ?? fromSup(sup!)}`);
  s = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?(e[+-]?\d+)?$/i.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const v = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
  return Number.isFinite(v) ? v : null;
}

/** How many times larger or smaller than reality: "×3.4×10²²", "÷2.5×10⁷", "×1.5" or "real". */
export function ratioLabel(key: ConstantKey, v: number): string {
  const r = v / REAL[key];
  if (Math.abs(Math.log10(r)) < 0.01) return 'real';
  const big = r >= 1 ? r : 1 / r;
  let e = Math.floor(Math.log10(big));
  let m = Number((big / 10 ** e).toFixed(1));
  if (m >= 10) {
    m /= 10;
    e++;
  }
  return (r >= 1 ? '×' : '÷') + (e < 2 ? big.toPrecision(2) : `${m.toFixed(1)}×10${sup(e)}`);
}
