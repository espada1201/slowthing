import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cameraRotation, seeded, viewPoint, viewRay } from '../src/worlds/shared';

const deg = Math.PI / 180;
const camera = (yaw: number, pitch: number, tanX: number, tanY: number) => ({ rot: cameraRotation(yaw, pitch), tan: new THREE.Vector2(tanX, tanY) });

describe('view rays, cast as the shaders cast them', () => {
  const view = camera(0.7, -0.3, Math.tan(50 * deg), Math.tan(37.5 * deg));
  const ahead = new THREE.Vector3(0, 0, -1).applyMatrix3(view.rot);

  it('look straight ahead from the middle and out at half the field of view from the edges', () => {
    expect(viewRay(view, 0.5, 0.5).angleTo(ahead)).toBeLessThan(1e-12);
    expect(viewRay(view, 1, 0.5).angleTo(ahead) / deg).toBeCloseTo(50, 10);
    expect(viewRay(view, 0.5, 0).angleTo(ahead) / deg).toBeCloseTo(37.5, 10);
    // v counts up from the bottom of the view: with the camera level, its top looks up.
    const level = camera(2, 0, 1, 1);
    expect(viewRay(level, 0.5, 1).y).toBeGreaterThan(0.7);
    expect(viewRay(level, 1, 0.5).y).toBeCloseTo(0, 12);
  });

  it('lead back to the point of the view they were cast through', () => {
    const rand = seeded(7);
    for (let i = 0; i < 200; i++) {
      const v = camera(rand() * 7, rand() * 3 - 1.5, 0.3 + rand(), 0.3 + rand());
      const [u, w] = [rand(), rand()];
      const p = viewPoint(v, viewRay(v, u, w))!;
      expect(Math.abs(p.x - u) + Math.abs(p.y - w)).toBeLessThan(1e-12);
    }
  });

  it('put directions behind the camera nowhere on the view', () => {
    expect(viewPoint(view, ahead.clone().negate())).toBeNull();
    expect(viewPoint(view, ahead)).not.toBeNull();
  });

  it('give the angle between two points of a pinhole view, whichever way the camera turns', () => {
    // Points a fifth of the way in from the left and right edges, on the middle row: ±0.6 tanX either side of ahead.
    const expected = 2 * Math.atan(0.6 * Math.tan(50 * deg));
    for (const [yaw, pitch] of [[0, 0], [1.2, 0.9], [-2.5, -1.4]]) {
      const v = camera(yaw, pitch, Math.tan(50 * deg), Math.tan(37.5 * deg));
      expect(viewRay(v, 0.2, 0.5).angleTo(viewRay(v, 0.8, 0.5))).toBeCloseTo(expected, 12);
    }
  });
});
