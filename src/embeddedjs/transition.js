// A widget icon's entrance, after PebbleOS's notification peek: the icon unfolds out of
// the thinking cube's dot in the dock, holds, then flies into the cutout in the card's
// corner, stretching along its path and squashing as it lands.
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
// scale_segmented.h), plus a short hold so the icon reads before it goes. The peek's are
// for its 80px icon: the dot's stroke and the unfold's overshoot scale with the icon's
// size (the dock's 25px icons: a 3px dot, 2px past the icon on each side, which fills the
// dock's height exactly).
export const UNFOLD_MS = 500, HOLD_MS = 300, FLY_MS = 300;
const TOTAL_MS = UNFOLD_MS + HOLD_MS + FLY_MS;
const PEEK_ICON = 80;
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

  // Unfolds the PDC resource at (cx, cy) at its own size, out of the point (fromX, fromY)
  // (its centre by default), then scales it into `to`. The destination can instead be
  // given by `retarget` from the `flying` callback, once the page has settled where the
  // icon will land. With `unfoldOnly` it just unfolds, as the dictation screen's
  // microphone does, and finishes there.
  start(resource, cx, cy, to, unfoldOnly, fromX = cx, fromY = cy) {
    if (this.active) return false;
    this.image = new Poco.PebbleDrawCommandImage(resource);
    this.strokes = [];
    this.image.clone().process(command => this.strokes.push(command.strokeWidth));
    const w = this.image.width, h = this.image.height;
    this.size = [w, h];
    this.dotStroke = Math.max(1, Math.round(DOT_STROKE * h / PEEK_ICON));
    const expand = Math.trunc(UNFOLD_EXPAND * h / PEEK_ICON);
    this.large = {x: cx - (w >> 1), y: cy - (h >> 1), w, h};
    // Per axis (0 x, 1 y): the icon as [first pixel, size], the unfold's expanded box, and
    // the point it unfolds from. Worked out once: the span is wanted two or three times a
    // frame, and arrays made there were garbage every frame.
    this.largeAxis = [[this.large.x, w], [this.large.y, h]];
    this.unfoldMiddle = [[this.large.x - expand, w + 2 * expand],
                         [this.large.y - expand, h + 2 * expand]];
    this.unfoldFrom = [[fromX, 0], [fromY, 0]];
    this.out = [0, 0];
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
    const bounceX = magnitude ? Math.trunc(FLY_BOUNCE * dx / magnitude) : 0;
    const bounceY = magnitude ? Math.trunc(FLY_BOUNCE * dy / magnitude) : 0;
    // Per axis: the destination as [first pixel, size] and the flight's expanded, pushed
    // past box it overshoots to.
    this.toAxis = [[to.x, to.w], [to.y, to.h]];
    this.flyMiddle = [[to.x - FLY_EXPAND + bounceX, to.w + 2 * FLY_EXPAND],
                      [to.y - FLY_EXPAND + bounceY, to.h + 2 * FLY_EXPAND]];
  }

  release() {
    this.animation?.unschedule();
    this.animation = undefined;
    this.image = undefined;
    this.active = false;
    // The flight's clones, freed before the next animation's art: without this the app
    // ran out of memory over a few turns.
    Debug.gc();
  }

  cancel() {
    if (this.active) this.release();
  }

  // The icon's frame on one axis (0 x, 1 y) at this moment: [first pixel, past the last],
  // in one array reused by every call (callers take the values at once).
  span(axis) {
    const size = this.size[axis], large = this.largeAxis[axis], out = this.out;
    if (this.elapsed < UNFOLD_MS + HOLD_MS) {
      // The unfold: out of a point at the icon's centre, past its size, back onto it.
      const progress = this.elapsed >= UNFOLD_MS ? NORMAL_MAX : Math.trunc(this.elapsed * NORMAL_MAX / UNFOLD_MS);
      const from = this.unfoldFrom[axis], middle = this.unfoldMiddle[axis];
      const first = segmented(progress, 0, 2, UNFOLD_EFFECT_DURATION);
      const second = segmented(progress, 1, 2, UNFOLD_EFFECT_DURATION);
      out[0] = twoStage(0, size, from, middle, large, first, second);
      out[1] = twoStage(size, size, from, middle, large, first, second);
      return out;
    }
    // The flight: the edge facing the destination leaves first and the far edge last,
    // each on its own delay, so the icon stretches towards it, then overshoots with the
    // bounce and squashes back onto it.
    const fly = this.elapsed - UNFOLD_MS - HOLD_MS;
    const progress = fly >= FLY_MS ? NORMAL_MAX : Math.trunc(fly * NORMAL_MAX / FLY_MS);
    const to = this.toAxis[axis], middle = this.flyMiddle[axis];
    const first = segmented(progress, 0, 2, FLY_EFFECT_DURATION);
    const second = segmented(progress, 1, 2, FLY_EFFECT_DURATION);
    const leadingLow = to[0] + (to[1] >> 1) <= large[0] + (large[1] >> 1);
    const lead = leadingLow ? 0 : DELAY_STEPS - 1, trail = leadingLow ? DELAY_STEPS - 1 : 0;
    out[0] = twoStage(0, size, large, middle, to,
                      segmented(first, lead, DELAY_STEPS, FLY_POINT_DURATION),
                      segmented(second, lead, DELAY_STEPS, FLY_POINT_DURATION));
    out[1] = twoStage(size, size, large, middle, to,
                      segmented(first, trail, DELAY_STEPS, FLY_POINT_DURATION),
                      segmented(second, trail, DELAY_STEPS, FLY_POINT_DURATION));
    return out;
  }

  draw() {
    if (!this.active) return;
    const [left, right] = this.span(0);
    const [top, bottom] = this.span(1);
    // Clones own native PDC memory, which XS's own heap limit does not account for.
    // The previous draws' temporary clones (a few hundred bytes each) are collected every
    // third frame (a 2ms pause on the watch).
    if (++this.draws % 3 === 0) Debug.gc();
    const list = this.image.clone();
    list.scale(Math.max(0, right - left) / this.size[0], Math.max(0, bottom - top) / this.size[1]);
    // Strokes move between two widths, in eighths with rounding: the dot's thick stroke
    // eases back to the art's own over the unfold's first quarter; flying, they scale with
    // the icon to its destination's size (the dock's 2px become the card icon's 3px).
    let index = 0, unfolding = this.elapsed < UNFOLD_MS + HOLD_MS, progress;
    if (unfolding) {
      const unfold = this.elapsed >= UNFOLD_MS ? NORMAL_MAX : Math.trunc(this.elapsed * NORMAL_MAX / UNFOLD_MS);
      progress = easeInOut(unfold >= NORMAL_MAX / 4 ? NORMAL_MAX : unfold * 4);
    } else {
      const fly = this.elapsed - UNFOLD_MS - HOLD_MS;
      progress = easeInOut(fly >= FLY_MS ? NORMAL_MAX : Math.trunc(fly * NORMAL_MAX / FLY_MS));
    }
    const landing = this.to.h / this.size[1];
    list.process(command => {
      const native = this.strokes[index++];
      if (!native) return;
      const from = unfolding ? this.dotStroke : native;
      const to = unfolding ? native : Math.max(1, Math.round(native * landing));
      const eighths = from * 8 + Math.trunc((to - from) * 8 * progress / NORMAL_MAX);
      command.strokeWidth = (eighths + 4) >> 3;
    });
    render.drawDCI(list, left, top);
  }
}
