// World I's Measured view: a map of the town at your now, in your own frame, and a spacetime diagram along your
// motion. Seen (the 3D view) answers "what light reaches me now?"; this answers "where is everything, and what does
// every clock read, at my now?".

import { retardedTime } from '../physics/relativity';
import { type Observer, inYourFrame, nowAt, simultaneousTime } from '../physics/simultaneity';
import { type Vec3, dot, len, scale } from '../physics/vec';

/** Metres in your frame, relative to you: [to your right, ahead]. The map is drawn heading-up. */
export type MapPoint = [number, number];
/** [distance along your motion in your frame (m), your time (s)]. */
export type DiagramPoint = [number, number];

/** Something circling the town centre as slow-moving.vert draws it: angle phase + omega·t at town time t. */
export interface Rider {
  radius: number;
  phase: number;
  /** rad/s; the sign is the direction. */
  omega: number;
  /** Length along the track per metre of the object's own length: 1/γ, or 1 with Contraction off. */
  squash: number;
}

export interface Town {
  /** Footprints of buildings, columns, the tower and the carousel hub: [minX, minZ, maxX, maxZ]. */
  blocks: [number, number, number, number][];
  clocks: { id: string; at: Vec3 }[];
  trams: Rider[];
  lamps: Rider[];
  /** The lamps' Lorentz factor: each flashes once per `blink` seconds of its own time, which is town time / γ. */
  lampGamma: number;
  blink: number;
}

export interface MapClock {
  id: string;
  at: MapPoint;
  /** Town time it reads at your now, and the town time its light now reaching you shows, in seconds. */
  reads: number;
  seen: number;
}

export interface Worldline {
  id: string;
  points: DiagramPoint[];
  /** Where it crosses your now (Measured) and your past light cone (Seen). */
  now: DiagramPoint;
  seen: DiagramPoint;
  /** Metres beside your line of motion at the farther of those two events: a 1+1 diagram cannot place what is far off it. */
  aside: number;
}

export interface MeasuredModel {
  /** Your speed / c, and your direction of motion on the map (null when still). */
  beta: number;
  motion: MapPoint | null;
  /** Which way town north lies on the map. */
  north: MapPoint;
  blocks: MapPoint[][];
  track: MapPoint[];
  /** Each tram car at your now: its four corners, and its length along the track in metres. */
  trams: { corners: MapPoint[]; length: number }[];
  /** Each lamp at your now, and what its own clock reads then: it flashes as that passes each multiple of `blink`. */
  lamps: { at: MapPoint; tau: number }[];
  blink: number;
  clocks: MapClock[];
  worldlines: Worldline[];
}

const CAR_HALF: [number, number] = [3.6, 1.25];
const LAMP_HEIGHT = 3;

/** A point fixed to a rider: `local` is (along the track, up, outward), as slow-moving.vert's pathPos takes it. */
export function ride(r: Rider, local: Vec3) {
  const dir = Math.sign(r.omega) || 1, out = r.radius + local[2], along = local[0] * r.squash;
  const axes = (s: number) => {
    const a = r.phase + r.omega * s;
    return { radial: [Math.cos(a), Math.sin(a)], forward: [-dir * Math.sin(a), dir * Math.cos(a)] };
  };
  return {
    path: (s: number): Vec3 => {
      const { radial, forward } = axes(s);
      return [radial[0] * out + forward[0] * along, local[1], radial[1] * out + forward[1] * along];
    },
    velocity: (s: number): Vec3 => {
      const { radial, forward } = axes(s), w = Math.abs(r.omega);
      return [w * (out * forward[0] - along * radial[0]), 0, w * (out * forward[1] - along * radial[1])];
    },
  };
}

/** Everything the Measured view shows, for an observer `o` looking along `yaw`. */
export function measure(town: Town, o: Observer, yaw: number, c: number): MeasuredModel {
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)], ahead: Vec3 = [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const b = len(o.beta);
  const axis = b > 1e-3 ? scale(o.beta, 1 / b) : ahead;
  const toMap = (v: Vec3): MapPoint => [dot(v, right), dot(v, ahead)];
  /** A town event on your now, placed on the map. */
  const onMap = (t: number, x: Vec3) => toMap(inYourFrame(o, t, x, c).x);
  const still = (x: Vec3) => onMap(nowAt(o, x, c), x);
  const moving = (r: Rider, local: Vec3) => {
    const { path, velocity } = ride(r, local);
    const s = simultaneousTime(path, velocity, o, c);
    return { s, at: onMap(s, path(s)) };
  };
  const across: Vec3 = [axis[2], 0, -axis[0]];
  const diagram = (t: number, x: Vec3): DiagramPoint => {
    const e = inYourFrame(o, t, x, c);
    return [dot(e.x, axis), e.t];
  };
  const aside = (...events: [number, Vec3][]) => Math.max(...events.map(([t, x]) => Math.abs(dot(inYourFrame(o, t, x, c).x, across))));

  const clocks = town.clocks.map(({ id, at }) => ({ id, at: still(at), reads: nowAt(o, at, c), seen: o.t - len([at[0] - o.x[0], at[1] - o.x[1], at[2] - o.x[2]]) / c }));
  const worldlines: Worldline[] = town.clocks.map(({ id, at }, i) => {
    // A town clock moves in a straight line through your frame; two events far apart draw it.
    const reach = 400 / c;
    const { reads, seen } = clocks[i];
    return { id, points: [diagram(o.t - reach, at), diagram(o.t + reach, at)], now: diagram(reads, at), seen: diagram(seen, at), aside: aside([reads, at], [seen, at]) };
  });
  town.trams.slice(0, 1).forEach((r) => {
    const { path, velocity } = ride(r, [0, 1.2, 0]);
    const s = simultaneousTime(path, velocity, o, c), tr = retardedTime(path, velocity, o.x, o.t, c);
    const span = (2 * 400) / c;
    const points = Array.from({ length: 97 }, (_, k) => diagram(s + span * (k / 48 - 1), path(s + span * (k / 48 - 1))));
    worldlines.push({ id: 'tram', points, now: diagram(s, path(s)), seen: diagram(tr, path(tr)), aside: aside([s, path(s)], [tr, path(tr)]) });
  });

  return {
    beta: b,
    motion: b > 1e-3 ? toMap(axis) : null,
    north: toMap([0, 0, -1]),
    blocks: town.blocks.map(([x0, z0, x1, z1]) => [still([x0, 0, z0]), still([x1, 0, z0]), still([x1, 0, z1]), still([x0, 0, z1])]),
    track: town.trams.length
      ? Array.from({ length: 65 }, (_, k) => still([town.trams[0].radius * Math.cos((k / 32) * Math.PI), 0, town.trams[0].radius * Math.sin((k / 32) * Math.PI)]))
      : [],
    trams: town.trams.map((r) => {
      const [front, back] = [1, -1].map((f) => moving(r, [f * CAR_HALF[0], 1.2, 0]).at);
      return {
        corners: [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, s]) => moving(r, [f * CAR_HALF[0], 1.2, s * CAR_HALF[1]]).at),
        length: Math.hypot(front[0] - back[0], front[1] - back[1]),
      };
    }),
    lamps: town.lamps.map((r) => {
      const { s, at } = moving(r, [0, LAMP_HEIGHT, 0]);
      return { at, tau: s / town.lampGamma };
    }),
    blink: town.blink,
    clocks,
    worldlines,
  };
}
