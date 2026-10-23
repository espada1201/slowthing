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
  /** A way of looking (World I's Measured map), shown as a button beside Sound rather than among the effects. */
  view?: boolean;
  /** Part of the physics, so on in the real universe: Real universe switches it back on. */
  effect?: boolean;
}

export interface Readout {
  label: string;
  value: string;
  /** A few plain words after the label for shorthand a visitor may not read (β, γ), shown small beside it. */
  gloss?: string;
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

export interface TourStop<S = unknown> {
  title: string;
  /** The stop's name in links (`?stop=`), when its title's slug won't do: set it to keep printed links working after a rename. */
  key?: string;
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
  measure?: Measurement<S>;
  /** What a class does here. A stop with minutes is on the 15-minute lesson path and the student sheet. */
  lesson?: StopLesson;
}

/** Classroom notes for one tour stop, which the teaching kit prints. */
export interface StopLesson {
  /** Minutes on the 15-minute lesson path, which takes the stops with minutes in tour order. */
  minutes?: number;
  /** The wrong ideas this stop is built to surface: each as a student would put it, in quotes, then what is true. */
  misconceptions?: string[];
  /** Observe-and-explain prompts for the student sheet, each tied to a switch of this world. */
  explain?: { toggle: string; prompt: string }[];
}

interface Prediction {
  question: string;
  options: string[];
  answer: number;
  reveal: string;
}

interface Measurement<S> {
  question: string;
  /** How to get there, one step to a line. */
  steps: string[];
  /** Readouts that stay up while the visitor works: the others would give the answer away. */
  given: string[];
  /** What to work out, in order, e.g. { symbol: 'rs', unit: 'm' }. */
  asks: { symbol: string; unit: string }[];
  /** The true values, in the order asked, and one or two sentences giving them and how they follow, worked out on answering from the world's measureState(). */
  answer(state: S): { values: number[]; reveal: string };
}

interface WorldAction {
  id: string;
  label: string;
  key: string;
  /** Only brings things to rest: a tour stop runs it at once even under reduced motion, and in place of one that waits. */
  calm?: boolean;
}

/** A line of the controls help: keys that do the same thing, and what they do. */
interface HelpLine {
  keys: string[];
  text: string;
}

export interface WorldContext {
  renderer: THREE.WebGLRenderer;
  constants: Constants;
  quality: Quality;
}

/**
 * What a world teaches: the plain-data block at the top of each world class (`class SlowLightLesson`), which the
 * World class extends. Making one needs no WebGL. Plain data goes in the Lesson class, anything that needs the GPU in
 * the World class.
 */
export interface Lesson<S = unknown> {
  readonly id: string;
  readonly title: string;
  readonly dials: ConstantKey[];
  readonly preset: Partial<Constants>;
  readonly toggles: Toggle[];
  readonly tour: TourStop<S>[];
  readonly actions: WorldAction[];
  readonly start: Pose;
  /** Controls this world has beyond walking, looking and its actions. */
  readonly help?: HelpLine[];
}

declare const authored: unique symbol;

/**
 * A lesson exactly as written, deep-frozen, so its switches keep their declared values. Only WORLDS makes one. A live
 * World is not one: its switches hold what the visitor set, so links and pages built on it would drift.
 */
export type Authored = Lesson & { readonly [authored]: true };

export interface World<S = unknown> extends Lesson<S> {
  /** Advance the simulation by dt real seconds (the player's proper time) and draw a frame. */
  frame(dt: number, input: InputState, ctx: WorldContext): void;
  readouts(ctx: WorldContext): Readout[];
  setPose(pose: Pose): void;
  runAction(id: string, ctx: WorldContext): void;
  setQuality(q: Quality, ctx: WorldContext): void;
  /** The status line (e.g. "classical regime"), shown under the readouts. */
  status(ctx: WorldContext): string;
  /** The camera of the last frame drawn, for the sky ruler; a world without it has no ruler. */
  view?(): View;
  /** What a measure stop's answer is worked out from, read as the visitor answers. */
  measureState?(): S;
  /** Whether your own speed is warping the whole view, when a fixed level reticle gives the eye a steady reference. */
  warping?(ctx: WorldContext): boolean;
  /** A calm line to show over the view while something about it needs saying (a black screen is not a crash), else null. */
  viewNotice?(ctx: WorldContext): string | null;
  /** Instruments the world draws itself, added to the chrome. */
  readonly overlay?: HTMLElement;
  /** What the end-to-end tests read beyond the readouts. */
  probe?(ctx: WorldContext): unknown;
  dispose(): void;
}
