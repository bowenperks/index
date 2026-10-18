// The home screen's ring of eight coloured icon badges: it spins in on launch and comes to
// rest on three whole badges; on the touchscreen it follows a sideways drag, coasts with
// the flick and eases onto the nearest rest.
import Poco from "commodetto/Poco";
import {HOME_ICONS} from "assets";
import {Animation, NORMAL_MAX, linear, easeOut, now} from "motion";
import {render, WHITE} from "theme";

export const SIZE = 51;   // one badge
export const INSET = 8;   // the strip's clip inside each screen edge

const ICON_COUNT = 8, PITCH = 58, LOOP_PIXELS = ICON_COUNT * PITCH, INTRO_MS = 1800;
// A release coasts for this long at the flick's speed before settling, then eases onto the
// nearest rest; flicks are capped so one never spins the whole ring.
const COAST_MS = 180, MAX_FLICK = 1600, SETTLE_MIN_MS = 220, SETTLE_MAX_MS = 520,
      FLICK_WINDOW_MS = 90;

const wrapOffset = offset => ((offset % LOOP_PIXELS) + LOOP_PIXELS) % LOOP_PIXELS;

export default class Carousel {
  constructor(invalidate) {
    this.invalidate = invalidate;
    // The badges are one sequence of eight 1 ms frames: frame n is badge n.
    this.icons = new Poco.PebbleDrawCommandSequence(HOME_ICONS);
    this.order = [0, 1, 2, 3, 4, 5, 6, 7];
    for (let i = ICON_COUNT - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.offset = 0;
    this.rest = 0;
    this.animation = undefined;
    this.ready = this.visible = this.started = this.dragging = false;
  }

  draw(frame) {
    render.clip(frame.x, frame.y, frame.w, frame.h);
    render.fillRectangle(WHITE, frame.x, frame.y, frame.w, frame.h);
    const first = frame.x + Math.trunc(frame.w / 2);
    const offset = this.offset % PITCH;
    const step = Math.trunc(this.offset / PITCH);
    const moving = !this.started || this.animation || this.dragging;
    for (let slot = -2; slot <= 4; slot++) {
      const x = first + slot * PITCH + offset - Math.trunc(SIZE / 2);
      if (x + SIZE <= frame.x || x >= frame.x + frame.w) continue;
      // At rest only whole badges show; moving they slide past the edges.
      if (!moving && (x < frame.x || x + SIZE > frame.x + frame.w)) continue;
      this.icons.time = this.order[(slot - step + ICON_COUNT * 2) % ICON_COUNT];
      render.drawDCI(this.icons, x, frame.y);
    }
    render.clip();
  }

  setOffset(offset) {
    if (offset === this.offset) return;
    this.offset = offset;
    this.invalidate();
  }

  cancelAnimation() {
    if (!this.animation) return;
    this.animation.unschedule();
    this.stopped();
  }

  stopped() {
    this.animation = undefined;
    // A finger that cut the animation short keeps the ring where it is.
    if (!this.dragging) this.offset = this.rest;
    this.invalidate();
  }

  show() {
    this.visible = true;
    if (!this.ready || this.started) return;
    this.started = true;
    this.rest = 0;
    // Two turns of the ring under a cubic ease-out: fast, then slowing to a stop.
    this.animation = new Animation(INTRO_MS, linear, progress => {
      const remaining = NORMAL_MAX - progress;
      const eased = NORMAL_MAX - Math.trunc(remaining * remaining * remaining / (NORMAL_MAX * NORMAL_MAX));
      this.setOffset(Math.trunc(eased * 2 * LOOP_PIXELS / NORMAL_MAX) % LOOP_PIXELS);
    }, () => this.stopped()).schedule();
  }

  // Runs once the app has focus, after the launcher's transition.
  start() {
    this.ready = true;
    if (this.visible) this.show();
  }

  hide() {
    this.dragging = false;
    this.cancelAnimation();
    this.visible = false;
  }

  dragBegin() {
    if (!this.visible) return;
    // Grabbing the ring stops the entrance spin or a settle where it is.
    this.dragging = true;
    this.started = true;
    this.cancelAnimation();
    this.dragStart = this.offset;
    this.dragDx = this.flickDx = 0;
    this.dragMs = this.flickMs = now();
  }

  dragTo(dx) {
    if (!this.dragging) return;
    const time = now();
    // The flick is measured over the last moment of the drag, not its whole length: the
    // reference sample is renewed once it is a third of the window old.
    if (time - this.flickMs >= FLICK_WINDOW_MS / 3) {
      this.flickDx = this.dragDx;
      this.flickMs = this.dragMs;
    }
    this.dragDx = dx;
    this.dragMs = time;
    this.setOffset(wrapOffset(this.dragStart + dx));
  }

  dragEnd() {
    if (!this.dragging) return;
    this.dragging = false;
    // Pixels per second over the last sample; a finger that stopped before lifting has none.
    const time = now();
    let velocity = 0;
    const span = this.dragMs - this.flickMs;
    if (span && time - this.dragMs < FLICK_WINDOW_MS) {
      velocity = Math.trunc((this.dragDx - this.flickDx) * 1000 / span);
    }
    velocity = Math.max(-MAX_FLICK, Math.min(MAX_FLICK, velocity));
    // Coast, then settle on the nearest whole-badge rest (any multiple of the pitch).
    const from = this.dragStart + this.dragDx;
    const projected = from + Math.trunc(velocity * COAST_MS / 1000);
    const target = Math.trunc((projected >= 0 ? projected + PITCH / 2 : projected - PITCH / 2) / PITCH) * PITCH;
    const delta = target - from;
    this.rest = wrapOffset(target);
    if (!delta) {
      this.setOffset(this.rest);
      this.invalidate();
      return;
    }
    const duration = Math.min(SETTLE_MAX_MS, SETTLE_MIN_MS + Math.abs(delta) * 2);
    this.animation = new Animation(duration, easeOut, progress => {
      this.setOffset(wrapOffset(from + Math.trunc(delta * progress / NORMAL_MAX)));
    }, () => this.stopped()).schedule();
  }
}
