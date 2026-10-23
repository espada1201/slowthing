// What this browser's GPU can render into, and which worlds that leaves open. Some devices render to 16-bit float
// textures but not 32-bit ones. The worlds read every 32-bit table with texelFetch from a nearest-filtered texture, so
// only the render targets matter. A GPU's word for it, the extension, is not enough: some advertise a format and then
// fail to complete a framebuffer with it, so each is also tried once, on a throwaway 1 x 1 texture.

export interface GpuCaps {
  /** Rendering into 16-bit float textures (EXT_color_buffer_float or EXT_color_buffer_half_float). */
  halfFloatTargets: boolean;
  /** Rendering into 32-bit float textures (EXT_color_buffer_float). */
  floatTargets: boolean;
}

type Kind = 'half' | 'float';

/** What a world needs a capability for, in words for a visitor. */
const DESCRIBED: Record<keyof GpuCaps, { what: string; extension: string }> = {
  halfFloatTargets: { what: '16-bit floating-point textures', extension: 'EXT_color_buffer_half_float' },
  floatTargets: { what: '32-bit floating-point textures', extension: 'EXT_color_buffer_float' },
};

/**
 * `extensions` says what the browser advertises (three.js's `renderer.extensions`, which also switches each one on);
 * `renders` says whether a framebuffer over a texture of that kind is really complete, and is asked only when the
 * extension is there.
 */
export function gpuCaps(extensions: { has(name: string): boolean }, renders: (kind: Kind) => boolean): GpuCaps {
  const floatTargets = extensions.has('EXT_color_buffer_float') && renders('float');
  const halfFloatTargets = (extensions.has('EXT_color_buffer_float') || extensions.has('EXT_color_buffer_half_float')) && renders('half');
  return { floatTargets, halfFloatTargets };
}

/** Whether a fresh WebGL2 context can attach a 1 x 1 float texture of this kind to a framebuffer and call it complete. */
export function canRenderInto(kind: Kind): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return false;
  try {
    // Rendering into float is only allowed once the extension has been switched on, as three.js does for the worlds.
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    const [internal, type] = kind === 'half' ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA32F, gl.FLOAT];
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 1, 1, 0, gl.RGBA, type, null);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Why `world` cannot run on these capabilities, in words for a visitor, or null if it can. */
export function unsupported(world: { title: string; needs?: keyof GpuCaps }, caps: GpuCaps): string | null {
  if (!world.needs || caps[world.needs]) return null;
  const { what, extension } = DESCRIBED[world.needs];
  return `${world.title} cannot run on this device: it draws into ${what} (${extension}), and this browser does not offer them. Other worlds may still open. Chrome or Firefox on a recent computer should run all three.`;
}
