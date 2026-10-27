// Index's "Thinking..." animation: a ring morphs into a square, the square unfolds into a
// turning cube, and when the answer is ready the cube folds back and the square closes
// into a ring, or into a dot that a widget's icon then unfolds out of.
import Debug from "debug";
import {THINKING_FIRST} from "assets";
import {Animation, NORMAL_MAX, linear, now} from "motion";
import {render, WHITE, BLACK} from "theme";

// Sizes in 1/256 px, at the dock's size: the cube's frames (tools/build_cube.py) are drawn
// at it, the cube 41px tall at rest, and the ring and square match them. The square is
// frame 0's (39px across its 2px outline); the ring is the home ring's, the default to
// close into, in the proportions the original art had (ring 20, square 23, pop 28).
export const RING_RADIUS_Q8 = 4342;
const SQUARE_RADIUS_Q8 = 4992, POP_RADIUS_Q8 = 6077;
const MORPH_MS = 240, REVEAL_MS = 240, TURN_MS = 380, MOVE_MS = 480, LOOP_MS = MOVE_MS * 4;
const REVEAL_LAST_FRAME = 12, RIGHT_FIRST_FRAME = REVEAL_LAST_FRAME + 1, TURN_LAST_FRAME = 16;
const OPENING = 0, LOOP = 1, CLOSING = 2;

// Smoothstep over the morph, in 1/1024ths. Here and throughout this file, `| 0` truncates
// as Math.trunc would, in less code than the call: what it truncates is never more than a
// few thousand, far inside its 32 bits.
const interpolate = (start, end, elapsed) => {
  if (elapsed >= MORPH_MS) return end;
  const progress = elapsed * 1024 / MORPH_MS | 0;
  const eased = (progress * progress * (3072 - 2 * progress) + 524288) / 1048576 | 0;
  return start + ((end - start) * eased / 1024 | 0);
};

// The ring and its morph: a rounded square (a circle while its corner radius is its whole
// radius) with the cube's 2px outline, drawn as the
// firmware's own shape fills with the inside cleared. Working the outline out pixel by
// pixel in JavaScript, as before, took over 100ms a frame on the watch.
const STROKE = 2, GCORNERS_ALL = 15;
const CUBE_HALF = 25;   // the frames' 50px canvas, the cube centred in it

// @strip profile
// For instrumented builds: the longest frame draw (a frame change loads its bitmap) since
// the last reading, in the place main.js reads it.
let loadMax = 0;
export const cubeStats = () => {
  const stats = [0, 0, loadMax];
  loadMax = 0;
  return stats;
};
// @endstrip

export const drawRing = (cx, cy, radiusQ8, cornerQ8) => {
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
};

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

  startStage(stage) {
    this.stage = stage;
    this.elapsed = 0;
    const duration = stage === LOOP ? LOOP_MS : MORPH_MS + REVEAL_MS;
    this.animation = new Animation(duration, linear, progress => {
      this.elapsed = progress * duration / NORMAL_MAX | 0;
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
    // The last frame's bitmap, freed before the icon's unfold starts cloning art.
    Natives.cubeRelease();
    Debug.gc();
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
      index = Math.min(REVEAL_LAST_FRAME, (this.elapsed - MORPH_MS) * REVEAL_LAST_FRAME / REVEAL_MS | 0);
    } else if (this.stage === CLOSING) {
      index = REVEAL_LAST_FRAME - (this.elapsed * REVEAL_LAST_FRAME / REVEAL_MS | 0);
    } else {
      const elapsed = Math.min(this.elapsed, LOOP_MS - 1);
      const move = elapsed / MOVE_MS | 0;
      const step = Math.min(TURN_LAST_FRAME, (elapsed % MOVE_MS) * TURN_LAST_FRAME / TURN_MS | 0);
      index = RIGHT_FIRST_FRAME + move * (TURN_LAST_FRAME + 1) + step;
    }
    // The frames are bitmaps (tools/build_cube.py) drawn natively (scroll.c), which keeps
    // just the one on screen loaded: no garbage for XS to collect.
    // @strip profile
    const started = now();
    // @endstrip
    Natives.cubeDraw(THINKING_FIRST + index, cx - CUBE_HALF, cy - CUBE_HALF);
    // @strip profile
    const took = now() - started;
    if (took > loadMax) loadMax = took;
    // @endstrip
  }
}
