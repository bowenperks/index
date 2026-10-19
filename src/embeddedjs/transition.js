// A widget icon's entrance, after PebbleOS's notification peek: the icon unfolds out of
// the thinking cube's dot, holds, then flies into the icon square in the card's header,
// stretching along its path and squashing as it lands.
//
// The firmware moves every point of the vector icon on its own delay (kino_reel_unfold,
// scale_segmented). Alloy can transform a whole PDC but not move single points, so here
// the icon's edges carry those delays instead: the same two-stage scale-segmented maths
// (deflate and bounce effects, firmware timings and easing) runs on the leading and the
// trailing edge, and the icon is scaled to span them each frame.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {Animation, NORMAL_MAX, linear, easeInOut, segmented, fraction} from "motion";
import {render} from "theme";

// Timings and effects as the firmware's peek sets them (peek_layer.c, unfold.h,
// scale_segmented.h), plus a short hold so the large icon reads before it goes.
export const UNFOLD_MS = 500, HOLD_MS = 300, FLY_MS = 300;
const TOTAL_MS = UNFOLD_MS + HOLD_MS + FLY_MS;
const DOT_STROKE = 8;        // the peek's 9px dot
const UNFOLD_EXPAND = 8;     // unfold deflate effect
const FLY_EXPAND = 10;       // scale-to deflate effect
const FLY_BOUNCE = 20;       // scale-to bounce effect
const FLY_POINT_DURATION = fraction(2, 3), FLY_EFFECT_DURATION = fraction(2, 3);
const UNFOLD_EFFECT_DURATION = fraction(3, 4);
const DELAY_STEPS = 32;      // the edges' delays: first and last of this many

// The scale-segmented interpolation: eased, then linear.
const tween = (progress, from, to) => from + Math.trunc((to - from) * easeInOut(progress) / NORMAL_MAX);

// gpoint_scale_to for one coordinate `value` of a `size` box moved `from` -> `to`.
function scaleAxis(value, size, fromMin, fromRange, toMin, toRange, progress) {
  return value + Math.trunc(value * tween(progress, fromRange - size, toRange - size) / size) +
         tween(progress, fromMin, toMin);
}

// One coordinate through the two-stage transform (gdraw_command_list_scale_segmented_to
// with an effect): first towards `middle` (the target grown, pushed past by the bounce),
// then settled from there onto `to`. Rects are [min, range] on one axis.
function twoStage(value, size, from, middle, to, first, second) {
  const across = scaleAxis(value, size, from[0], from[1], middle[0], middle[1], first);
  return scaleAxis(across - middle[0], middle[1], 0, middle[1], to[0] - middle[0], to[1], second) + middle[0];
}

export default class IconTransition {
  constructor(invalidate, flying, finished) {
    this.invalidate = invalidate;
    this.flying = flying;
    this.finished = finished;
    this.active = false;
  }

  get isFlying() {
    return this.active && this.flyingStarted;
  }

  // Unfolds the PDC resource at (cx, cy) at its own size, then scales it into `to`. The
  // destination can instead be given by `retarget` from the `flying` callback, once the
  // page has settled where the icon will land. With `unfoldOnly` it just unfolds, as the
  // dictation screen's microphone does, and finishes there.
  start(resource, cx, cy, to, unfoldOnly) {
    if (this.active) return false;
    this.image = new Poco.PebbleDrawCommandImage(resource);
    this.strokes = [];
    this.image.clone().process(command => this.strokes.push(command.strokeWidth));
    const w = this.image.width, h = this.image.height;
    this.size = [w, h];
    this.large = {x: cx - (w >> 1), y: cy - (h >> 1), w, h};
    this.retarget(to ?? this.large);
    this.elapsed = this.draws = 0;
    this.flyingStarted = false;
    this.active = true;
    const total = unfoldOnly ? UNFOLD_MS : TOTAL_MS;
    this.animation = new Animation(total, linear, progress => {
      this.elapsed = Math.trunc(progress * total / NORMAL_MAX);
      if (!this.flyingStarted && this.elapsed >= UNFOLD_MS + HOLD_MS) {
        this.flyingStarted = true;
        this.flying?.();
      }
      this.invalidate();
    }, () => {
      this.release();
      this.invalidate();
      this.finished?.();
    }).schedule();
    this.invalidate();
    return true;
  }

  retarget(to) {
    this.to = to;
    // The bounce overshoots past the destination along the line of travel.
    const dx = to.x - this.large.x, dy = to.y - this.large.y;
    const magnitude = Math.floor(Math.sqrt(dx * dx + dy * dy));
    this.bounce = magnitude ? [Math.trunc(FLY_BOUNCE * dx / magnitude), Math.trunc(FLY_BOUNCE * dy / magnitude)] : [0, 0];
  }

  release() {
    this.animation?.unschedule();
    this.animation = undefined;
    this.image = undefined;
    this.active = false;
  }

  cancel() {
    if (this.active) this.release();
  }

  // The icon's frame on one axis (0 x, 1 y) at this moment: [first pixel, past the last].
  span(axis) {
    const size = this.size[axis];
    const large = axis ? [this.large.y, this.large.h] : [this.large.x, this.large.w];
    if (this.elapsed < UNFOLD_MS + HOLD_MS) {
      // The unfold: out of a point at the icon's centre, past its size, back onto it.
      const progress = this.elapsed >= UNFOLD_MS ? NORMAL_MAX : Math.trunc(this.elapsed * NORMAL_MAX / UNFOLD_MS);
      const centre = large[0] + (large[1] >> 1);
      const middle = [large[0] - UNFOLD_EXPAND, large[1] + 2 * UNFOLD_EXPAND];
      const first = segmented(progress, 0, 2, UNFOLD_EFFECT_DURATION);
      const second = segmented(progress, 1, 2, UNFOLD_EFFECT_DURATION);
      return [twoStage(0, size, [centre, 0], middle, large, first, second),
              twoStage(size, size, [centre, 0], middle, large, first, second)];
    }
    // The flight: the edge facing the header square leaves first and the far edge last,
    // each on its own delay, so the icon stretches towards the square, then overshoots
    // with the bounce and squashes back onto it.
    const fly = this.elapsed - UNFOLD_MS - HOLD_MS;
    const progress = fly >= FLY_MS ? NORMAL_MAX : Math.trunc(fly * NORMAL_MAX / FLY_MS);
    const to = axis ? [this.to.y, this.to.h] : [this.to.x, this.to.w];
    const middle = [to[0] - FLY_EXPAND + this.bounce[axis], to[1] + 2 * FLY_EXPAND];
    const first = segmented(progress, 0, 2, FLY_EFFECT_DURATION);
    const second = segmented(progress, 1, 2, FLY_EFFECT_DURATION);
    const edge = (value, delay) => twoStage(value, size, large, middle, to,
      segmented(first, delay, DELAY_STEPS, FLY_POINT_DURATION),
      segmented(second, delay, DELAY_STEPS, FLY_POINT_DURATION));
    const leadingLow = to[0] + (to[1] >> 1) <= large[0] + (large[1] >> 1);
    return [edge(0, leadingLow ? 0 : DELAY_STEPS - 1), edge(size, leadingLow ? DELAY_STEPS - 1 : 0)];
  }

  draw() {
    if (!this.active) return;
    const [left, right] = this.span(0);
    const [top, bottom] = this.span(1);
    // Clones own native PDC memory, which XS's own heap limit does not account for.
    // Collect the previous draws' temporary clones every sixth frame: collecting every
    // frame stalls the motion on the watch, and six clones are a few hundred bytes each.
    if (++this.draws % 6 === 0) Debug.gc();
    const list = this.image.clone();
    list.scale(Math.max(0, right - left) / this.size[0], Math.max(0, bottom - top) / this.size[1]);
    // Strokes move between two widths, in eighths with rounding: the dot's thick stroke
    // eases back to the art's own over the unfold's first quarter; flying ends near the
    // small icon's 2px strokes.
    let index = 0, unfolding = this.elapsed < UNFOLD_MS + HOLD_MS, progress;
    if (unfolding) {
      const unfold = this.elapsed >= UNFOLD_MS ? NORMAL_MAX : Math.trunc(this.elapsed * NORMAL_MAX / UNFOLD_MS);
      progress = easeInOut(unfold >= NORMAL_MAX / 4 ? NORMAL_MAX : unfold * 4);
    } else {
      const fly = this.elapsed - UNFOLD_MS - HOLD_MS;
      progress = easeInOut(fly >= FLY_MS ? NORMAL_MAX : Math.trunc(fly * NORMAL_MAX / FLY_MS));
    }
    list.process(command => {
      const native = this.strokes[index++];
      if (!native) return;
      const from = unfolding ? DOT_STROKE : native;
      const to = unfolding ? native : (native + 1) >> 1;
      const eighths = from * 8 + Math.trunc((to - from) * 8 * progress / NORMAL_MAX);
      command.strokeWidth = (eighths + 4) >> 3;
    });
    render.drawDCI(list, left, top);
  }
}
