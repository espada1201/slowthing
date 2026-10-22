import { expect, it } from 'vitest';
import { flashMeter } from '../e2e/flash';

/** Two seconds of 60 Hz frames over 10 × 10 spots, of which the first `spots` alternate between `lo` and `hi` at `hz`. */
function measure(hz: number, spots: number, lo = 0.05, hi = 0.5) {
  const m = flashMeter(10, 10, 60);
  for (let k = 0; k < 120; k++) {
    const on = Math.floor((k * 2 * hz) / 60) % 2 === 1;
    m.add(Float32Array.from({ length: 100 }, (_, p) => (p < spots && on ? hi : lo)));
  }
  return m.result(10, 10);
}

it('flash meter: counts flashes a second, and the share of the field flashing more than three times a second', () => {
  expect(measure(4, 30)).toEqual({ flashes: 4, area: 0.3 });
  expect(measure(2, 30)).toEqual({ flashes: 2, area: 0 });
  expect(measure(4, 30, 0.05, 0.13).flashes).toBe(0);
  expect(measure(4, 30, 0.85, 1).flashes).toBe(0);
});
