// Index's "Thinking..." animation: a ring morphs into a square, the square unfolds into a
// turning cube, and when the answer is ready the cube folds back and the square closes
// into a ring, or into a dot that a widget's icon then unfolds out of.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {THINKING_FIRST} from "assets";
import {Animation, NORMAL_MAX, linear} from "motion";
import {render} from "theme";

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

// The ring and its morph, antialiased by coverage into four levels (clear, light grey, dark
// grey, black) exactly as the native app drew its 8-bit ring, and drawn as horizontal
// runs. The shape is symmetric, so one quadrant of shades is worked out per frame.
const HALF = POP_RADIUS_Q8 / 256 + 2, QUADRANT = HALF + 1;
let quadrant, shades;

function ringShade(dx, dy, radiusQ8, cornerQ8) {
  const straight = radiusQ8 - cornerQ8;
  let distance;
  if (straight) {
    let horizontal = dx * 256 - straight;
    let vertical = dy * 256 - straight;
    const inside = Math.max(horizontal, vertical);
    if (horizontal < 0) horizontal = 0;
    if (vertical < 0) vertical = 0;
    distance = Math.floor(Math.sqrt(horizontal * horizontal + vertical * vertical));
    if (inside < 0) distance += inside;
  } else {
    distance = Math.floor(Math.sqrt((dx * dx + dy * dy) * 65536));
  }
  let coverage = cornerQ8 + 128 - distance;
  if (radiusQ8 >= 3 * 256) coverage = Math.min(coverage, distance - (cornerQ8 - 3 * 256) + 128);
  coverage = Math.max(0, Math.min(256, coverage));
  return (coverage * 3 + 128) >> 8;
}

export function drawRing(cx, cy, radiusQ8, cornerQ8) {
  if (radiusQ8 > POP_RADIUS_Q8) return;
  quadrant ??= new Uint8Array(QUADRANT * QUADRANT);
  shades ??= [0, render.makeColor(170, 170, 170), render.makeColor(85, 85, 85), render.makeColor(0, 0, 0)];
  // Only as far out as the shape reaches: a small shape is far cheaper to work out.
  const half = Math.min(HALF, (radiusQ8 >> 8) + 2);
  for (let dy = 0; dy <= half; dy++) {
    for (let dx = 0; dx <= half; dx++) quadrant[dy * QUADRANT + dx] = ringShade(dx, dy, radiusQ8, cornerQ8);
  }
  for (let row = -half; row <= half; row++) {
    const line = Math.abs(row) * QUADRANT;
    let start = -half, shade = quadrant[line + half];
    for (let column = -half + 1; column <= half + 1; column++) {
      const next = column > half ? -1 : quadrant[line + Math.abs(column)];
      if (next === shade) continue;
      if (shade > 0) render.fillRectangle(shades[shade], cx + start, cy + row, column - start, 1);
      start = column;
      shade = next;
    }
  }
}

// Frees the ring's working memory once the thinking screen is gone.
function releaseRing() {
  quadrant = undefined;
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
    releaseRing();
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
    // previous frames are collected every third frame change: collecting on every one
    // stalls the animation on the watch, and three ~1 KB frames are well within the heap.
    if (index !== this.frameIndex) {
      this.frame = undefined;
      if (++this.loads % 3 === 0) Debug.gc();
      this.frame = new Poco.PebbleDrawCommandSequence(THINKING_FIRST + index);
      this.frame.time = 0;
      this.frameIndex = index;
    }
    render.drawDCI(this.frame, cx - (this.frame.width >> 1), cy - (this.frame.height >> 1));
  }
}
