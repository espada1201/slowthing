// World I's shaders with the shared GLSL they need prepended: the world draws with these and the Proofs screen
// tests the very same sources.
import { knotUniforms, skyUniforms } from '../lut';
import { TABLES_GLSL } from '../physics/skylight';
import boost from '../shaders/boost.glsl?raw';
import common from '../shaders/common.glsl?raw';
import noise from '../shaders/noise.glsl?raw';
import reflect from '../shaders/reflect.glsl?raw';
import compositeFrag from '../shaders/slow-composite.frag?raw';
import groundFrag from '../shaders/slow-ground.frag?raw';
import movingFrag from '../shaders/slow-moving.frag?raw';
import movingVert from '../shaders/slow-moving.vert?raw';
import skyFrag from '../shaders/slow-sky.frag?raw';
import staticFrag from '../shaders/slow-static.frag?raw';
import surface from '../shaders/slow-surface.glsl?raw';

/** The composite pass (fullscreenPass prepends common.glsl). */
export const compositeFragment = `${boost}\n${compositeFrag}`;
export const skyFragment = `${noise}\n${skyFrag}`;
export const groundFragment = `${noise}\n${groundFrag}`;
export const staticFragment = `${surface}\n${staticFrag}`;
export const movingVertex = `${boost}\n${movingVert}`;
export const movingFragment = `${TABLES_GLSL}\n${common}\n${reflect}\n${surface}\n${movingFrag}`;
/** The tables movingFragment reads. */
export const movingUniforms = () => ({ ...knotUniforms(), ...skyUniforms() });
