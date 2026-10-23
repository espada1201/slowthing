import { describe, expect, it } from 'vitest';
import { gpuCaps, unsupported } from '../src/gpuCaps';
import { WORLD_CARDS } from '../src/ui/dom';

const offering = (...names: string[]) => gpuCaps((n) => names.includes(n));

describe('GPU capabilities', () => {
  it('counts 32-bit float targets as 16-bit ones too, and 16-bit alone as half', () => {
    expect(offering('EXT_color_buffer_float')).toEqual({ floatTargets: true, halfFloatTargets: true });
    expect(offering('EXT_color_buffer_half_float')).toEqual({ floatTargets: false, halfFloatTargets: true });
    expect(offering()).toEqual({ floatTargets: false, halfFloatTargets: false });
  });

  it('leaves every world open on a full GPU', () => {
    for (const c of WORLD_CARDS) expect(unsupported(c.id, offering('EXT_color_buffer_float')), c.id).toBeNull();
  });

  it('closes only Big ħ when a device renders to 16-bit float textures alone (an older iPhone)', () => {
    const caps = offering('EXT_color_buffer_half_float');
    expect(unsupported('slow-light', caps)).toBeNull();
    expect(unsupported('big-g', caps)).toBeNull();
    expect(unsupported('big-hbar', caps)).toMatch(/Big ħ cannot run on this device.*32-bit.*EXT_color_buffer_float/);
  });

  it('closes Slow Light and Big ħ, but never Big G, when no float target exists', () => {
    const caps = offering();
    expect(unsupported('slow-light', caps)).toMatch(/Slow Light cannot run.*16-bit/);
    expect(unsupported('big-hbar', caps)).not.toBeNull();
    expect(unsupported('big-g', caps)).toBeNull();
  });
});
