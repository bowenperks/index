// Index's one scrolling page, laid out like a messaging app: the history of what Index has
// done, newest at the bottom, under a slim time bar, and at the very end the voice input,
// Pebble's microphone. The page opens on the newest results with the microphone beneath
// them.
//
// Asking pushes things in from the bottom: the recording's waveform in the user's bubble,
// then the whole transcribed message at once. The microphone then shrinks to a dot at the
// bottom left, which grows into the thinking cube, with Index's typing bubble ("•••")
// beside it. When the result comes in it takes the words' place, so the history keeps
// results rather than questions.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {setTimeout, clearTimeout, setInterval, clearInterval} from "timers";
import * as assets from "assets";
import {Animation, NORMAL_MAX, linear, easeInOut, easeOut, now, moook, MOOOK_MS, segmented,
        fraction} from "motion";
import {render, WIDTH, HEIGHT, CONTENT_SIZE, MEDIUM, EXTRA_LARGE, WHITE, DARK_GRAY, VIVID_CERULEAN,
        ink, font, drawText, textWidth, measure, resetPen, art} from "theme";
import Thinking from "thinking";
import IconTransition, {UNFOLD_MS, HOLD_MS} from "transition";
import {drawWeather, DEMO as WEATHER_DEMO} from "weather";
import {CARDS} from "cards";
import {drawMic, Waveform} from "mic";
import {history} from "prompts";

const CAPACITY = 7;   // history entries (results and day labels) kept, to bound memory
// Index's replies sit at the left margin with a tail; the user's bubbles are solid pills
// against the right margin; cards take a narrower margin on both sides and have no tail.
const MARGIN = 12, GAP = 8, BUBBLE_INSET = 38, PILL_RADIUS = 12, CARD_MARGIN = 6;
// Widget cards have no header: the card is all information. Its bottom-left corner is cut
// away (the frame stops 40px in from the left and 19px up from the bottom) and the widget's
// 36px icon sits in the cutout, rising 15px above the bottom edge and hanging 20px below
// it; there is no other label.
const CARD_RADIUS = 7, WIDGET_BODY = 154;
const CUT_WIDTH = 40, CUT_HEIGHT = 19, ICON_ABOVE = 15, ICON_BELOW = 36 - 1 - ICON_ABOVE;
// Content near the bottom clears the cutout: text cards' ink (descenders included) ends
// at least 22px above the bottom edge; the rich bodies' bottom padding is measured from
// their last row's caps, so they get 15px more for its descenders and the gap.
const CUT_CLEARANCE = CUT_HEIGHT + 3, BODY_CLEARANCE = CUT_HEIGHT - 4;
const WIDGET_ICON = 36, WIDGET_DOT_RADIUS_Q8 = 4 * 256;   // the notification peek's 9px dot
// A card's text is set like a notification's body, at the card's 10px inset, with a text
// bubble's 9px above; a source line, if any, follows in small type.
const CARD_TEXT_INSET = 10, CARD_TEXT_PADDING = 9, SOURCE_GAP = 7, SOURCE_CAP_TOP = 5, SOURCE_CAP = 9;
const GCORNERS_ALL = 15;
const SCROLL_MS = 250;   // a ScrollLayer's animated offset
// The position bar's column at the left edge, which nothing else on the page reaches:
// cards start at CARD_MARGIN, a reply's tail 5px inside MARGIN.
const BAR_COLUMN = 6;
// The voice input's slot at the end of the page: the 80px microphone's centre sits 44px
// down (its art 2-78 of its canvas), and the thinking cube's art (31px above its centre,
// up to 42 below as it turns) fits too. Going to think, the microphone shrinks to a 5px
// dot, and the cube grows out of a 3px dot.
const SLOT_HEIGHT = 88, SLOT_CENTRE = 44, MIC_DOT_SCALE = 0.06, MIC_DOT_Q8 = 3 * 256;
// While Index thinks, the cube sits at the bottom left (its art spans 35px either side of
// its centre at most). The typing bubble fills the rest of the row, from beside the cube
// to the user's bubbles' margin, and is the cube's height: its art (tools/build_assets.py)
// starts 30px above the cube's centre, level with the cube's top, and its 69px body ends
// level with the cube's bottom. The body sits 5px right of the art's left edge, which is
// the tip of its stem, at the top as a messaging app's; its dots are 10px, 20px apart.
const CUBE_X = 44, TYPING_X = 89, TYPING_TAIL = 5, TYPING_ABOVE = 30;
const TYPING_WIDTH = 99, TYPING_BODY = 69, TYPING_DOT = 5, TYPING_PITCH = 20;
const SLIDE_MS = 220, TYPING_FADE_MS = 200, TYPING_STEP_MS = 220;
// The recording's bubble: the waveform in a pill.
const VOICE_PADDING = 12, VOICE_HEIGHT = 36;
// Day labels between the history's days: Gothic Bold 18's cap ink, centred in the row.
const DAY_HEIGHT = 22, DAY_CAP_TOP = 7, DAY_CAP = 11;
// Timings, in milliseconds.
const WAVE_STEP = 70, THINK_AFTER = 300, THINK_MIN = 800;
const FADE_MS = 200, REVEAL_MS = 300, RISE = 40;
// On Up and Down, a card's icon travels as Timeline's pin icons do: its trailing edge
// sets off a sixth of the way through (Timeline's point duration), so the icon stretches
// along the travel and squashes into place.
const STRETCH_POINT = fraction(5, 6);
const PREPARE_MS = 250;   // into a recording (and again later), text is measured

// Each widget: its icon for the cutout and the large one the peek unfolds, and its body
// if not text.
const WIDGETS = {
  weather: [assets.WEATHER_MEDIUM, assets.WEATHER_LARGE, "weather"],
  beeper: [assets.BEEPER_MEDIUM, assets.BEEPER_LARGE],
  reminder: [assets.REMINDER_MEDIUM, assets.REMINDER_LARGE],
  home: [assets.HOME_MEDIUM, assets.HOME_LARGE],
  today: [assets.TODAY_MEDIUM, assets.TODAY_LARGE, "today"],
  web: [assets.WEB_MEDIUM, assets.WEB_LARGE, "", "Source: GDPR, Article 17"],
  map: [assets.PIN_MEDIUM, assets.PIN_LARGE, "map"],
  translate: [assets.TRANSLATE_MEDIUM, assets.TRANSLATE_LARGE, "translate"],
};

// A fading bubble steps through the 64-colour palette from Index blue to the page.
const FADE_BLUES = [render.makeColor(170, 255, 255), render.makeColor(85, 170, 255), VIVID_CERULEAN];

// Once Poco has drawn, Index keeps the drawing context natively too (scroll.c).
let hooked = false;
// A card's icon's rows this frame (iconSpan), one reused pair: no garbage per card.
const span = [0, 0];

export default class Chat {
  // `talk()` is a tap on the microphone.
  constructor(invalidate, talk) {
    // Most changes repaint the whole screen; invalidateArea repaints just a band of it.
    this.requestDraw = invalidate;
    this.invalidate = () => {
      this.dirty = true;
      invalidate();
    };
    this.talk = talk;
    this.items = [];
    this.phase = "idle";
    this.offset = 0;
    this.drawnOffset = 0;   // the offset the screen shows
    this.notice = "";
    const extraLarge = CONTENT_SIZE === EXTRA_LARGE;
    this.headerHeight = extraLarge ? 28 : 20;
    this.clockFont = font("Gothic-Regular", extraLarge ? 24 : 18);
    // Conversation text uses Bobby's per-size fonts (pebble-dev/bobby-assistant
    // util/fonts.c); textTop / textDescender are each font's top bearing and descender.
    if (extraLarge) {
      this.font = font("Gothic-Regular", 36);
      this.textTop = 14;
      this.textDescender = 6;
    } else if (CONTENT_SIZE < MEDIUM) {
      this.font = font("Gothic-Regular", 18);
      this.textTop = 7;
      this.textDescender = 3;
    } else {
      this.font = CONTENT_SIZE === MEDIUM ? font("Gothic-Bold", 24) : font("Gothic-Regular", 28);
      this.textTop = 10;
      this.textDescender = 4;
    }
    this.lineHeight = this.font.height;   // read once: font metrics are a native call
    this.tail = new Poco.PebbleDrawCommandImage(assets.BUBBLE_TAIL).clone();
    this.thinking = new Thinking(() => this.invalidateSlot(), () => this.thinkingDone());
    // The result's icon unfolds and holds within the voice input's band, then flies across
    // the page.
    this.transition = new IconTransition(() => this.transition.isFlying ? this.invalidateFlight() : this.invalidateSlot(),
                                         () => this.landResult(), () => this.finishTurn());
    this.micUnfold = new IconTransition(() => this.invalidateSlot(), undefined, () => this.idle());
    for (const [day, widget, text] of history()) {
      this.items.push(day ? this.size({type: "day", text: day}) : this.makeResult(widget, text));
    }
    this.refreshTime();
    this.layout();
    this.offset = this.scrollTarget = this.maxOffset;
  }

  // --- the page's entries ------------------------------------------------------------

  makeResult(widget, text) {
    return this.size({type: "result", widget: WIDGETS[widget] ? widget : undefined}, text);
  }

  textHeight(lines) {
    return lines.length * this.lineHeight - this.textTop + this.textDescender;
  }

  // Sizes an entry once; the page's fonts and width do not change while it runs.
  size(item, text) {
    item.shade = 255;
    item.rise = 0;
    let x = MARGIN, w = WIDTH - BUBBLE_INSET, h;
    if (item.type === "day") {
      x = 0;
      w = WIDTH;
      h = DAY_HEIGHT;
    } else if (item.type === "voice") {
      w = this.waveform.width + 2 * VOICE_PADDING;
      x = WIDTH - MARGIN - w;
      h = VOICE_HEIGHT;
    } else if (item.type === "query") {
      // The user's pill hugs its widest line: eight pixels of padding each side plus two of
      // slack so the drawn text never re-wraps.
      const measured = measure(text, this.font, w - 16);
      item.lines = measured.lines;
      w = measured.w + 18;
      x = WIDTH - MARGIN - w;
      h = this.textHeight(item.lines) + 18;
    } else if (item.widget) {
      const [, , body, source] = WIDGETS[item.widget];
      x = CARD_MARGIN;
      w = WIDTH - 2 * CARD_MARGIN;
      if (body === "weather") {
        h = WIDGET_BODY + BODY_CLEARANCE;
      } else if (body) {
        h = CARDS[body].height + BODY_CLEARANCE;
      } else {
        item.lines = measure(text, this.font, w - 2 * CARD_TEXT_INSET).lines;
        h = CARD_TEXT_PADDING + this.textHeight(item.lines) + (source ? SOURCE_GAP + SOURCE_CAP : 0) +
            CUT_CLEARANCE;
      }
      // The card itself; the entry also holds the icon hanging below it.
      item.card = h;
      h += ICON_BELOW;
    } else {
      // A plain reply: Index's bubble with its tail.
      item.lines = measure(text, this.font, w - 16).lines;
      h = this.textHeight(item.lines) + 18;
    }
    item.x = x;
    item.w = w;
    item.h = h;
    return item;
  }

  // Places every entry down the page below the time bar, then the voice input's slot. A
  // short history sits at the bottom of the screen, as a messaging app's does.
  layout() {
    // A natural pause (an entry was added or removed): the turn's dropped art and entries
    // are freed here, a 2ms pause on the watch, before the next animation loads its own.
    Debug.gc();
    let top = this.headerHeight + GAP;
    for (const item of this.items) {
      item.y = top;
      top += item.h + GAP;
    }
    const shift = Math.max(0, HEIGHT - top - SLOT_HEIGHT);
    for (const item of this.items) item.y += shift;
    this.slotTop = top + shift;
    this.contentHeight = this.slotTop + SLOT_HEIGHT;
    this.invalidate();
  }

  // Adds an entry at the bottom and scrolls it in, pushing the page up.
  push(item) {
    this.items.push(item);
    this.layout();
    this.setOffset(this.maxOffset, true);
  }

  // Keeps the history to its capacity, oldest first, without leaving a day label alone.
  // The page keeps its place: what was on screen stays there.
  trim() {
    if (this.items.length < CAPACITY) return;
    while (this.items.length >= CAPACITY || this.items[0].type === "day" && this.items[1]?.type === "day") {
      this.items.shift();
    }
    const before = this.slotTop;
    this.layout();
    this.offsetChanged(this.clamp(this.offset - (before - this.slotTop)));
  }

  // --- asking -----------------------------------------------------------------------

  get busy() {
    return this.phase !== "idle";
  }

  // The playtest: records for `ms`, the waveform running in the user's bubble, then
  // transcribes `question`. `answer` ({widget, text}) is Index's result, known up front.
  listen(question, ms, answer) {
    if (this.busy || !this.visible) return false;
    this.beginTurn(question, answer);
    this.phase = "listening";
    this.waveform = new Waveform();
    const voice = this.size({type: "voice"});
    this.push(voice);
    this.waveTimer = setInterval(() => {
      this.waveform.step();
      // Once the bubble has scrolled in, only it repaints.
      if (this.scrollAnimation?.scheduled) this.invalidate();
      else this.invalidateArea(voice.y, voice.y + voice.h);
    }, WAVE_STEP);
    // Wrapping text is many native width measurements, so the message and the result are
    // measured now, while only the waveform moves, not at the transitions that need them.
    this.prepTimer = setTimeout(() => {
      this.prepareQuery();
      this.prepTimer = setTimeout(() => this.prepareResult(), PREPARE_MS);
    }, PREPARE_MS);
    this.timer = setTimeout(() => this.transcribe(), ms);
    return true;
  }

  // A request already transcribed by the system's dictation.
  ask(question, answer) {
    if (this.busy || !question || !question.trim()) return false;
    this.beginTurn(question, answer);
    this.transcribe();
    return true;
  }

  beginTurn(question, answer) {
    this.question = question;
    this.answer = answer;
    this.query = this.prepared = undefined;
    this.trim();
  }

  prepareQuery() {
    this.query ??= this.size({type: "query"}, this.question);
  }

  prepareResult() {
    this.prepTimer = undefined;
    this.prepared ??= this.makeResult(this.answer.widget, this.answer.text);
  }

  // The recording becomes the user's whole message at once, pushed in from the bottom;
  // then Index thinks.
  transcribe() {
    if (this.waveTimer !== undefined) clearInterval(this.waveTimer);
    this.waveTimer = undefined;
    if (this.items[this.items.length - 1].type === "voice") this.items.pop();
    this.waveform = undefined;
    this.phase = "transcribing";
    this.prepareQuery();
    this.push(this.query);
    this.timer = setTimeout(() => this.slide(), THINK_AFTER);
  }

  // Index starts typing: the microphone shrinks to a dot as it slides to the bottom left,
  // where the dot becomes the thinking cube, like a messaging app's avatar beside its
  // typing bubble.
  slide() {
    this.phase = "sliding";
    const from = WIDTH >> 1;
    new Animation(SLIDE_MS, easeInOut, progress => {
      this.micX = from + Math.trunc((CUBE_X - from) * progress / NORMAL_MAX);
      this.micScale = 1 - (1 - MIC_DOT_SCALE) * progress / NORMAL_MAX;
      this.invalidateSlot();
    }, () => this.startThinking()).schedule();
  }

  // The cube grows out of the dot and turns until the answer is ready (at least one turn),
  // then folds away into a dot, which a widget's icon unfolds out of.
  startThinking() {
    this.phase = "thinking";
    if (!this.thinking.start(MIC_DOT_Q8)) {
      this.thinkingDone();
      return;
    }
    this.thinking.setCloseRadius(WIDGET_DOT_RADIUS_Q8);
    this.thinkingAt = now();
    // A result not measured during a recording (the voice build has none) is measured
    // while the cube turns, rather than as it folds away.
    if (!this.prepared && this.prepTimer === undefined) {
      this.prepTimer = setTimeout(() => this.prepareResult(), PREPARE_MS);
    }
    this.timer = setTimeout(() => this.thinking.requestStop(), THINK_MIN);
  }

  thinkingDone() {
    this.phase = "answering";
    this.invalidateSlot();
    this.result();
  }

  // The result has come in: the question fades and the result takes its place, rising in
  // from the bottom. A widget's icon first unfolds out of the cube's dot, holds, then flies
  // into the card's cutout as the card arrives.
  result() {
    if (this.prepTimer !== undefined) clearTimeout(this.prepTimer);
    this.prepareResult();
    const index = this.items.findIndex(item => item.type === "query");
    const item = this.prepared;
    this.pending = [index, item];
    const slot = this.slotTop - this.offset;
    const flying = item.widget && slot >= 0 && slot + SLOT_HEIGHT <= HEIGHT &&
      this.transition.start(WIDGETS[item.widget][1], CUBE_X, slot + SLOT_CENTRE);
    // The question fades out just before the result arrives (only its band repainting); a
    // flying icon lands the result itself, as its flight begins.
    this.timer = setTimeout(() => {
      const query = this.items[index];
      new Animation(FADE_MS, easeInOut, progress => {
        query.shade = 255 - Math.trunc(progress * 255 / NORMAL_MAX);
        this.invalidateArea(query.y, query.y + query.h);
      }, () => {
        if (!flying) this.landResult();
      }).schedule();
    }, flying ? UNFOLD_MS + HOLD_MS - FADE_MS : 0);
  }

  landResult() {
    const [index, item] = this.pending;
    // The question's entry is let go now, not at the next turn: everything kept alive
    // between turns is memory the next turn's art cannot have.
    this.pending = this.query = this.prepared = undefined;
    this.items.splice(index, 1, item);
    item.shade = 0;
    item.rise = RISE;
    this.layout();
    // The page rests at its end, but never with a card's top tucked under the time bar. It
    // goes there at once: a scroll under the icon's flight would redraw the whole screen
    // every frame of it.
    const offset = Math.min(this.maxOffset, item.y - this.headerHeight - 4);
    this.setOffset(offset, false);
    this.invalidate();
    if (this.transition.active) {
      // The icon flies into the card's cutout.
      this.transition.retarget({x: item.x, y: item.y - offset + this.iconTop(item),
                                w: WIDGET_ICON, h: WIDGET_ICON});
      this.landing = item;
      this.flightTop = this.flightBottom = undefined;
    }
    // The result rises into place as it darkens in; only its band repaints.
    new Animation(REVEAL_MS, easeOut, progress => {
      item.rise = RISE - Math.trunc(RISE * progress / NORMAL_MAX);
      item.shade = progress < NORMAL_MAX / 3 ? 85 : progress < NORMAL_MAX * 2 / 3 ? 170 : 255;
      this.invalidateArea(item.y, item.y + item.h + RISE);
    }).schedule();
    if (!this.transition.active) this.finishTurn();
  }

  // The turn is over: the microphone unfolds out of a dot at the centre, as the dictation
  // screen's does, where the page will rest.
  finishTurn() {
    this.landing = undefined;
    this.phase = "regrowing";
    const slot = this.slotTop - this.scrollTarget + SLOT_CENTRE;
    if (!this.micUnfold.start(assets.MIC, WIDTH >> 1, slot, undefined, true)) this.idle();
  }

  // Between turns, the turn's art is let go and collected at once: its native memory (the
  // flown icon, the typing bubble's copy) is invisible to XS, which would otherwise hold
  // it until a collection happened for other reasons.
  idle() {
    this.phase = "idle";
    this.typingArt = undefined;
    Debug.gc();
    this.invalidate();
  }

  // --- scrolling ----------------------------------------------------------------------

  get maxOffset() {
    return Math.max(0, this.contentHeight - HEIGHT);
  }

  clamp(offset) {
    return Math.max(0, Math.min(this.maxOffset, offset));
  }

  setOffset(offset, animated) {
    const target = this.scrollTarget = this.clamp(offset);
    const running = this.scrollAnimation?.scheduled;
    this.scrollAnimation?.unschedule();
    this.scrollAnimation = undefined;
    if (!animated || !this.visible) {
      this.offsetChanged(target);
      return;
    }
    // A ScrollLayer's animation: 250ms ease-in-out, or ease-out when it interrupts one.
    const from = this.offset;
    this.scrollAnimation = new Animation(SCROLL_MS, running ? easeOut : easeInOut, progress => {
      this.offsetChanged(this.clamp(from + Math.trunc((target - from) * progress / NORMAL_MAX)));
    }).schedule();
  }

  offsetChanged(offset) {
    if (offset === this.offset) return;
    this.offset = offset;
    if (this.barVisible) this.showBar();
    this.invalidateScroll();
  }

  // The position bar shows while the reader scrolls and slips away half a second after
  // the page comes to rest. Programmatic scrolls never summon it. A drag calls this for
  // every touch sample, so it only moves the deadline; one timer checks it.
  showBar() {
    this.barUntil = now() + 500;
    this.barVisible = true;
    if (this.barTimer === undefined) this.barTimer = setTimeout(() => this.hideBar(), 500);
  }

  hideBar() {
    const left = this.barUntil - now();
    if (left > 0) {
      this.barTimer = setTimeout(() => this.hideBar(), left);
      return;
    }
    this.barTimer = undefined;
    this.barVisible = false;
    this.invalidate();
  }

  // Up / Down step the page as the original history view did: one visible height less
  // 48 pixels of overlap per press, from wherever the reader is. The page holds still
  // while Index is listening, thinking or answering. The step moves as Timeline's pins
  // do: the moook curve (a wind-up, a jump, an overshoot and a settle), with each card's
  // icon stretching along the travel and squashing as it lands.
  scroll(down) {
    if (!this.visible || this.busy) return;
    const page = HEIGHT - this.headerHeight - 48;
    const from = this.stretch ? this.stretch.target : this.offset;
    const target = this.clamp(from + (down ? page : -page));
    if (target === from) return;
    this.showBar();
    this.scrollAnimation?.unschedule();
    this.scrollTarget = target;
    const stretch = this.stretch = {from, target, progress: 0, frames: 0};
    this.scrollAnimation = new Animation(MOOOK_MS, linear, progress => {
      stretch.progress = progress;
      // The icons' stretched copies are native memory: collected every third frame.
      if (++stretch.frames % 3 === 0) Debug.gc();
      this.offsetChanged(moook(progress, from, target));
    }, () => {
      if (this.stretch === stretch) this.stretch = undefined;
      this.invalidate();
    }).schedule();
  }

  // A Touch sensor sample: [{x, y}] while the finger is down, [] when it lifts. A drag
  // scrolls the page; a tap on the microphone asks.
  touch(points) {
    if (!this.visible || !points) return;
    if (this.busy) {
      this.touchOrigin = undefined;
      return;
    }
    const point = points[0];
    if (point && !this.touchOrigin) {
      this.touchOrigin = point;
      this.touchOffset = this.offset;
      this.dragging = false;
      this.setOffset(this.offset, false);
    } else if (point) {
      const delta = point.y - this.touchOrigin.y;
      if (this.dragging || Math.abs(delta) > 3) {
        if (!this.dragging) this.showBar();
        this.dragging = true;
        this.setOffset(this.touchOffset - delta, false);
      }
    } else if (this.touchOrigin) {
      const slot = this.slotTop - this.offset, y = this.touchOrigin.y;
      if (!this.dragging && y >= slot && y < slot + SLOT_HEIGHT) this.talk();
      this.touchOrigin = undefined;
    }
  }

  // --- showing ------------------------------------------------------------------------

  // @strip dictation
  // A notice in Index's bubble, briefly over the bottom of the page (the voice build).
  showNotice(message) {
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.notice = measure(message, this.font, WIDTH - BUBBLE_INSET - 16).lines;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = undefined;
      this.notice = "";
      this.invalidate();
    }, 3500);
    this.invalidate();
  }
  // @endstrip

  refreshTime() {
    const now = new Date();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    this.clock = watch.hour12
      ? (now.getHours() % 12 || 12) + ":" + minutes + (now.getHours() < 12 ? " AM" : " PM")
      : String(now.getHours()).padStart(2, "0") + ":" + minutes;
    const bearing = this.headerHeight === 28 ? 10 : 7;
    const descender = this.headerHeight === 28 ? 4 : 3;
    const inkHeight = this.clockFont.height - bearing + descender;
    this.clockTop = Math.trunc((this.headerHeight - 1 - inkHeight) / 2) - bearing;
    this.invalidate();
  }

  // The page shows while Index's window is up; dictation's system window hides it, and
  // dictation starts only between turns.
  show() {
    this.refreshTime();
    this.visible = true;
    this.invalidate();
  }

  // @strip dictation
  hide() {
    this.visible = false;
    this.touchOrigin = undefined;
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.notice = "";
  }
  // @endstrip

  // --- drawing --------------------------------------------------------------------------

  // Paints what has changed since the last frame. Most changes repaint the screen, but
  // while only the voice input or the recording animates, just that band is repainted,
  // and a scroll moves the rows already on the screen and paints only what it exposed:
  // on the watch, redrawing every card's text each frame is what makes motion stutter.
  // The frame buffer keeps the rest from the frame before.
  render() {
    const dirty = this.dirty;
    this.dirty = undefined;
    if (dirty === undefined) return;
    if (dirty === "scroll" && !this.notice && this.scrollScreen(this.offset - this.drawnOffset)) {
      // Painted by scrollScreen.
    } else if (dirty === "area" && !this.notice) {
      const top = Math.max(this.headerHeight, this.dirtyTop - this.offset);
      const bottom = Math.min(HEIGHT, this.dirtyBottom - this.offset);
      if (bottom <= top) return;
      render.begin(0, top, WIDTH, bottom - top);
      this.draw(top, bottom);
    } else {
      render.begin();
      this.draw(0, HEIGHT);
    }
    this.drawnOffset = this.offset;
    render.end();
    if (!hooked) {
      // Poco has set the root layer's update proc on this first frame: take it over.
      hooked = true;
      Natives.hookRender();
    }
  }

  // A scrolled frame. The rows on the screen move by the scroll, natively (scroll.c), and
  // only what that exposed is painted: a strip at the bottom or the top, the position
  // bar's column and, on Up and Down, each card's stretching icon, where it was (moved
  // with the rows) and where it is now. Everything else on the page moved with the rows.
  // False when the rows cannot be moved: before the hook is in, or by a whole page.
  scrollScreen(dy) {
    const header = this.headerHeight, step = dy < 0 ? -dy : dy;
    if (!step || step >= HEIGHT - header || !Natives.shiftRows(header, HEIGHT, dy)) return false;
    render.begin();
    // Poco's clip stack on Pebble restores, when a clip is popped, the rectangle it saved
    // when that clip was pushed, and begin() does not set that rectangle: so the whole
    // screen is pushed first, and each band's pop restores the whole screen.
    render.clip(0, 0, WIDTH, HEIGHT);
    if (this.stretch) {
      const items = this.items, offset = this.offset;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (!item.widget || item.shade !== 255 || item === this.landing) continue;
        const y = item.y - offset;
        if (y + item.h <= header || y >= HEIGHT) continue;
        this.iconSpan(item, y);
        let top = span[0], bottom = span[1];
        if (item.iconAt !== undefined) {
          top = Math.min(top, item.iconAt - dy);
          bottom = Math.max(bottom, item.iconEnd - dy);
        }
        this.drawBand(item.x, Math.max(header, top - 1), item.x + CUT_WIDTH, Math.min(HEIGHT, bottom + 1));
      }
    }
    if (dy > 0) this.drawBand(0, HEIGHT - step, WIDTH, HEIGHT);
    else this.drawBand(0, header, WIDTH, header + step);
    // The position bar's column, cleared: nothing else on the page reaches it.
    render.fillRectangle(WHITE, 0, header, BAR_COLUMN, HEIGHT - header);
    if (this.barVisible) this.drawScrollBar();
    // A band at the top of the page reaches one row into the time bar: its rule again.
    render.fillRectangle(WHITE, 0, header - 1, WIDTH, 1);
    render.drawLine(8, header - 1, WIDTH - 8, header - 1, DARK_GRAY, 1);
    render.clip();
    return true;
  }

  // Paints the page within a clip (screen coordinates). The clip starts one row above the
  // band, a row that is not cleared: the firmware draws the first clipped row of an
  // anti-aliased stroke as the stroke's rounded end, which is nothing when the stroke
  // continues above the clip, so a band's first row would lose its strokes. The row above
  // already holds what belongs there.
  drawBand(left, top, right, bottom) {
    if (bottom <= top) return;
    render.clip(left, top - 1, right - left, bottom - top + 1);
    this.draw(top, bottom);
    render.clip();
  }


  // Marks part of the page (page coordinates) to be repainted. `dirty` is true for the
  // whole screen, "area" for the band from dirtyTop to dirtyBottom and "scroll" when
  // only the offset changed; two kinds of change in one frame repaint the screen.
  invalidateArea(top, bottom) {
    if (this.dirty === undefined) {
      this.dirty = "area";
      this.dirtyTop = top;
      this.dirtyBottom = bottom;
    } else if (this.dirty === "area") {
      this.dirtyTop = Math.min(this.dirtyTop, top);
      this.dirtyBottom = Math.max(this.dirtyBottom, bottom);
    } else {
      this.dirty = true;
    }
    this.requestDraw();
  }

  invalidateScroll() {
    if (this.dirty === undefined) this.dirty = "scroll";
    else if (this.dirty !== "scroll") this.dirty = true;
    this.requestDraw();
  }

  // The voice input's band, with 8px either side for an unfolding icon's overshoot.
  invalidateSlot() {
    this.invalidateArea(this.slotTop - 8, this.slotTop + SLOT_HEIGHT + 8);
  }

  // The flying icon's band: where it is now and where it was last frame (page
  // coordinates, with a margin for its stroke), and the card rising to meet it.
  invalidateFlight() {
    const [top, bottom] = this.transition.span(1), offset = this.offset;
    this.invalidateArea(Math.min(top, this.flightTop ?? top) + offset - 3,
                        Math.max(bottom, this.flightBottom ?? bottom) + offset + 3);
    this.flightTop = top;
    this.flightBottom = bottom;
    const item = this.landing;
    if (item) this.invalidateArea(item.y, item.y + item.h + RISE);
  }

  // Draws the screen rows from `top` to `bottom`: the whole screen, or a band of it.
  draw(top, bottom) {
    const offset = this.offset, items = this.items;
    // The page is cleared strip by strip, each just before what goes on it, never all at
    // once: the firmware can copy the frame buffer to the display mid-draw (see main.js),
    // and this way it catches at most one item half drawn, not a white screen. An indexed
    // loop: for...of makes an iterator, every frame.
    let cleared = top;
    for (let index = 0; index < items.length; index++) {
      const item = items[index], y = item.y - offset + item.rise;
      if (y + item.h <= top || y >= bottom) continue;
      const end = Math.min(y + item.h, bottom);
      if (end > cleared) {
        render.fillRectangle(WHITE, 0, cleared, WIDTH, end - cleared);
        cleared = end;
      }
      this.drawItem(item, y);
    }
    if (bottom > cleared) render.fillRectangle(WHITE, 0, cleared, WIDTH, bottom - cleared);
    this.drawSlot(this.slotTop - offset);
    // The result's icon: unfolding and holding in the voice input's band, or flying over
    // the page into its card.
    if (this.transition.active) this.transition.draw();
    if (top > 0) return;
    // The time bar, and the position bar while the reader scrolls.
    render.fillRectangle(WHITE, 0, 0, WIDTH, this.headerHeight);
    drawText(this.clock, this.clockFont, ink(255), (WIDTH - textWidth(this.clock, this.clockFont)) >> 1, this.clockTop);
    render.drawLine(8, this.headerHeight - 1, WIDTH - 8, this.headerHeight - 1, DARK_GRAY, 1);
    if (this.barVisible) this.drawScrollBar();
    // @strip dictation
    if (this.notice) {
      const h = this.textHeight(this.notice) + 18;
      this.drawBubble(MARGIN, HEIGHT - h - MARGIN, WIDTH - BUBBLE_INSET, h, this.notice, 255, true);
    }
    // @endstrip
  }

  drawItem(item, y) {
    const {x, w, h, shade} = item;
    if (item.type === "day") {
      const face = font("Gothic-Bold", 18);
      drawText(item.text, face, DARK_GRAY, (WIDTH - textWidth(item.text, face)) >> 1,
               y + ((DAY_HEIGHT - DAY_CAP) >> 1) - DAY_CAP_TOP);
    } else if (item.type === "voice") {
      render.drawRoundRect(x, y, w, h, VIVID_CERULEAN, PILL_RADIUS, GCORNERS_ALL);
      this.waveform?.draw(x + VOICE_PADDING, y + (h >> 1), WHITE);
    } else if (item.type === "query") {
      // The user's words: a solid pill with no tail, so it never reads as Index. As the
      // result comes in it fades away.
      const step = shade >= 255 ? 3 : Math.trunc(shade * 3 / 255);
      if (!step) return;
      render.drawRoundRect(x, y, w, h, FADE_BLUES[step - 1], PILL_RADIUS, GCORNERS_ALL);
      if (step === 3) this.drawLines(item.lines, WHITE, x + 8, y + 9 - this.textTop);
    } else if (item.widget) {
      this.drawCard(item, y);
    } else {
      this.drawBubble(x, y, w, h, item.lines, shade);
    }
  }

  // Index's reply bubble: the thin grey outline of the home greeting, with its tail.
  drawBubble(x, y, w, h, lines, shade, fill) {
    if (!shade) return;
    const border = ink(Math.min(shade, 170));
    // Filled only over content (the notice): the page's strips are already white.
    if (fill) render.drawRoundRect(x, y, w, h, WHITE, 7, GCORNERS_ALL);
    resetPen();
    render.frameRoundRect(x, y, w, h, border, 7);
    if (this.tailBorder !== border) {
      // Recoloured only when the shade changes, not for every bubble every frame.
      this.tail.process(command => command.stroke = border);
      this.tailBorder = border;
    }
    render.drawDCI(this.tail, x - 5, y + h - 1 - 9);
    render.drawLine(x + 7, y, x + w - 8, y, ink(shade), 1);
    this.drawLines(lines, ink(shade), x + 8, y + 9 - this.textTop, w - 16);
  }

  // Lines of conversation text from `x`. Given the text's `width`, as for Index's own
  // messages, the last line is centred across it.
  drawLines(lines, color, x, top, width) {
    const last = lines.length - 1;
    for (let index = 0; index <= last; index++) {
      const line = lines[index];
      const left = width && index === last ? x + ((width - textWidth(line, this.font)) >> 1) : x;
      drawText(line, this.font, color, left, top + index * this.lineHeight);
    }
  }

  // Where a card's icon sits, from the entry's top: rising into the cutout above the card's
  // bottom edge and hanging below it.
  iconTop(item) {
    return item.card - 1 - ICON_ABOVE;
  }

  // The icon's rows this frame, into `span`, for a card drawn at screen row `y`: at rest,
  // or along an Up or Down step, where the icon's edge facing the travel leads and the
  // other follows, so the icon is stretched over the jump and squashed as the overshoot
  // turns back.
  iconSpan(item, y) {
    const stretch = this.stretch;
    if (!stretch || stretch.progress >= NORMAL_MAX) {
      span[0] = y + this.iconTop(item);
      span[1] = span[0] + WIDGET_ICON;
      return;
    }
    const rest = item.y + this.iconTop(item);
    const startY = rest - stretch.from, endY = rest - stretch.target;
    const first = segmented(stretch.progress, 0, 2, STRETCH_POINT);
    const second = segmented(stretch.progress, 1, 2, STRETCH_POINT);
    const up = endY < startY;
    span[0] = moook(up ? first : second, startY, endY);
    span[1] = moook(up ? second : first, startY + WIDGET_ICON, endY + WIDGET_ICON);
  }

  // A card is Index's reply frame without the tail, all information: the reply's text or
  // the widget's own content. Its bottom-left corner is cut away, the frame simply stopping
  // short, and the widget's icon sits there.
  drawCard(item, y) {
    const {x, w, shade} = item;
    if (!shade) return;
    // Indexed, not destructured: destructuring makes an iterator, every card, every frame.
    const widget = WIDGETS[item.widget], icon = widget[0], body = widget[2], source = widget[3];
    const h = item.card, edge = y + h - 1, quiet = ink(Math.min(shade, 170));
    resetPen();
    render.frameRoundRect(x, y, w, h, quiet, CARD_RADIUS);
    render.drawLine(x + 7, y, x + w - 8, y, ink(shade), 1);
    // The cutout: the frame's corner cleared away, nothing drawn around it.
    render.fillRectangle(WHITE, x, edge - CUT_HEIGHT + 1, CUT_WIDTH, CUT_HEIGHT);
    // The icon, once the card is fully revealed and the flying icon has landed.
    if (shade === 255 && item !== this.landing) {
      this.iconSpan(item, y);
      const top = span[0], height = span[1] - top;
      // Where it was painted, for the next scrolled frame to paint over.
      item.iconAt = top;
      item.iconEnd = span[1];
      if (height === WIDGET_ICON) {
        render.drawDCI(art(icon), x, top);
      } else {
        const copy = art(icon).clone();
        copy.scale(1, Math.max(1, height) / WIDGET_ICON);
        render.drawDCI(copy, x, top);
      }
    }
    if (body === "weather") {
      drawWeather(WEATHER_DEMO, {x, y: y + 1, w}, shade);
    } else if (body) {
      CARDS[body].draw({x, y: y + 1, w}, shade);
    } else {
      const top = y + CARD_TEXT_PADDING;
      this.drawLines(item.lines, ink(shade), x + CARD_TEXT_INSET, top - this.textTop,
                     w - 2 * CARD_TEXT_INSET);
      if (source) {
        drawText(source, font("Gothic-Regular", 14), quiet, x + CARD_TEXT_INSET,
                 top + this.textHeight(item.lines) + SOURCE_GAP - SOURCE_CAP_TOP);
      }
    }
  }

  // The voice input: Pebble's microphone, or, while Index thinks, the cube at the bottom
  // left with its typing bubble.
  drawSlot(top) {
    if (top >= HEIGHT) return;
    const cx = WIDTH >> 1, cy = top + SLOT_CENTRE;
    if (this.thinking.active) {
      this.thinking.draw(CUBE_X, cy);
      this.drawTyping(cy);
    } else if (this.phase === "sliding") {
      drawMic(this.micX, cy, this.micScale);
    } else if (this.phase === "regrowing") {
      this.micUnfold.draw();
    } else if (this.phase !== "answering") {
      drawMic(cx, cy);
    }
  }

  // Index's typing bubble, its stem towards the cube: "•••", the dots darkening in turn. It
  // fades in as the cube appears and out as the cube folds away, its lines stepping
  // through the palette's greys.
  drawTyping(cy) {
    const fade = this.thinking.closing ? 255 - this.thinking.elapsed * 255 / TYPING_FADE_MS
                                       : (now() - this.thinkingAt) * 255 / TYPING_FADE_MS;
    const shade = Math.min(255, Math.max(0, Math.trunc(fade / 85) * 85));
    if (!shade) return;
    // One recolourable copy of the art (only a copy can be processed) is made and kept: a
    // copy per frame would be native memory XS cannot see. Its first shape is the black one
    // that leaves the lines.
    if (!this.typingArt) {
      this.typingArt = new Poco.PebbleDrawCommandImage(assets.TYPING_BUBBLE).clone();
      this.typingShade = undefined;
    }
    if (this.typingShade !== shade) {
      // Recoloured only as the fade steps, not every frame.
      let first = true;
      this.typingArt.process(command => {
        if (first) command.fill = ink(shade);
        first = false;
      });
      this.typingShade = shade;
    }
    const y = cy - TYPING_ABOVE;
    render.drawDCI(this.typingArt, TYPING_X - TYPING_TAIL, y);
    const active = Math.trunc(now() / TYPING_STEP_MS) % 4;
    for (let dot = 0; dot < 3; dot++) {
      render.drawCircle(ink(dot === active ? shade : Math.min(shade, 85)),
                        TYPING_X + (TYPING_WIDTH >> 1) + (dot - 1) * TYPING_PITCH,
                        y + (TYPING_BODY >> 1), TYPING_DOT);
    }
  }

  // The original history view's position bar: a thin dark thumb down the left edge,
  // sized and placed by how much of the page is on screen.
  drawScrollBar() {
    const visible = HEIGHT - this.headerHeight;
    const page = this.contentHeight - this.headerHeight;
    if (page <= visible) return;
    const track = visible - 20;
    const height = Math.max(12, Math.trunc(track * visible / page));
    const top = this.headerHeight + 10 + Math.trunc(this.offset * (track - height) / this.maxOffset);
    render.drawRoundRect(2, top, 2, height, DARK_GRAY, 1, GCORNERS_ALL);
  }
}
