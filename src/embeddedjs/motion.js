// Pebble's animation timing, ported from the firmware (applib/ui/animation_timing.c) so
// Index moves exactly as the native app did: the same normalised progress, easing tables
// and segmented delays, stepped every 10 ms. Quotients are truncated with `| 0`, as the
// firmware's integer division truncates them, which is less bytecode than Math.trunc (and
// bytecode is heap on the watch). `| 0` keeps only 32 bits, so a progress that can run
// past its end is clamped first.
import Time from "time";
import {setInterval, clearInterval} from "timers";

export const NORMAL_MAX = 65535;          // ANIMATION_NORMALIZED_MAX
const FRAME_MS = 33;                      // ANIMATION_TARGET_FRAME_INTERVAL_MS
// Animations are stepped more often than they are drawn: a frame starts as soon as the
// display can take it (main.js), and shows where the animations are by then.
const TICK_MS = 10;

// Only the curves Index uses: ease-in is left out, like the rest of the firmware's table.
const EASE_OUT = Uint16Array.of(
  0, 4031, 7935, 11711, 15359, 18879, 22271, 25535, 28671, 31679, 34559, 37311, 39935, 42431,
  44799, 47039, 49151, 51135, 52991, 54719, 56319, 57791, 59135, 60351, 61439, 62399, 63231,
  63935, 64511, 64959, 65279, 65471, 65535);
const EASE_IN_OUT = Uint16Array.of(
  0, 128, 512, 1152, 2048, 3200, 4608, 6272, 8192, 10368, 12800, 15488, 18432, 21632, 25088,
  28800, 32770, 36737, 40449, 43905, 47105, 50049, 52737, 55169, 57345, 59265, 60929, 62337,
  63488, 64384, 65024, 65408, 65535);

// animation_timing_interpolate: linear between the table's entries.
const interpolate = (progress, table) => {
  const max = table.length - 1;
  if (progress <= 0) return table[0];
  if (progress >= NORMAL_MAX) return table[max];
  const stride = NORMAL_MAX / max | 0;
  const index = progress * max / NORMAL_MAX | 0;
  const from = table[index];
  return from + ((table[index + 1] - from) * (progress - index * stride) / stride | 0);
};

export const linear = progress => progress;
export const easeOut = progress => interpolate(progress, EASE_OUT);
export const easeInOut = progress => interpolate(progress, EASE_IN_OUT);

// animation_timing_segmented: item `index` of `count` runs for `fraction` (16.16 fixed
// point) of the whole, the items' starts spread evenly over the rest.
export const segmented = (progress, index, count, fraction) => {
  if (index < 0) return NORMAL_MAX;
  if (index >= count) return 0;
  const duration = NORMAL_MAX * fraction / 65536 | 0;
  const delay = (NORMAL_MAX - duration) / count | 0;
  const offset = progress - index * delay;
  if (offset < 0) return 0;
  return Math.min(NORMAL_MAX, offset * 65536 / fraction) | 0;
};

export const fraction = (numerator, denominator) => numerator * 65536 / denominator | 0;

// Pebble's "moook" curve (applib/ui/animation_interpolate.c, interpolate_moook_soft), the
// one Timeline moves its pins with on Up and Down: a wind-up of 0, 1 and 20 pixels towards
// the destination, `mid` linear frames (3 by default, Timeline's), then an overshoot of 4,
// 2, 1 and 0 pixels past it. With no middle frames it is interpolate_moook, the firmware's
// window push: almost the whole way in one frame. Each entry is one 33ms frame; the value
// at `progress` (0..NORMAL_MAX) between `from` and `to`.
const MOOOK_IN = [0, 1, 20], MOOOK_OUT = [4, 2, 1, 0], MOOOK_MID = 3;
export const MOOOK_MS = (MOOOK_IN.length + MOOOK_MID + MOOOK_OUT.length) * FRAME_MS;

export const moook = (progress, from, to, mid = MOOOK_MID) => {
  const direction = from === to ? 0 : from < to ? 1 : -1;
  if (!direction || progress >= NORMAL_MAX) return to;
  const total = MOOOK_IN.length + mid + MOOOK_OUT.length;
  const frame = Math.max(0, Math.min(total - 1,
    (progress * total + (NORMAL_MAX / (2 * total) | 0)) / NORMAL_MAX | 0));
  if (frame < MOOOK_IN.length) return from + direction * MOOOK_IN[frame];
  if (frame < MOOOK_IN.length + mid) {
    const shifted = progress - (MOOOK_IN.length * NORMAL_MAX / total | 0);
    const midProgress = total * shifted / mid | 0;
    const start = from + direction * MOOOK_IN[MOOOK_IN.length - 1];
    const end = to + direction * MOOOK_OUT[0];
    return start + (midProgress * (end - start) / NORMAL_MAX | 0);
  }
  return to + direction * MOOOK_OUT[frame - MOOOK_IN.length - mid];
};

// Milliseconds on the watch's monotonic tick counter. Date.now() is not usable for motion:
// it can read a second ahead, then back, as the second rolls over.
export const now = () => Time.ticks;

// A Pebble Animation: `update` gets the curved progress each frame; `stopped(true)` runs
// when it completes. Unscheduling never calls `stopped`; callers tidy up themselves.
const running = [];
let ticker;
let frameHandler;

export const onFrame = handler => {
  frameHandler = handler;
};

export const isAnimating = () => ticker !== undefined;

export class Animation {
  constructor(duration, curve, update, stopped) {
    this.duration = duration;
    this.curve = curve;
    this.update = update;
    this.stopped = stopped;
  }
  schedule() {
    this.started = now();
    if (!running.includes(this)) running.push(this);
    ticker ??= setInterval(tick, TICK_MS);
    return this;
  }
  get scheduled() {
    return running.includes(this);
  }
  unschedule() {
    const index = running.indexOf(this);
    if (index >= 0) running.splice(index, 1);
  }
}

// The animations to step this tick, copied into one reused array: a fresh copy every
// tick is garbage, and collections stall motion on the watch.
const stepping = [];

const tick = () => {
  const time = now();
  stepping.length = 0;
  for (let index = 0; index < running.length; index++) stepping.push(running[index]);
  for (let index = 0; index < stepping.length; index++) {
    const animation = stepping[index];
    if (!animation.scheduled) continue;
    const elapsed = time - animation.started;
    const progress = animation.duration > 0
      ? Math.min(NORMAL_MAX, elapsed * NORMAL_MAX / animation.duration) | 0 : NORMAL_MAX;
    animation.update(animation.curve(progress));
    if (progress >= NORMAL_MAX && animation.scheduled) {
      animation.unschedule();
      animation.stopped?.(true);
    }
  }
  // Stopped before the frame when nothing is left running (an animation's last step, or
  // one unscheduled since the last tick): a frame the display's pacing holds back then gets
  // a timer of its own (main.js) instead of waiting for the next change to paint it.
  if (!running.length && ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }
  frameHandler?.();
};
