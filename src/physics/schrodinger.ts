// Time-dependent Schrödinger equation on a 2D grid, Visscher's staggered leapfrog scheme
// (Computers in Physics 5, 596, 1991). Re ψ lives on integer steps, Im ψ on half steps, and the
// discrete probability R(t)² + I(t−½)·I(t+½) is conserved exactly. The GPU solver runs the same
// update in fragment shaders; this CPU version is the reference the tests check against physics.

export interface GridSpec {
  nx: number;
  ny: number;
  dx: number;
  /** Periodic wrap in y (for effectively one-dimensional tests); otherwise ψ = 0 outside the grid. */
  periodicY?: boolean;
  /** Laplacian stencil: 2 = five-point (default), 4 = fourth-order nine-point (far less lattice dispersion). */
  stencil?: 2 | 4;
}

export interface Particle {
  mass: number;
  hbar: number;
}

/** Largest stable step: the spectrum of H must fit inside 2ħ/Δt (Visscher); we keep a 2× margin. */
export function stableTimeStep(grid: GridSpec, p: Particle, vMax: number): number {
  // Largest eigenvalue of −dx²∇² per axis: 4 for the five-point stencil, 16/3 for the fourth-order one.
  const kinetic = ((grid.stencil === 4 ? 16 / 3 : 4) * p.hbar * p.hbar) / (p.mass * grid.dx * grid.dx);
  return p.hbar / (kinetic + Math.max(0, vMax));
}

export function deBroglieWavelength(p: Particle, speed: number): number {
  return (2 * Math.PI * p.hbar) / (p.mass * speed);
}

export class Schrodinger2D {
  readonly re: Float64Array;
  readonly im: Float64Array;
  /** Im ψ half a step behind `im`; with it, R² + I·I_prev is the conserved density. */
  readonly imPrev: Float64Array;
  private readonly tmp: Float64Array;
  readonly potential: Float64Array;
  /** 1 where the particle may be, 0 inside hard walls. */
  readonly open: Float64Array;
  time = 0;

  constructor(readonly grid: GridSpec, readonly particle: Particle, readonly dt: number) {
    const n = grid.nx * grid.ny;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.imPrev = new Float64Array(n);
    this.tmp = new Float64Array(n);
    this.potential = new Float64Array(n);
    this.open = new Float64Array(n).fill(1);
  }

  /** Place a Gaussian packet whose probability density has standard deviation σ, moving with wavevector k. */
  setGaussian(x0: number, y0: number, sigma: number, kx: number, ky: number) {
    const { nx, ny, dx } = this.grid;
    let norm = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = i * dx, y = j * dx;
        const r2 = (x - x0) ** 2 + (this.grid.periodicY ? 0 : (y - y0) ** 2);
        const a = Math.exp(-r2 / (4 * sigma * sigma)) * this.open[j * nx + i];
        const ph = kx * x + ky * y;
        this.re[j * nx + i] = a * Math.cos(ph);
        this.im[j * nx + i] = a * Math.sin(ph);
        norm += a * a;
      }
    }
    const s = 1 / Math.sqrt(norm * dx * dx);
    for (let k = 0; k < nx * ny; k++) {
      this.re[k] *= s;
      this.im[k] *= s;
    }
    // Stagger Im ψ to t = ±Δt/2 so the leapfrog (and its conserved norm) starts consistently.
    this.applyH(this.re, this.tmp);
    const h = this.particle.hbar;
    for (let k = 0; k < nx * ny; k++) {
      const half = (0.5 * this.dt * this.tmp[k]) / h;
      this.imPrev[k] = this.im[k] + half;
      this.im[k] -= half;
    }
    this.time = 0;
  }

  /** out = H·f with H = −ħ²/2m ∇² + V and hard walls / outer boundary held at zero. */
  private applyH(f: Float64Array, out: Float64Array) {
    const { nx, ny, dx, periodicY } = this.grid;
    const kin = (this.particle.hbar * this.particle.hbar) / (2 * this.particle.mass * dx * dx);
    if (this.grid.stencil === 4) {
      // 12 dx² ∇²f = 16 Σ(nearest) − Σ(next-nearest) − 60 f, the stencil the GPU solver uses.
      const at = (i: number, j: number) => {
        if (i < 0 || i >= nx) return 0;
        if (j < 0 || j >= ny) {
          if (!periodicY) return 0;
          j = (j + ny) % ny;
        }
        return f[j * nx + i];
      };
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const c = f[k];
          const near = at(i - 1, j) + at(i + 1, j) + at(i, j - 1) + at(i, j + 1);
          const far = at(i - 2, j) + at(i + 2, j) + at(i, j - 2) + at(i, j + 2);
          out[k] = ((-kin / 12) * (16 * near - far - 60 * c) + this.potential[k] * c) * this.open[k];
        }
      }
      return;
    }
    for (let j = 0; j < ny; j++) {
      const jm = j > 0 ? j - 1 : periodicY ? ny - 1 : -1;
      const jp = j < ny - 1 ? j + 1 : periodicY ? 0 : -1;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const c = f[k];
        const l = i > 0 ? f[k - 1] : 0;
        const r = i < nx - 1 ? f[k + 1] : 0;
        const d = jm >= 0 ? f[jm * nx + i] : 0;
        const u = jp >= 0 ? f[jp * nx + i] : 0;
        out[k] = (-kin * (l + r + d + u - 4 * c) + this.potential[k] * c) * this.open[k];
      }
    }
  }

  step(n = 1) {
    const h = this.particle.hbar;
    const N = this.re.length;
    for (let s = 0; s < n; s++) {
      this.applyH(this.im, this.tmp);
      for (let k = 0; k < N; k++) this.re[k] += (this.dt * this.tmp[k]) / h;
      this.imPrev.set(this.im);
      this.applyH(this.re, this.tmp);
      for (let k = 0; k < N; k++) this.im[k] -= (this.dt * this.tmp[k]) / h;
      this.time += this.dt;
    }
  }

  /** Probability density |ψ|² at the current integer step (Visscher's conserved definition). */
  density(): Float64Array {
    const d = new Float64Array(this.re.length);
    for (let k = 0; k < d.length; k++) d[k] = this.re[k] * this.re[k] + this.im[k] * this.imPrev[k];
    return d;
  }

  norm(): number {
    const d = this.density();
    let s = 0;
    for (let k = 0; k < d.length; k++) s += d[k];
    return s * this.grid.dx * this.grid.dx;
  }

  /** Mean and standard deviation of x and y. */
  moments() {
    const { nx, dx } = this.grid;
    const d = this.density();
    let m = 0, mx = 0, my = 0, mxx = 0, myy = 0;
    for (let k = 0; k < d.length; k++) {
      const x = (k % nx) * dx, y = Math.floor(k / nx) * dx;
      m += d[k];
      mx += d[k] * x;
      my += d[k] * y;
      mxx += d[k] * x * x;
      myy += d[k] * y * y;
    }
    mx /= m;
    my /= m;
    return { x: mx, y: my, sx: Math.sqrt(mxx / m - mx * mx), sy: Math.sqrt(myy / m - my * my) };
  }
}

/** Analytic transmission probability through a rectangular barrier of height V0 and width a. */
export function barrierTransmission(E: number, V0: number, a: number, p: Particle): number {
  const { mass: m, hbar: h } = p;
  if (Math.abs(E - V0) < 1e-12 * V0) return 1 / (1 + (m * a * a * V0) / (2 * h * h));
  if (E < V0) {
    const kappa = Math.sqrt(2 * m * (V0 - E)) / h;
    return 1 / (1 + (V0 * V0 * Math.sinh(kappa * a) ** 2) / (4 * E * (V0 - E)));
  }
  const k2 = Math.sqrt(2 * m * (E - V0)) / h;
  return 1 / (1 + (V0 * V0 * Math.sin(k2 * a) ** 2) / (4 * E * (E - V0)));
}

/** Free-particle Gaussian width: σ(t) = σ₀ √(1 + (ħt / 2mσ₀²)²). */
export function freeSpreadWidth(sigma0: number, t: number, p: Particle): number {
  return sigma0 * Math.sqrt(1 + ((p.hbar * t) / (2 * p.mass * sigma0 * sigma0)) ** 2);
}

/**
 * Average of f(k) over the wavenumbers of a Gaussian packet whose |ψ|² has standard deviation σ: they are
 * normally distributed about k₀ with standard deviation 1/(2σ).
 */
export function packetAverage(k0: number, sigma: number, f: (k: number) => number): number {
  const sk = 1 / (2 * sigma);
  let num = 0, den = 0;
  for (let i = -1600; i <= 1600; i++) {
    const q = i / 200, w = Math.exp(-0.5 * q * q);
    num += w * f(k0 + q * sk);
    den += w;
  }
  return num / den;
}

/**
 * Mean wavevector [kx, ky] of the part of ψ in the cells `inside` picks, from the phase step between neighbours:
 * arg Σ ψ*(r) ψ(r + dx) / dx along each axis. That sum is the momentum distribution's characteristic function at dx,
 * so its phase is the mean k·dx, short only by the distribution's skew times dx²/6. A plane wave reads exactly k even
 * at five cells to the wavelength, where a central-difference current reads sin(k dx)/dx, 22% short.
 */
export function meanWavevector(
  grid: { nx: number; ny: number; dx: number },
  re: (k: number) => number,
  im: (k: number) => number,
  inside: (i: number, j: number) => boolean,
): [number, number] {
  const { nx, ny, dx } = grid;
  let xr = 0, xi = 0, yr = 0, yi = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!inside(i, j)) continue;
      const k = j * nx + i, a = re(k), b = im(k);
      if (i + 1 < nx && inside(i + 1, j)) {
        const c = re(k + 1), d = im(k + 1);
        xr += a * c + b * d;
        xi += a * d - b * c;
      }
      if (j + 1 < ny && inside(i, j + 1)) {
        const c = re(k + nx), d = im(k + nx);
        yr += a * c + b * d;
        yi += a * d - b * c;
      }
    }
  }
  return [Math.atan2(xi, xr) / dx, Math.atan2(yi, yr) / dx];
}

/** Running totals of a weight over cells, negative weights counting as zero: the distribution sampleIndex draws from. */
export function cumulative(cells: number, weight: (k: number) => number): Float64Array {
  const cdf = new Float64Array(cells);
  let acc = 0;
  for (let k = 0; k < cells; k++) cdf[k] = acc += Math.max(0, weight(k));
  return cdf;
}

/**
 * Draw a cell from running totals (inverse-CDF sampling, by bisection): for u uniform on [0, 1), cell k comes
 * up with probability weight/total, so a cell of zero weight never does. The total must be positive.
 */
export function sampleIndex(cdf: ArrayLike<number>, u: number): number {
  const target = u * cdf[cdf.length - 1];
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] > target) hi = mid;
    else lo = mid + 1;
  }
  // u = 1 lands past the end: step back onto the last cell that has weight.
  while (lo > 0 && cdf[lo] === cdf[lo - 1]) lo--;
  return lo;
}

/** e(s) for the cells s = −3/2, −1/2, 1/2, 3/2 cells from a face; see correctSteps. */
const STEP_ERROR = [-1, 7, -7, 1].map((v) => v / 96);

/**
 * A potential with sharp steps, corrected for the fourth-order stencil. Across a step ΔV the true ψ″ jumps by
 * (2m/ħ²)ΔVψ; the stencil smears that jump over the two cells either side of the face, as if they held an extra
 * potential −e(s)ΔV. Its effect only falls as dx², and on a coarse grid it cuts tunnelling through a two-cell
 * barrier by a fifth, so add e(s)ΔV back. Only faces between open cells count, and only open cells change.
 */
export function correctSteps(v: ArrayLike<number>, open: ArrayLike<number>, nx: number, ny: number): Float64Array {
  const out = Float64Array.from(v);
  const add = (i: number, j: number, dv: number) => {
    if (i >= 0 && i < nx && j >= 0 && j < ny && open[j * nx + i]) out[j * nx + i] += dv;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!open[k]) continue;
      // The steps up to the next cell along x and along y.
      const sx = i + 1 < nx && open[k + 1] ? v[k + 1] - v[k] : 0;
      const sy = j + 1 < ny && open[k + nx] ? v[k + nx] - v[k] : 0;
      for (let q = 0; q < 4; q++) {
        if (sx) add(i - 1 + q, j, STEP_ERROR[q] * sx);
        if (sy) add(i, j - 1 + q, STEP_ERROR[q] * sy);
      }
    }
  }
  return out;
}
