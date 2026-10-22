import { describe, expect, it } from 'vitest';
import { DETECTOR_RESOLUTION, DETECTOR_SIGMA, FIELD, HALF, OBSTACLE_Z, cellCentre, cellIndex } from '../src/worlds/courtyard';
import { analyse, collapsed, sampleCell, wavevector } from '../src/worlds/waveAnalysis';

const n = 256, dx = FIELD / n;

interface Packet {
  x: number;
  z: number;
  sigma: number;
  k?: [number, number];
  share?: number;
}

/** A read-back of round Gaussian packets on the coarsest grid: each |ψ|² normal about (x, z) with σ, holding `share` of the ball. */
function readback(...packets: Packet[]) {
  const buffer = new Float32Array(n * n * 4);
  for (const { x: x0, z: z0, sigma, k: [kx, kz] = [0, 0], share = 1 } of packets) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = cellCentre(i, dx), z = cellCentre(j, dx), c = (j * n + i) * 4;
        const amp = Math.sqrt((share * Math.exp(-((x - x0) ** 2 + (z - z0) ** 2) / (2 * sigma * sigma))) / (2 * Math.PI * sigma * sigma));
        buffer[c] += amp * Math.cos(kx * x + kz * z);
        // Im ψ half a step after and half a step before: the same, for a wave held still.
        buffer[c + 1] += amp * Math.sin(kx * x + kz * z);
        buffer[c + 2] += amp * Math.sin(kx * x + kz * z);
      }
    }
  }
  return { n, dx, buffer };
}

describe('reading the courtyard wave back', () => {
  it('finds the ball where it is on the floor, as wide as it is', () => {
    const st = analyse(readback({ x: 3, z: 5, sigma: 1 }));
    expect(st.inField).toBeCloseTo(1, 5);
    expect(st.x).toBeCloseTo(3, 5);
    expect(st.z).toBeCloseTo(5, 5);
    // √(Δx² + Δz²) of a round Gaussian is √2 σ.
    expect(st.spread).toBeCloseTo(Math.SQRT2, 5);
    expect(st.beyond).toBeLessThan(1e-9);
  });

  it('counts what the walls have taken, and what is past the obstacle on the floor or absorbed there', () => {
    // Half the ball still in front of the obstacle, a fifth on the floor past it, and the rest caught by the far wall.
    const rb = readback({ x: 3, z: 5, sigma: 1, share: 0.5 }, { x: -2, z: -15, sigma: 1, share: 0.2 });
    rb.buffer[(cellIndex(-23, dx, n) * n + cellIndex(0, dx, n)) * 4 + 3] = 0.3;
    const st = analyse(rb);
    expect(st.inField).toBeCloseTo(0.7, 5);
    expect(st.absorbed).toBeCloseTo(0.3, 6);
    expect(st.beyondOnFloor).toBeCloseTo(0.2, 5);
    expect(st.beyond).toBeCloseTo(0.5, 5);
  });

  it('reads the mean wavevector from the phase, over the cells asked about', () => {
    const [kx, kz] = wavevector(readback({ x: 16, z: 5, sigma: 1.5, k: [0.5, -6.4] }));
    expect(kx).toBeCloseTo(0.5, 4);
    expect(kz).toBeCloseTo(-6.4, 4);
    // Part of the ball past the glass, heading on along another k: read from the cells past the obstacle alone.
    const through = readback({ x: 16, z: 5, sigma: 1.5, k: [0.5, -6.4], share: 0.7 }, { x: 16, z: -16, sigma: 1.5, k: [0, -6.6], share: 0.3 });
    const past = wavevector(through, (_, j) => cellCentre(j, dx) < OBSTACLE_Z);
    expect(past[0]).toBeCloseTo(0, 4);
    expect(past[1]).toBeCloseTo(-6.6, 4);
  });

  it('draws a cell only where there is wave', () => {
    const rb = { n, dx, buffer: new Float32Array(n * n * 4) };
    expect(sampleCell(rb)).toBeNull();
    const k = 37 * n + 12;
    rb.buffer[k * 4] = 0.5;
    expect(sampleCell(rb)).toEqual([cellCentre(12, dx), cellCentre(37, dx), k]);
  });

  it('leaves a lump no wider than the detector’s resolution where the detector catches a wide wave', () => {
    const sigma = 4, rb = readback({ x: 0, z: 5, sigma });
    // The detector fires at the middle of the wave: the spot and its response in cells (cell i is centred on i).
    const lump = collapsed(rb, HALF / dx - 0.5, (5 + HALF) / dx - 0.5, DETECTOR_SIGMA / dx)!;
    // |ψ|² times the response is a round Gaussian with 1/s² = 1/σ² + 1/σ_d², holding s²/σ² of the ball.
    const s2 = 1 / (1 / sigma ** 2 + 1 / DETECTOR_SIGMA ** 2);
    expect(lump.norm / (s2 / sigma ** 2)).toBeCloseTo(1, 5);
    expect(lump.stats.x).toBeCloseTo(0, 5);
    expect(lump.stats.z).toBeCloseTo(5, 5);
    expect(lump.stats.spread).toBeCloseTo(Math.sqrt(2 * s2), 5);
    expect(lump.stats.spread).toBeLessThanOrEqual(DETECTOR_RESOLUTION);
    // Far from the wave there is nothing to catch.
    expect(collapsed(rb, 10, 10, DETECTOR_SIGMA / dx)).toBeNull();
  });
});
