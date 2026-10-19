// Index's "Thinking..." animation: a ring morphs into a square, the square unfolds into a
// turning cube, and when the answer is ready the cube folds back and the square closes
// into a ring, or into a dot that a widget's icon then unfolds out of.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {THINKING_FIRST} from "assets";
import {Animation, NORMAL_MAX, linear} from "motion";
import {render, WHITE, BLACK} from "theme";

export const RING_RADIUS_Q8 = 20 * 256;   // the home ring's resting radius (1/256 px)
const SQUARE_RADIUS_Q8 = 23 * 256, POP_RADIUS_Q8 = 28 * 256;
const MORPH_MS = 240, REVEAL_MS = 240, TURN_MS = 380, MOVE_MS = 480, LOOP_MS = MOVE_MS * 4;
const REVEAL_LAST_FRAME = 12, RIGHT_FIRST_FRAME = REVEAL_LAST_FRAME + 1, TURN_LAST_FRAME = 16;
const OPENING = 0, LOOP = 1, CLOSING = 2;

// Smoothstep over the morph, in 1/1024ths.
function interpolate(start, end, elapsed) {
  if (elapsed >= MORPH_MS) return end;
  const progress = Math.trunc(elapsed * 1024 / MORPH_MS);
  const eased = Math.trunc((progress * progress * (3072 - 2 * progress) + 524288) / 1048576);
  return start + Math.trunc((end - start) * eased / 1024);
}

// The ring and its morph: a rounded square (a circle while its corner radius is its whole
// radius) with a 3px outline, as the native app's ring, drawn as the firmware's own shape
// fills with the inside cleared. Working the outline out pixel by pixel in JavaScript, as
// before, took over 100ms a frame on the watch.
const STROKE = 3, GCORNERS_ALL = 15;

export function drawRing(cx, cy, radiusQ8, cornerQ8) {
  if (radiusQ8 > POP_RADIUS_Q8) return;
  const radius = (radiusQ8 + 128) >> 8, corner = Math.min(radius, (cornerQ8 + 128) >> 8);
  if (radius <= 0) return;
  const inner = radius - STROKE;
  if (corner >= radius) {
    // A circle: the firmware's radial fill is antialiased.
    render.drawCircle(BLACK, cx, cy, radius);
    if (inner > 0) render.drawCircle(WHITE, cx, cy, inner);
    return;
  }
  render.drawRoundRect(cx - radius, cy - radius, 2 * radius, 2 * radius, BLACK, corner, GCORNERS_ALL);
  if (inner > 0) {
    render.drawRoundRect(cx - inner, cy - inner, 2 * inner, 2 * inner, WHITE,
                         Math.max(0, corner - STROKE), GCORNERS_ALL);
  }
}

export default class Thinking {
  constructor(invalidate, finished) {
    this.invalidate = invalidate;
    this.finished = finished;
    this.active = false;
  }

  start(radiusQ8) {
    if (this.active) return false;
    this.active = true;
    this.initialRadius = radiusQ8;
    this.closeRadius = RING_RADIUS_Q8;
    this.stopRequested = false;
    this.frameIndex = -1;
    this.loads = 0;
    this.startStage(OPENING);
    return true;
  }

  // What the square closes into: the ring by default, a dot for a widget's icon.
  setCloseRadius(radiusQ8) {
    this.closeRadius = radiusQ8;
  }

  requestStop() {
    this.stopRequested = true;
  }

  // Whether the cube is folding away; `elapsed` is then how far into that it is.
  get closing() {
    return this.active && this.stage === CLOSING;
  }

  startStage(stage) {
    this.stage = stage;
    this.elapsed = 0;
    const duration = stage === LOOP ? LOOP_MS : MORPH_MS + REVEAL_MS;
    this.animation = new Animation(duration, linear, progress => {
      this.elapsed = Math.trunc(progress * duration / NORMAL_MAX);
      this.invalidate();
    }, () => {
      if (this.stage !== CLOSING) {
        this.startStage(this.stopRequested ? CLOSING : LOOP);
        return;
      }
      this.release();
      this.finished?.();
    }).schedule();
    this.invalidate();
  }

  release() {
    this.animation?.unschedule();
    this.animation = undefined;
    this.active = false;
    this.frame = undefined;
  }

  cancel() {
    if (this.active) this.release();
  }

  // The ring's radius and corner while it morphs, or undefined while the cube shows.
  shape() {
    if (!this.active) return undefined;
    if (this.stage === OPENING && this.elapsed <= MORPH_MS) {
      return [interpolate(this.initialRadius, SQUARE_RADIUS_Q8, this.elapsed),
              interpolate(this.initialRadius, 0, this.elapsed)];
    }
    if (this.stage === CLOSING && this.elapsed >= REVEAL_MS) {
      const elapsed = this.elapsed - REVEAL_MS;
      return [interpolate(SQUARE_RADIUS_Q8, this.closeRadius, elapsed),
              interpolate(0, this.closeRadius, elapsed)];
    }
    return undefined;
  }

  draw(cx, cy) {
    if (!this.active) return;
    const shape = this.shape();
    if (shape) {
      drawRing(cx, cy, shape[0], shape[1]);
      return;
    }
    let index;
    if (this.stage === OPENING) {
      index = Math.min(REVEAL_LAST_FRAME, Math.trunc((this.elapsed - MORPH_MS) * REVEAL_LAST_FRAME / REVEAL_MS));
    } else if (this.stage === CLOSING) {
      index = REVEAL_LAST_FRAME - Math.trunc(this.elapsed * REVEAL_LAST_FRAME / REVEAL_MS);
    } else {
      const elapsed = Math.min(this.elapsed, LOOP_MS - 1);
      const move = Math.trunc(elapsed / MOVE_MS);
      const step = Math.min(TURN_LAST_FRAME, Math.trunc((elapsed % MOVE_MS) * TURN_LAST_FRAME / TURN_MS));
      index = RIGHT_FIRST_FRAME + move * (TURN_LAST_FRAME + 1) + step;
    }
    // Sequence storage is native memory, so XS cannot see its allocation pressure. The
    // previous frames are collected every fifth frame change: collecting on every one
    // stalls the animation on the watch, and five ~1 KB frames are well within the heap.
    if (index !== this.frameIndex) {
      this.frame = undefined;
      if (++this.loads % 5 === 0) Debug.gc();
      this.frame = new Poco.PebbleDrawCommandSequence(THINKING_FIRST + index);
      this.frame.time = 0;
      this.frameIndex = index;
    }
    render.drawDCI(this.frame, cx - (this.frame.width >> 1), cy - (this.frame.height >> 1));
  }
}
