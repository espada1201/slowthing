import type { Quality } from './worlds/types';

const PRESETS: Quality[] = ['low', 'medium', 'high'];
const FLOOR = 0.5;
/** Median frame times (ms) above which a second of frames is too slow, and below which it has room to spare. */
const SLOW = 21;
const ROOMY = 17.5;
/** How long a step down holds before the resolution may climb again; each failed climb doubles it. */
const HOLD = 8000;
const MAX_HOLD = 240_000;
/** A step down within this long of a climb (ms) is blamed on the climb, however many good seconds came between. */
const RECENT = 60_000;

/**
 * Keeps frames near 60 a second. Each second it judges the median frame: too slow, and it draws fewer pixels;
 * room to spare, and it climbs back a step at a time, returning at once (and waiting twice as long before the
 * next try) if a step proves too slow, so it settles rather than flapping. On Auto it also moves between
 * presets: down when even the lowest resolution is too slow, up after a spell at full resolution with room to
 * spare, never again into a preset that was too slow. A software renderer with frames seconds long gets the same
 * treatment; only the first frames, slow while shaders compile, are not judged.
 */
export class AutoQuality {
  scale = 1;
  private times: number[] = [];
  private span = 0;
  /** The highest scale that last held the frame rate, where a failed climb returns to. */
  private good = 1;
  private hold = 0;
  private backoff = HOLD;
  private climbing = false;
  /** Time since the last climb, ms. */
  private sinceClimb = Infinity;
  /** Time spent too slow at the lowest resolution, or at full resolution with room to spare. */
  private stuck = 0;
  private roomy = 0;

  constructor(
    public preset: Quality,
    readonly auto: boolean,
    /** Presets found too slow for this world, shared across visits to it. */
    private readonly tooSlow = new Set<Quality>(),
    private settle = 2000,
  ) {
    while (auto && tooSlow.has(this.preset) && this.preset !== 'low') this.preset = PRESETS[PRESETS.indexOf(this.preset) - 1];
  }

  /** One frame took `ms`; returns what changed, if anything. */
  frame(ms: number): 'scale' | 'preset' | null {
    if (!(ms > 0)) return null;
    if (this.settle > 0) {
      this.settle -= ms;
      return null;
    }
    this.hold -= ms;
    this.sinceClimb += ms;
    this.times.push(ms);
    if ((this.span += ms) < 1000) return null;
    const median = this.times.sort((a, b) => a - b)[this.times.length >> 1];
    const span = this.span;
    this.times = [];
    this.span = 0;
    if (median > SLOW) return this.tooSlowFor(median, span);
    this.good = this.scale;
    this.stuck = 0;
    this.climbing = false;
    if (median >= ROOMY) {
      this.roomy = 0;
      return null;
    }
    if (this.scale < 1) {
      if (this.hold > 0) return null;
      this.climbing = true;
      this.sinceClimb = 0;
      return this.setScale(Math.min(1, this.scale * 1.06));
    }
    const up = PRESETS[PRESETS.indexOf(this.preset) + 1];
    if (!this.auto || !up || this.tooSlow.has(up) || (this.roomy += span) < 5000) return null;
    return this.setPreset(up);
  }

  private tooSlowFor(median: number, span: number) {
    this.roomy = 0;
    if (this.climbing) {
      this.climbing = false;
      this.hold = this.lengthen();
      return this.setScale(this.good);
    }
    if (this.scale > FLOOR) {
      // Frame times that sit on the limit fail a second now and then, well after the climb that brought them there:
      // that too lengthens the wait, or the resolution would saw up and down for as long as the page is open.
      this.hold = this.sinceClimb < RECENT ? this.lengthen() : HOLD;
      // Cost goes with the pixel count, so aim straight for a 60 Hz frame, but by no more than 30% at once.
      this.good = Math.max(FLOOR, this.scale * Math.min(0.95, Math.max(0.7, Math.sqrt(1000 / 60 / median))));
      return this.setScale(this.good);
    }
    const down = PRESETS[PRESETS.indexOf(this.preset) - 1];
    if (!this.auto || !down || (this.stuck += span) < 2000) return null;
    this.tooSlow.add(this.preset);
    return this.setPreset(down);
  }

  /** Wait twice as long as the last time before the next climb. */
  private lengthen() {
    return (this.backoff = Math.min(2 * this.backoff, MAX_HOLD));
  }

  private setScale(s: number) {
    this.scale = s;
    return 'scale' as const;
  }

  /** A new preset starts at 70% resolution, free to climb at once, after its first frames have settled. */
  private setPreset(q: Quality) {
    this.preset = q;
    this.scale = this.good = 0.7;
    this.hold = this.stuck = this.roomy = 0;
    this.backoff = HOLD;
    this.sinceClimb = Infinity;
    this.climbing = false;
    this.settle = 1000;
    return 'preset' as const;
  }
}
