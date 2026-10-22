import type * as THREE from 'three';
import type { ConstantKey, Constants } from '../constants';
import type { InputState } from '../input';

export type Quality = 'low' | 'medium' | 'high';

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

export interface TourStop {
  title: string;
  text: string;
  pose?: Pose;
  constants?: Partial<Constants>;
  toggles?: Record<string, boolean>;
  /** World-specific action run when the stop is shown (e.g. start cruising, throw a ball). */
  action?: string;
  /** Predict-observe-explain: ask before showing, then reveal. */
  predict?: Prediction;
}

interface Prediction {
  question: string;
  options: string[];
  answer: number;
  reveal: string;
}

interface WorldAction {
  id: string;
  label: string;
  key: string;
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
  dispose(): void;
}
