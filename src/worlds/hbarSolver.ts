// The courtyard wave on the GPU: Visscher leapfrog in fragment shaders, ping-ponging float textures.

import * as THREE from 'three';
import { Schrodinger2D, type Particle, correctSteps, stableTimeStep } from '../physics/schrodinger';
import fullscreenVert from '../shaders/fullscreen.vert?raw';
import copyFrag from '../shaders/hbar-copy.frag?raw';
import stepFrag from '../shaders/hbar-step.frag?raw';
import type { Field } from './courtyard';
import { readBack } from './shared';

const floatTarget = (n: number) =>
  new THREE.WebGLRenderTarget(n, n, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });

export class GpuSchrodinger {
  readonly n: number;
  readonly dx: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private potTex: THREE.DataTexture;
  private upload: THREE.DataTexture;
  private stepMat: THREE.ShaderMaterial;
  private copyMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  /** The last state read back (or loaded). */
  readonly buffer: Float32Array;
  /** V per cell as the stencil sees it: the floor plan's, with its steps corrected (physics/schrodinger.ts). */
  readonly v: Float64Array;
  /** A read-back on its way: the GPU copies the state into `pbo` in its own time and signals `fence`. */
  private pbo: WebGLBuffer | null = null;
  private fence: WebGLSync | null = null;

  constructor(field: Field) {
    const n = (this.n = field.n);
    this.dx = field.dx;
    this.targets = [floatTarget(n), floatTarget(n)];
    this.v = correctSteps(field.potential, field.open, n, n);
    const pot = new Float32Array(n * n * 4);
    for (let k = 0; k < n * n; k++) {
      pot[k * 4] = this.v[k];
      pot[k * 4 + 1] = field.open[k];
      pot[k * 4 + 2] = field.sponge[k];
      pot[k * 4 + 3] = field.potential[k];
    }
    this.potTex = new THREE.DataTexture(pot, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.potTex.needsUpdate = true;
    this.buffer = new Float32Array(n * n * 4);
    this.upload = new THREE.DataTexture(this.buffer, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.stepMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: stepFrag,
      uniforms: {
        uState: { value: null },
        uPot: { value: this.potTex },
        uN: { value: n },
        uPass: { value: 0 },
        uKin: { value: 0 },
        uDtH: { value: 0 },
        uDt: { value: 0 },
        uCell: { value: this.dx * this.dx },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: copyFrag,
      uniforms: { uSrc: { value: null }, uCentre: { value: new THREE.Vector2() }, uSigma: { value: 0 }, uScale: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g, this.stepMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Potential texture: r = V the wave sees, g = open floor (1) or wall (0), b = absorption rate, a = V as drawn. */
  get potential() {
    return this.potTex;
  }

  /** The current state texture (r = Re ψ, g = Im ψ(t+½), b = Im ψ(t−½), a = absorbed probability). */
  get texture() {
    return this.targets[this.current].texture;
  }

  private draw(r: THREE.WebGLRenderer, mat: THREE.ShaderMaterial) {
    this.quad.material = mat;
    const next = this.targets[1 - this.current];
    r.setRenderTarget(next);
    r.render(this.scene, this.camera);
    this.current = 1 - this.current;
  }

  /** Advance `steps` leapfrog steps of size dt for a particle of the given mass and ħ. */
  step(r: THREE.WebGLRenderer, steps: number, dt: number, p: Particle) {
    const u = this.stepMat.uniforms;
    u.uKin.value = (p.hbar * p.hbar) / (2 * p.mass * this.dx * this.dx) / 12;
    u.uDtH.value = dt / p.hbar;
    u.uDt.value = dt;
    for (let s = 0; s < steps; s++) {
      for (const pass of [0, 1]) {
        u.uPass.value = pass;
        u.uState.value = this.texture;
        this.draw(r, this.stepMat);
      }
    }
    r.setRenderTarget(null);
  }

  /** Replace the state with Re ψ, Im ψ(t+½), Im ψ(t−½) from the CPU (absorbed probability reset). */
  load(r: THREE.WebGLRenderer, re: ArrayLike<number>, im: ArrayLike<number>, imPrev: ArrayLike<number>) {
    this.dropRead(r);
    const b = this.buffer;
    for (let k = 0; k < this.n * this.n; k++) {
      b[k * 4] = re[k];
      b[k * 4 + 1] = im[k];
      b[k * 4 + 2] = imPrev[k];
      b[k * 4 + 3] = 0;
    }
    this.upload.needsUpdate = true;
    this.copyMat.uniforms.uSrc.value = this.upload;
    this.copyMat.uniforms.uSigma.value = 0;
    this.draw(r, this.copyMat);
    r.setRenderTarget(null);
  }

  clear(r: THREE.WebGLRenderer) {
    this.dropRead(r);
    const prev = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    for (const t of this.targets) {
      r.setRenderTarget(t);
      r.clear(true, false, false);
    }
    r.setRenderTarget(null);
    r.setClearColor(prev, alpha);
  }

  /** Multiply ψ by a Gaussian window (std σ cells for |ψ|²) centred at (ci, cj) in cells, which need not be whole, and rescale it. */
  collapse(r: THREE.WebGLRenderer, ci: number, cj: number, sigmaCells: number, scale: number) {
    this.dropRead(r);
    const u = this.copyMat.uniforms;
    u.uSrc.value = this.texture;
    u.uCentre.value.set(ci, cj);
    u.uSigma.value = sigmaCells;
    u.uScale.value = scale;
    this.draw(r, this.copyMat);
    r.setRenderTarget(null);
  }

  /** Read the state back into `buffer` (RGBA per cell, row j = z), waiting for the GPU: for one-off checks only. */
  read(r: THREE.WebGLRenderer): Float32Array {
    r.readRenderTargetPixels(this.targets[this.current], 0, 0, this.n, this.n, this.buffer);
    return this.buffer;
  }

  /**
   * Start reading the state back without waiting: the GPU copies it into a pixel-pack buffer once it has
   * finished the work before it, and poll() hands it over. False while an earlier read is still on its way,
   * unless `restart`, which abandons that one for the state as it is now.
   */
  requestRead(r: THREE.WebGLRenderer, restart = false): boolean {
    if (this.fence && !restart) return false;
    this.dropRead(r);
    const gl = r.getContext() as WebGL2RenderingContext;
    if (!this.pbo) {
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.buffer.byteLength, gl.STREAM_READ);
    } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    r.setRenderTarget(this.targets[this.current]);
    gl.readPixels(0, 0, this.n, this.n, gl.RGBA, gl.FLOAT, 0);
    r.setRenderTarget(null);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return true;
  }

  /** True once the state asked for by requestRead has arrived in `buffer`; it never waits. */
  poll(r: THREE.WebGLRenderer): boolean {
    if (!this.fence) return false;
    const gl = r.getContext() as WebGL2RenderingContext;
    const status = gl.clientWaitSync(this.fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return false;
    this.dropRead(r);
    if (status === gl.WAIT_FAILED) return false;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.buffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return true;
  }

  /** Forget a read still on its way (the state it copied is being replaced). */
  private dropRead(r: THREE.WebGLRenderer) {
    if (!this.fence) return;
    (r.getContext() as WebGL2RenderingContext).deleteSync(this.fence);
    this.fence = null;
  }

  /**
   * The GL context was lost and has come back. three.js remakes its own objects, the state textures among them (empty),
   * but the read-back's buffer and fence belonged to the old context: the next read makes new ones.
   */
  contextRestored() {
    this.pbo = null;
    this.fence = null;
  }

  dispose(r: THREE.WebGLRenderer) {
    this.dropRead(r);
    if (this.pbo) (r.getContext() as WebGL2RenderingContext).deleteBuffer(this.pbo);
    this.targets.forEach((t) => t.dispose());
    this.potTex.dispose();
    this.upload.dispose();
    this.stepMat.dispose();
    this.copyMat.dispose();
    this.quad.geometry.dispose();
  }
}

/**
 * Run the GPU solver (the very shaders the courtyard uses) and the CPU reference side by side on a
 * small box with a two-cell wall, an opening and a finite barrier, and compare them value by value.
 */
function compareWithCpu(r: THREE.WebGLRenderer, steps = 300) {
  const n = 64, dx = 0.25, p = { mass: 1, hbar: 1 };
  const field: Field = { n, dx, potential: new Float32Array(n * n), open: new Float32Array(n * n).fill(1), sponge: new Float32Array(n * n) };
  for (let j = 0; j < n; j++) {
    for (const i of [40, 41]) field.open[j * n + i] = j > 26 && j < 37 ? 1 : 0;
    for (const i of [24, 25]) field.potential[j * n + i] = 4;
  }
  const grid = { nx: n, ny: n, dx, stencil: 4 as const };
  const cpu = new Schrodinger2D(grid, p, stableTimeStep(grid, p, 4));
  cpu.potential.set(correctSteps(field.potential, field.open, n, n));
  cpu.open.set(field.open);
  cpu.setGaussian(3, 8, 1, 3, 0.5);
  const normBefore = cpu.norm();
  return readBack(r, (own) => {
    const gpu = own(new GpuSchrodinger(field));
    gpu.load(r, cpu.re, cpu.im, cpu.imPrev);
    gpu.step(r, steps, cpu.dt, p);
    cpu.step(steps);
    const out = gpu.read(r);
    let maxDiff = 0, maxAmp = 0, gpuNorm = 0;
    for (let k = 0; k < n * n; k++) {
      const pairs: [number, number][] = [[out[k * 4], cpu.re[k]], [out[k * 4 + 1], cpu.im[k]], [out[k * 4 + 2], cpu.imPrev[k]]];
      for (const [g, c] of pairs) {
        maxDiff = Math.max(maxDiff, Math.abs(g - c));
        maxAmp = Math.max(maxAmp, Math.abs(c));
      }
      gpuNorm += out[k * 4] ** 2 + out[k * 4 + 1] * out[k * 4 + 2];
    }
    return { steps, relative: maxDiff / maxAmp, normBefore, gpuNorm: gpuNorm * dx * dx };
  });
}

/** Proof for the in-browser checks: the GPU wave matches the CPU physics to float32 precision. */
export async function proveSolver(r: THREE.WebGLRenderer): Promise<{ pass: boolean; measured: string; expected: string }> {
  const c = compareWithCpu(r, 400);
  const drift = Math.abs(c.gpuNorm - c.normBefore);
  const ok = Number.isFinite(c.relative) && c.relative < 1e-3 && drift < 1e-4;
  return {
    pass: ok,
    measured: `after ${c.steps} steps: max |Δψ| = ${c.relative.toExponential(1)} of max |ψ|, norm drift ${drift.toExponential(1)}`,
    expected: 'max |Δψ| < 1e-3 of max |ψ| (float32), norm drift < 1e-4',
  };
}
