import type * as THREE from 'three';
import type { ConstantKey, Constants } from '../constants';
import type { InputState } from '../input';

export type Quality = 'low' | 'medium' | 'high';
/** What the visitor picked: a preset, or Auto to follow the frame rate. */
export type QualitySetting = Quality | 'auto';

export interface Toggle {
  id: string;
  label: string;
  hint: string;
  value: boolean;
}

export interface Readout {
  label: string;
  value: string;
  /** 0..1 fill for an analogue bar, if meaningful. */
  gauge?: number;
}

export interface Pose {
  position: [number, number, number];
  yaw: number;
  pitch: number;
}

/** A frame's camera, as the shaders take it (uCamRot, uTan): see viewRay in shared.ts. */
export interface View {
  rot: THREE.Matrix3;
  tan: THREE.Vector2;
}

export interface TourStop {
  title: string;
  text: string;
  pose?: Pose;
  constants?: Partial<Constants>;
  toggles?: Record<string, boolean>;
  /**
   * World-specific action run when the stop is shown (e.g. start cruising, throw a ball). When the visitor asks for
   * reduced motion, an action that sets things moving waits for a tap on the stop's Start button instead.
   */
  action?: string;
  /** Predict-observe-explain: ask before showing, then reveal. */
  predict?: Prediction;
  /** Measure something and work numbers out from it; the true values show once the visitor has answered. */
  measure?: Measurement;
}

interface Prediction {
  question: string;
  options: string[];
  answer: number;
  reveal: string;
}

interface Measurement {
  question: string;
  /** How to get there, one step to a line. */
  steps: string[];
  /** Readouts that stay up while the visitor works: the others would give the answer away. */
  given: string[];
  /** What to work out, in order, e.g. { symbol: 'rs', unit: 'm' }. */
  asks: { symbol: string; unit: string }[];
  /** The true values, in the order asked, and one or two sentences giving them and how they follow; read on answering. */
  answer(): { values: number[]; reveal: string };
}

interface WorldAction {
  id: string;
  label: string;
  key: string;
  /** Only brings things to rest: a tour stop runs it at once even under reduced motion, and in place of one that waits. */
  calm?: boolean;
}

export interface WorldContext {
  renderer: THREE.WebGLRenderer;
  constants: Constants;
  quality: Quality;
}

export interface World {
  readonly id: string;
  readonly title: string;
  readonly dials: ConstantKey[];
  readonly preset: Partial<Constants>;
  readonly toggles: Toggle[];
  readonly tour: TourStop[];
  readonly actions: WorldAction[];
  readonly start: Pose;
  /** Advance the simulation by dt real seconds (the player's proper time) and draw a frame. */
  frame(dt: number, input: InputState, ctx: WorldContext): void;
  readouts(ctx: WorldContext): Readout[];
  setPose(pose: Pose): void;
  runAction(id: string, ctx: WorldContext): void;
  setQuality(q: Quality, ctx: WorldContext): void;
  /** Optional status line (e.g. "classical regime"), shown under the readouts. */
  status(ctx: WorldContext): string;
  /** The camera of the last frame drawn, for the sky ruler; a world without it has no ruler. */
  view?(): View;
  /** Whether your own speed is warping the whole view, when a fixed level reticle gives the eye a steady reference. */
  warping?(ctx: WorldContext): boolean;
  dispose(): void;
}
