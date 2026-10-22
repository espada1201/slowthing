// World I's shaders with the shared GLSL they need prepended: the world draws with these and the Proofs screen
// tests the very same sources.
import { TABLES_GLSL } from '../physics/skylight';
import boost from '../shaders/boost.glsl?raw';
import common from '../shaders/common.glsl?raw';
import reflect from '../shaders/reflect.glsl?raw';
import compositeFrag from '../shaders/slow-composite.frag?raw';
import movingVert from '../shaders/slow-moving.vert?raw';
import surfaceFrag from '../shaders/slow-surface.frag?raw';

/** The composite pass (fullscreenPass prepends common.glsl). */
export const compositeFragment = `${boost}\n${compositeFrag}`;
export const movingVertex = `${boost}\n${movingVert}`;
/** slow-surface.frag for moving objects: compile with the MOVING define. */
export const movingFragment = `${TABLES_GLSL}\n${common}\n${reflect}\n${surfaceFrag}`;
