// What this browser's GPU can render into, and which worlds that leaves open. Safari, and iOS most of all, offers
// less than desktop Chrome: older iPhones render to 16-bit float textures but not 32-bit ones, and no iPhone filters
// 32-bit float textures linearly (OES_texture_float_linear). The worlds read every 32-bit table with texelFetch from
// a nearest-filtered texture, so only the render targets matter.

export interface GpuCaps {
  /** Rendering into 16-bit float textures (EXT_color_buffer_float or EXT_color_buffer_half_float). */
  halfFloatTargets: boolean;
  /** Rendering into 32-bit float textures (EXT_color_buffer_float). */
  floatTargets: boolean;
}

export function gpuCaps(has: (extension: string) => boolean): GpuCaps {
  const floatTargets = has('EXT_color_buffer_float');
  return { floatTargets, halfFloatTargets: floatTargets || has('EXT_color_buffer_half_float') };
}

/** Slow Light draws into a half-float cube map; Big ħ keeps its wave in 32-bit float textures; Big G draws straight to the screen. */
const NEEDS: Record<string, { target: keyof GpuCaps; what: string; extension: string; world: string } | undefined> = {
  'slow-light': { target: 'halfFloatTargets', what: '16-bit floating-point textures', extension: 'EXT_color_buffer_half_float', world: 'Slow Light' },
  'big-hbar': { target: 'floatTargets', what: '32-bit floating-point textures', extension: 'EXT_color_buffer_float', world: 'Big ħ' },
};

/** Why world `id` cannot run on these capabilities, in words for a visitor, or null if it can. */
export function unsupported(id: string, caps: GpuCaps): string | null {
  const need = NEEDS[id];
  if (!need || caps[need.target]) return null;
  return `${need.world} cannot run on this device: it needs to render into ${need.what} (${need.extension}), which this browser does not offer. The other worlds may still open. An up-to-date Chrome or Firefox, or a Mac or PC with a recent graphics card, will run all three.`;
}
