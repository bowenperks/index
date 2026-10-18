// Pebble's animation timing, ported from the firmware (applib/ui/animation_timing.c) so
// Index moves exactly as the native app did: the same normalised progress, easing tables
// and segmented delays, driven by one ~30 fps frame timer.
import Time from "time";
import {setInterval, clearInterval} from "timers";

export const NORMAL_MAX = 65535;          // ANIMATION_NORMALIZED_MAX
const FRAME_MS = 33;                      // ANIMATION_TARGET_FRAME_INTERVAL_MS

const EASE_IN = Uint16Array.of(
  0, 64, 256, 576, 1024, 1600, 2304, 3136, 4096, 5184, 6400, 7744, 9216, 10816, 12544, 14400,
  16384, 18496, 20736, 23104, 25600, 28224, 30976, 33856, 36864, 40000, 43264, 46656, 50176,
  53824, 57600, 61504, 65535);
const EASE_OUT = Uint16Array.of(
  0, 4031, 7935, 11711, 15359, 18879, 22271, 25535, 28671, 31679, 34559, 37311, 39935, 42431,
  44799, 47039, 49151, 51135, 52991, 54719, 56319, 57791, 59135, 60351, 61439, 62399, 63231,
  63935, 64511, 64959, 65279, 65471, 65535);
const EASE_IN_OUT = Uint16Array.of(
  0, 128, 512, 1152, 2048, 3200, 4608, 6272, 8192, 10368, 12800, 15488, 18432, 21632, 25088,
  28800, 32770, 36737, 40449, 43905, 47105, 50049, 52737, 55169, 57345, 59265, 60929, 62337,
  63488, 64384, 65024, 65408, 65535);

// animation_timing_interpolate: linear between the table's entries.
function interpolate(progress, table) {
  const max = table.length - 1;
  if (progress <= 0) return table[0];
  if (progress >= NORMAL_MAX) return table[max];
  const stride = Math.trunc(NORMAL_MAX / max);
  const index = Math.trunc(progress * max / NORMAL_MAX);
  const from = table[index];
  return from + Math.trunc((table[index + 1] - from) * (progress - index * stride) / stride);
}

export const linear = progress => progress;
export const easeIn = progress => interpolate(progress, EASE_IN);
export const easeOut = progress => interpolate(progress, EASE_OUT);
export const easeInOut = progress => interpolate(progress, EASE_IN_OUT);

// animation_timing_segmented: item `index` of `count` runs for `fraction` (16.16 fixed
// point) of the whole, the items' starts spread evenly over the rest.
export function segmented(progress, index, count, fraction) {
  if (index < 0) return NORMAL_MAX;
  if (index >= count) return 0;
  const duration = Math.trunc(NORMAL_MAX * fraction / 65536);
  const delay = Math.trunc((NORMAL_MAX - duration) / count);
  const offset = progress - index * delay;
  if (offset < 0) return 0;
  return Math.min(NORMAL_MAX, Math.trunc(offset * 65536 / fraction));
}

export const fraction = (numerator, denominator) => Math.trunc(numerator * 65536 / denominator);

// Milliseconds on the watch's monotonic tick counter. Date.now() is not usable for motion:
// it can read a second ahead, then back, as the second rolls over.
export const now = () => Time.ticks;

// A Pebble Animation: `update` gets the curved progress each frame; `stopped(true)` runs
// when it completes. Unscheduling never calls `stopped`; callers tidy up themselves.
const running = [];
let ticker;
let frameHandler;

export function onFrame(handler) {
  frameHandler = handler;
}

export function isAnimating() {
  return ticker !== undefined;
}

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
    ticker ??= setInterval(tick, FRAME_MS);
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

function tick() {
  const time = now();
  for (const animation of running.slice()) {
    if (!animation.scheduled) continue;
    const elapsed = time - animation.started;
    const progress = animation.duration > 0
      ? Math.min(NORMAL_MAX, Math.trunc(elapsed * NORMAL_MAX / animation.duration)) : NORMAL_MAX;
    animation.update(animation.curve(progress));
    if (progress >= NORMAL_MAX && animation.scheduled) {
      animation.unschedule();
      animation.stopped?.(true);
    }
  }
  frameHandler?.();
  if (!running.length && ticker !== undefined) {
    clearInterval(ticker);
    ticker = undefined;
  }
}
