// Classroom material that no tour stop owns: where each world fits the syllabuses, and the items students answer
// before and after the lesson. Everything a stop owns (its minutes, misconceptions and prompts) sits on the stop.

import type { WorldId } from '../worlds';
import type { Answered } from './sheet';

export interface Syllabus {
  readonly course: string;
  readonly code: string;
  readonly topic: string;
}

export interface Classroom {
  readonly syllabus: readonly Syllabus[];
  /** Asked before and again after the lesson, not graded: the change is the teacher's evidence of learning. */
  readonly check: readonly Answered[];
}

export const CLASSROOM: Readonly<Record<WorldId, Classroom>> = {
  'slow-light': {
    syllabus: [
      { course: 'IB Physics HL', code: 'A.5', topic: 'Galilean and special relativity: simultaneity, time dilation, length contraction, spacetime diagrams' },
      { course: 'NSW HSC Physics', code: 'Module 7', topic: 'Light and special relativity' },
      { course: 'AQA A-level', code: 'Option 3.12', topic: 'Turning points (special relativity)' },
    ],
    check: [
      {
        question: 'Two lamps 100 m apart flash at the same moment in the town’s frame. A cyclist rides fast from one lamp toward the other. In the cyclist’s frame:',
        options: ['they flashed at the same moment', 'the lamp ahead of the cyclist flashed first', 'the lamp behind flashed first', 'it depends only on when each flash’s light reaches the cyclist'],
        answer: 1,
        why: 'In the rider’s frame t′ = γ(t − vx/c²), so the event further ahead happened earlier; d confuses seeing with measuring.',
      },
      {
        question: 'You stand still 65 m from a clock in a town where light moves at 12 m/s. You see it read 10:00:00.0. What does it read now, in your frame?',
        options: ['10:00:00.0', 'about 10:00:05.4', 'about 09:59:54.6'],
        answer: 1,
        why: 'Its light took 65/12 ≈ 5.4 s to arrive.',
      },
      {
        question: 'True or false: a moving clock only seems slow because its light takes longer and longer to reach you.',
        options: ['true', 'false'],
        answer: 1,
        why: 'Time dilation remains after you correct for light travel time (the watch and town clock readouts, or Measured view).',
      },
    ],
  },
  'big-hbar': {
    syllabus: [
      { course: 'AQA A-level', code: '3.2.2.4', topic: 'Wave-particle duality, de Broglie wavelength' },
      { course: 'AP Physics 2', code: 'Unit 15', topic: 'Modern physics, topic 15.1, λ = h/p' },
      { course: 'IB Physics HL', code: 'E.2', topic: 'Quantum physics, de Broglie wavelength; HL only' },
      { course: 'NSW HSC Physics', code: 'Module 8', topic: 'De Broglie’s matter waves' },
    ],
    check: [
      {
        question: 'A detector finds the ball at one spot. What happens to its wave next?',
        options: ['it returns to its old spread-out shape', 'it stays a point', 'it spreads out again from that spot'],
        answer: 2,
        why: 'It spreads again from the narrow lump the detector left.',
      },
      {
        question: 'A ball tunnels through a wall it could not classically cross. Compared with the balls that bounce back, it is',
        options: ['slower', 'the same speed', 'faster'],
        answer: 1,
        why: 'Within the packet’s spread (the transmitted-speed readout).',
      },
    ],
  },
  'big-g': {
    syllabus: [{ course: 'AQA A-level', code: 'Option 3.9', topic: 'Astrophysics (black holes, Schwarzschild radius)' }],
    check: [
      {
        question: 'Seen from far away, a black hole’s shadow is',
        options: ['smaller than its horizon', 'the size of its horizon', 'about 2.6 times wider than its horizon'],
        answer: 2,
        why: 'Light aimed within about 2.6 horizon radii spirals in, so the shadow is about 2.6 times wider.',
      },
    ],
  },
};
