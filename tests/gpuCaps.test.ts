import { describe, expect, it } from 'vitest';
import { type GpuCaps, gpuCaps, unsupported } from '../src/gpuCaps';
import { WORLD_CARDS } from '../src/ui/dom';

/** A GPU that advertises exactly these extensions, and whose framebuffers really are complete for `renders`. */
const offering = (names: string[], renders: ('half' | 'float')[] = ['half', 'float']) => gpuCaps({ has: (n) => names.includes(n) }, (kind) => renders.includes(kind));
const closed = (id: string, caps: GpuCaps) => unsupported(WORLD_CARDS.find((c) => c.id === id)!, caps);

describe('GPU capabilities', () => {
  it('counts 32-bit float targets as 16-bit ones too, and 16-bit alone as half', () => {
    expect(offering(['EXT_color_buffer_float'])).toEqual({ floatTargets: true, halfFloatTargets: true });
    expect(offering(['EXT_color_buffer_half_float'])).toEqual({ floatTargets: false, halfFloatTargets: true });
    expect(offering([])).toEqual({ floatTargets: false, halfFloatTargets: false });
  });

  it('believes a framebuffer over an extension: advertised but not complete is not a target', () => {
    expect(offering(['EXT_color_buffer_float'], ['half'])).toEqual({ floatTargets: false, halfFloatTargets: true });
    expect(offering(['EXT_color_buffer_float'], [])).toEqual({ floatTargets: false, halfFloatTargets: false });
    expect(offering(['EXT_color_buffer_half_float'], [])).toEqual({ floatTargets: false, halfFloatTargets: false });
  });

  it('does not test a format whose extension is absent', () => {
    const asked: string[] = [];
    gpuCaps({ has: () => false }, (kind) => (asked.push(kind), true));
    expect(asked).toEqual([]);
  });

  it('leaves every world open on a full GPU', () => {
    for (const c of WORLD_CARDS) expect(closed(c.id, offering(['EXT_color_buffer_float'])), c.id).toBeNull();
  });

  it('closes only Big ħ when a device renders to 16-bit float textures alone', () => {
    const caps = offering(['EXT_color_buffer_half_float']);
    expect(closed('slow-light', caps)).toBeNull();
    expect(closed('big-g', caps)).toBeNull();
    expect(closed('big-hbar', caps)).toMatch(/Big ħ cannot run on this device.*32-bit.*EXT_color_buffer_float/);
  });

  it('closes Slow Light and Big ħ, but never Big G, when no float target exists', () => {
    const caps = offering([]);
    expect(closed('slow-light', caps)).toMatch(/Slow Light cannot run.*16-bit/);
    expect(closed('big-hbar', caps)).not.toBeNull();
    expect(closed('big-g', caps)).toBeNull();
  });

  it('closes a world on a GPU that advertises the extension but cannot complete the framebuffer', () => {
    expect(closed('big-hbar', offering(['EXT_color_buffer_float'], ['half']))).toMatch(/Big ħ cannot run/);
  });

  it('says which capability a world needs on its card, not in a table beside it', () => {
    expect(Object.fromEntries(WORLD_CARDS.map((c) => [c.id, c.needs ?? null]))).toEqual({ 'slow-light': 'halfFloatTargets', 'big-hbar': 'floatTargets', 'big-g': null });
  });
});
