// What this browser's GPU can render into, and which worlds that leaves open. Some devices (older iPhones) render to
// 16-bit float textures but not 32-bit ones. The worlds read every 32-bit table with texelFetch from a nearest-filtered
// texture, so only the render targets matter.

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
  return `${need.world} cannot run on this device: it draws into ${need.what} (${need.extension}), and this browser does not offer them. Other worlds may still open. Chrome or Firefox on a recent computer should run all three.`;
}
