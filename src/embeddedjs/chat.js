// Index's one scrolling page, laid out like a messaging app: the history of what Index has
// done, newest at the bottom, under a slim time bar, and over its end a blue dock across
// the bottom of the screen holding the voice input, Pebble's microphone. The page opens on
// the newest results.
//
// Asking pushes things in from the bottom: the recording's waveform in the user's bubble,
// then the whole transcribed message at once. The microphone then shrinks to a dot as it
// slides to the dock's left, where the dot grows into the thinking cube. When the result
// comes in it takes the words' place, so the history keeps results rather than questions.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {setTimeout, clearTimeout, setInterval, clearInterval} from "timers";
import * as assets from "assets";
import {Animation, NORMAL_MAX, linear, easeInOut, easeOut, now, moook, MOOOK_MS, segmented,
        fraction} from "motion";
import {render, WIDTH, HEIGHT, CONTENT_SIZE, MEDIUM, EXTRA_LARGE, WHITE, DARK_GRAY, VIVID_CERULEAN,
        ink, font, drawText, textWidth, measure, resetPen, art, setBand, inBand} from "theme";
import Thinking from "thinking";
import IconTransition, {UNFOLD_MS, HOLD_MS} from "transition";
import {drawWeather, DEMO as WEATHER_DEMO} from "weather";
import {CARDS} from "cards";
import {drawMic, Waveform} from "mic";
import {history} from "prompts";
// @strip profile
import {stats} from "theme";
// @endstrip

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
// The rich bodies' bottom padding is measured from their last row's caps, so they clear
// the cutout by 15px more for its descenders and the gap.
const BODY_CLEARANCE = CUT_HEIGHT - 4;
const WIDGET_ICON = 36;
// Text is left-aligned, every line, and sits optically centred in its box: as many empty
// rows above its first line's capitals as below its last line's baseline (descenders
// hang into the gap below). A card's text, at its 10px inset, is centred between the
// card's top edge and the top of its icon's ink, 11 rows each side (ICON_INK_TOP: the
// row of each card icon's 36px box where the firmware starts drawing it, measured on the
// emulator); a source line, if any, follows in small type and counts as the text's last
// line. A bubble's text is centred between its edges, 10 rows each side.
const CARD_TEXT_INSET = 10, CARD_TEXT_GAP = 11, BUBBLE_TEXT_GAP = 10;
const SOURCE_GAP = 7, SOURCE_CAP_TOP = 5, SOURCE_CAP = 9;
const ICON_INK_TOP = {beeper: 3, reminder: 0, home: 4, web: 2};
const GCORNERS_ALL = 15;
const SCROLL_MS = 250;   // a ScrollLayer's animated offset
const SNAP_SLACK = 4;    // px: Up / Down pass over a stop this close to where the page is
const STATUS_DIGITS_TOP = 5;
// The position bar's column at the left edge, which nothing else on the page reaches:
// cards start at CARD_MARGIN, a reply's tail 5px inside MARGIN.
const BAR_COLUMN = 6;
// The dock: a bar across the bottom of the screen, over the page's end, in Index blue and
// the height of a PebbleOS notification's coloured banner as the firmware draws it,
// measured on the emery emulator: 49px (the 20px status bar in the banner's colour, then
// the 29px LAYOUT_BANNER_HEIGHT_RECT). The microphone sits at its centre, its art the size
// of the banner's icon (25px, measured; ATTRIBUTE_ICON_TINY_SIZE_PX), as is a result's icon
// as it unfolds there. The thinking cube is larger, 41px at rest (tools/build_cube.py):
// smaller, its faces were lost.
const DOCK_HEIGHT = 49, DOCK_TOP = HEIGHT - DOCK_HEIGHT, DOCK_CENTRE = DOCK_TOP + (DOCK_HEIGHT >> 1);
// While Index thinks, the cube sits at the dock's left, under the cards' icons (their
// cutout's centre), so a widget's icon unfolds there and flies straight up into its card.
// The cube at rest is centred in its frames, so in the dock, and its turns stay inside the
// dock. Going to think, the microphone shrinks to a dot there; the cube grows out of a 3px
// dot and folds back into one.
const CUBE_X = CARD_MARGIN + (WIDGET_ICON >> 1), CUBE_Y = DOCK_CENTRE;
const MIC_DOT_SCALE = 0.12, DOT_Q8 = 256, SLIDE_MS = 220;
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

// Each widget: its icon for the cutout and the 25px one that unfolds in the dock, and its
// body if not text.
const WIDGETS = {
  weather: [assets.WEATHER_MEDIUM, assets.WEATHER_SMALL, "weather"],
  beeper: [assets.BEEPER_MEDIUM, assets.BEEPER_ICON],
  reminder: [assets.REMINDER_MEDIUM, assets.REMINDER_ICON],
  home: [assets.HOME_MEDIUM, assets.HOME_ICON],
  today: [assets.TODAY_MEDIUM, assets.TODAY_ICON, "today"],
  web: [assets.WEB_MEDIUM, assets.WEB_ICON, "", "Source: GDPR, Article 17"],
  map: [assets.PIN_MEDIUM, assets.PIN_ICON, "map"],
  translate: [assets.TRANSLATE_MEDIUM, assets.TRANSLATE_ICON, "translate"],
};

// A fading bubble steps through the 64-colour palette from Index blue to the page.
const FADE_BLUES = [render.makeColor(170, 255, 255), render.makeColor(85, 170, 255), VIVID_CERULEAN];

// Once Poco has drawn, Index keeps the drawing context natively too (scroll.c).
let hooked = false;
// A card's icon's rows this frame (iconSpan), one reused pair, and the frame handed to a
// card's body: no garbage per card per frame.
const span = [0, 0];
const body = {x: 0, y: 0, w: 0};

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
    this.thinking = new Thinking(() => this.invalidateDock(), () => this.thinkingDone());
    // The result's icon unfolds and holds in the dock, then flies up the page.
    this.transition = new IconTransition(() => this.transition.isFlying ? this.invalidateFlight() : this.invalidateDock(),
                                         () => this.landResult(), () => this.finishTurn());
    this.micUnfold = new IconTransition(() => this.invalidateDock(), undefined, () => this.idle());
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

  // The rows from the first line's capitals to the last line's baseline.
  textBlock(lines) {
    return lines.length * this.lineHeight - this.textTop;
  }

  // A bubble's height for its lines, the text centred between its edges.
  bubbleHeight(lines) {
    return this.textBlock(lines) + 2 + 2 * BUBBLE_TEXT_GAP;
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
      h = this.bubbleHeight(item.lines);
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
        // The top edge, the gap, the text (down to the source line's baseline), the gap,
        // then the icon's ink: its box rises ICON_ABOVE rows above the card's bottom edge.
        const block = source ? this.textHeight(item.lines) + SOURCE_GAP + SOURCE_CAP
                             : this.textBlock(item.lines);
        h = 2 * CARD_TEXT_GAP + block - (ICON_INK_TOP[item.widget] ?? 0) + ICON_ABOVE + 2;
      }
      // The card itself; the entry also holds the icon hanging below it.
      item.card = h;
      h += ICON_BELOW;
    } else {
      // A plain reply: Index's bubble with its tail.
      item.lines = measure(text, this.font, w - 16).lines;
      h = this.bubbleHeight(item.lines);
    }
    item.x = x;
    item.w = w;
    item.h = h;
    // A day label is centred across the page: its width measured once here rather than
    // every frame.
    if (item.type === "day") {
      item.textX = (WIDTH - textWidth(item.text, font("Gothic-Bold", 18))) >> 1;
    }
    return item;
  }

  // Places every entry down the page below the time bar. A short history sits at the
  // bottom, just above the dock, as a messaging app's does.
  layout() {
    // A natural pause (an entry was added or removed): the turn's dropped art and entries
    // are freed here, a 2ms pause on the watch, before the next animation loads its own.
    Debug.gc();
    let top = this.headerHeight + GAP;
    for (const item of this.items) {
      item.y = top;
      top += item.h + GAP;
    }
    const shift = Math.max(0, DOCK_TOP - top);
    for (const item of this.items) item.y += shift;
    this.contentHeight = top + shift;
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
    const before = this.contentHeight;
    this.layout();
    this.offsetChanged(this.clamp(this.offset - (before - this.contentHeight)));
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

  // Index starts thinking: the microphone shrinks to a dot as it slides to the dock's left,
  // where the dot becomes the thinking cube.
  slide() {
    this.phase = "sliding";
    const from = WIDTH >> 1;
    this.micX = from;
    this.micY = DOCK_CENTRE;
    this.micScale = 1;
    new Animation(SLIDE_MS, easeInOut, progress => {
      this.micX = from + Math.trunc((CUBE_X - from) * progress / NORMAL_MAX);
      this.micY = DOCK_CENTRE + Math.trunc((CUBE_Y - DOCK_CENTRE) * progress / NORMAL_MAX);
      this.micScale = 1 - (1 - MIC_DOT_SCALE) * progress / NORMAL_MAX;
      this.invalidateDock();
    }, () => this.startThinking()).schedule();
  }

  // The cube grows out of the dot and turns until the answer is ready (at least one turn),
  // then folds away into a dot, which a widget's icon unfolds out of.
  startThinking() {
    this.phase = "thinking";
    if (!this.thinking.start(DOT_Q8)) {
      this.thinkingDone();
      return;
    }
    this.thinking.setCloseRadius(DOT_Q8);
    // A result not measured during a recording (the voice build has none) is measured
    // while the cube turns, rather than as it folds away.
    if (!this.prepared && this.prepTimer === undefined) {
      this.prepTimer = setTimeout(() => this.prepareResult(), PREPARE_MS);
    }
    this.timer = setTimeout(() => this.thinking.requestStop(), THINK_MIN);
  }

  thinkingDone() {
    this.phase = "answering";
    this.invalidateDock();
    this.result();
  }

  // The result has come in: the question fades and the result takes its place, rising in
  // from the bottom. A widget's icon first unfolds out of the cube's dot in the dock, holds,
  // then flies into the card's cutout as the card arrives.
  result() {
    if (this.prepTimer !== undefined) clearTimeout(this.prepTimer);
    this.prepareResult();
    const index = this.items.findIndex(item => item.type === "query");
    const item = this.prepared;
    this.pending = [index, item];
    const flying = item.widget &&
      this.transition.start(WIDGETS[item.widget][1], CUBE_X, DOCK_CENTRE, undefined, false, CUBE_X, CUBE_Y);
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
    // The page rests at its end, but never with a card's top tucked under the time bar,
    // unless the card is taller than the page above the dock: then its icon, where the
    // flight lands, stays clear of the dock. It goes there at once: a scroll under the
    // icon's flight would redraw the whole screen every frame of it.
    const offset = Math.min(this.maxOffset, Math.max(item.y - this.headerHeight - 4,
                                                     item.y + item.h + GAP - DOCK_TOP));
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

  // The turn is over: the microphone unfolds out of a dot at the dock's centre, as the
  // dictation screen's does.
  finishTurn() {
    this.landing = undefined;
    this.phase = "regrowing";
    if (!this.micUnfold.start(assets.MIC_SMALL, WIDTH >> 1, DOCK_CENTRE, undefined, true)) this.idle();
  }

  // Between turns, the turn's art is let go and collected at once: its native memory (the
  // flown icon) is invisible to XS, which would otherwise hold it until a collection
  // happened for other reasons.
  idle() {
    this.phase = "idle";
    Debug.gc();
    this.invalidate();
  }

  // --- scrolling ----------------------------------------------------------------------

  get maxOffset() {
    return Math.max(0, this.contentHeight - DOCK_TOP);
  }

  clamp(offset) {
    return Math.max(0, Math.min(this.maxOffset, offset));
  }

  setOffset(offset, animated) {
    const target = this.scrollTarget = this.clamp(offset);
    const running = this.scrollAnimation?.scheduled;
    this.scrollAnimation?.unschedule();
    this.scrollAnimation = undefined;
    // An Up / Down step cut short (by a turn's scroll, or a touch) never reaches its end:
    // its icons stand straight again here.
    if (this.stretch) this.endStep();
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

  // Up / Down move the page between its stops (nextStop), from wherever the reader is.
  // The page holds still while Index is listening, thinking or answering. The step moves
  // as Timeline's pins do: the moook curve (a wind-up, a jump, an overshoot and a settle),
  // with each card's icon stretching along the travel and squashing as it lands.
  scroll(down) {
    if (!this.visible || this.busy) return;
    const from = this.stretch ? this.stretch.target : this.offset;
    const target = this.nextStop(from, down);
    if (target === undefined) return;
    this.showBar();
    this.scrollAnimation?.unschedule();
    this.scrollTarget = target;
    // A fresh step: each visible icon stands at rest in its cutout, on white, and its
    // pixels are kept natively (scroll.c) to be stretched by rows each frame, far cheaper
    // than drawing the stretched vector art. Up or Down again mid-step: the screen's icons
    // belong to the step before, so the next frame repaints the page rather than work
    // from where they were.
    if (!this.stretch) this.captureIcons();
    else this.invalidate();
    // `drawn` is the progress of the frame on the screen (scrollScreen).
    const stretch = this.stretch = {from, target, progress: 0, drawn: 0};
    this.scrollAnimation = new Animation(MOOOK_MS, linear, progress => {
      stretch.progress = progress;
      const offset = moook(progress, from, target);
      // The icons stretch on their own while the page holds (the wind-up's first frame).
      if (offset !== this.offset) this.offsetChanged(offset);
      else this.invalidateScroll();
    }, () => {
      if (this.stretch === stretch) this.endStep();
    }).schedule();
  }

  // The page's stop after `from`, going down (or before it, going up), or undefined at the
  // end. Each message has two: its top, a GAP below the time bar, and its icon at the
  // bottom, a GAP above the dock. A message comes into focus at the edge it enters from:
  // going down, at its top, then its icon; going up, at its icon, then its top. One that
  // shows whole, icon and all, at either has just the first. A day label goes with the
  // message under it: that message's top stop shows the label above it. Stops within
  // SNAP_SLACK of `from` are passed over, so a press always moves the page.
  nextStop(from, down) {
    const header = this.headerHeight, items = this.items;
    let best, label;
    const consider = stop => {
      if (down ? stop > from + SNAP_SLACK && (best === undefined || stop < best)
               : stop < from - SNAP_SLACK && (best === undefined || stop > best)) {
        best = stop;
      }
    };
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.type === "day") {
        label ??= item.y;
        continue;
      }
      const top = this.clamp((label ?? item.y) - header - GAP);
      const bottom = this.clamp(item.y + item.h + GAP - DOCK_TOP);
      label = undefined;
      if (down) {
        consider(top);
        if (bottom > top) consider(bottom);
      } else {
        consider(bottom);
        if (top < bottom) consider(top);
      }
    }
    return best;
  }

  // The icons on the screen (at the offset drawn, which a pending frame may not yet show)
  // that are wholly on it, copied off it for the step.
  captureIcons() {
    const header = this.headerHeight, items = this.items, offset = this.drawnOffset;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item.widget || item.shade !== 255 || item === this.landing) continue;
      const top = item.y - offset + this.iconTop(item);
      if (top >= header && top + WIDGET_ICON <= DOCK_TOP) {
        Natives.iconCapture(WIDGETS[item.widget][0], item.x, top);
      }
    }
  }

  // The step is over, or cut short: the icons stand straight again, and the stretched
  // icons' native memory (scroll.c) is freed.
  endStep() {
    this.stretch = undefined;
    Natives.stretchRelease();
    this.invalidate();
  }

  // A Touch sensor sample: [{x, y}] while the finger is down, [] when it lifts. A drag
  // scrolls the page; a tap on the dock asks.
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
      if (!this.dragging && this.touchOrigin.y >= DOCK_TOP) this.talk();
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
    // The time sits where the firmware's status bar puts it (STATUS_BAR_LAYER_HEIGHT 20,
    // Gothic 18: the digits from row 5, measured on the emery emulator); the Extra Large
    // bar centres its larger type.
    const bearing = this.headerHeight === 28 ? 10 : 7;
    const descender = this.headerHeight === 28 ? 4 : 3;
    const inkHeight = this.clockFont.height - bearing + descender;
    this.clockTop = this.headerHeight === 28 ? Math.trunc((this.headerHeight - 1 - inkHeight) / 2) - bearing
                                             : STATUS_DIGITS_TOP - bearing;
    this.clockX = (WIDTH - textWidth(this.clock, this.clockFont)) >> 1;
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

  // Paints what has changed since the last frame, and says whether it submitted a frame.
  // Most changes repaint the whole screen, but while only the dock or the recording
  // animates, just that band is repainted, and a scroll moves the page's rows already on
  // the screen and paints only what it exposed: on the watch, redrawing every card's text
  // each frame is what makes motion stutter. The dock repaints on its own, along with
  // whatever else the frame paints. The frame buffer keeps the rest from the frame before.
  render() {
    const dirty = this.dirty, dock = this.dockDirty;
    this.dirty = this.dockDirty = undefined;
    if (dirty === undefined && !dock) return;
    if (dirty === "scroll" && !this.notice && this.scrollScreen(this.offset - this.drawnOffset, dock)) {
      // Painted by scrollScreen.
    } else if (dirty !== true && dirty !== "scroll" && !this.notice) {
      // A band of the page, the dock, or both in one band down to the bottom.
      let top = DOCK_TOP, bottom = HEIGHT;
      if (dirty === "area") {
        top = Math.max(this.headerHeight, this.dirtyTop - this.offset);
        if (dock) top = Math.min(top, DOCK_TOP);
        else bottom = Math.min(HEIGHT, this.dirtyBottom - this.offset);
        if (bottom <= top) return;
      }
      render.begin(0, top, WIDTH, bottom - top);
      this.draw(top, bottom);
    } else {
      render.begin();
      this.draw(0, HEIGHT);
    }
    this.drawnOffset = this.offset;
    if (this.stretch) this.stretch.drawn = this.stretch.progress;
    render.end();
    if (!hooked) {
      // Poco has set the root layer's update proc on this first frame: take it over.
      hooked = true;
      Natives.hookRender();
    }
    // A frame is on its way to the display (main.js paces the next by its copy); a render
    // that paints nothing submits nothing.
    return true;
  }

  // A scrolled frame. The page's rows on the screen (between the time bar and the dock)
  // move by the scroll, natively (scroll.c), and only what that exposed is painted: a strip
  // at the bottom or the top and the position bar's column, and the dock when it changed
  // too. Everything else on the page moved with the rows, except, in an Up /
  // Down step, the icons, which stretch instead. Each is painted again over the rows it
  // covered last frame (moved with the rows) and covers now, in its 40px column, bands
  // that meet merged so every icon is drawn once; the strip leaves them out. False when
  // the rows cannot be moved: before the hook is in, or by a whole page.
  scrollScreen(dy, dock) {
    const header = this.headerHeight, step = dy < 0 ? -dy : dy, stretch = this.stretch;
    if (!hooked || step >= DOCK_TOP - header || (!step && !stretch)) return false;
    // @strip profile
    let mark = now();
    // @endstrip
    if (step && !Natives.shiftRows(header, DOCK_TOP, dy)) return false;
    // @strip profile
    stats.shift += now() - mark;
    mark = now();
    // @endstrip
    render.begin();
    // Poco's clip stack on Pebble restores, when a clip is popped, the rectangle it saved
    // when that clip was pushed, and begin() does not set that rectangle: so the whole
    // screen is pushed first, and each band's pop restores the whole screen.
    render.clip(0, 0, WIDTH, HEIGHT);
    this.iconsHeld = stretch !== undefined;
    if (dy > 0) this.drawBand(0, DOCK_TOP - step, WIDTH, DOCK_TOP);
    else if (dy < 0) this.drawBand(0, header, WIDTH, header + step);
    this.iconsHeld = false;
    // @strip profile
    stats.strip += now() - mark;
    mark = now();
    // @endstrip
    if (stretch) {
      const items = this.items, drawn = this.drawnOffset, offset = this.offset;
      let top = 0, bottom = 0;
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        if (!item.widget || item.shade !== 255 || item === this.landing) continue;
        // Where the icon was last frame, moved with the rows, and where it is now.
        this.iconSpan(item, item.y - drawn, stretch.drawn);
        const from = span[0] - dy, to = span[1] - dy;
        this.iconSpan(item, item.y - offset, stretch.progress);
        const first = Math.max(header, Math.min(from, span[0]) - 1);
        const last = Math.min(DOCK_TOP, Math.max(to, span[1]) + 1);
        if (last <= first) continue;
        if (bottom > top && first <= bottom) {
          bottom = Math.max(bottom, last);
        } else {
          this.drawBand(CARD_MARGIN, top, CARD_MARGIN + CUT_WIDTH, bottom);
          top = first;
          bottom = last;
        }
      }
      this.drawBand(CARD_MARGIN, top, CARD_MARGIN + CUT_WIDTH, bottom);
    }
    // @strip profile
    stats.icons += now() - mark;
    mark = now();
    // @endstrip
    // The position bar's column, cleared: nothing else on the page reaches it.
    render.fillRectangle(WHITE, 0, header, BAR_COLUMN, DOCK_TOP - header);
    if (this.barVisible) this.drawScrollBar();
    if (dock) this.drawBand(0, DOCK_TOP, WIDTH, HEIGHT);
    // A band at the top of the page reaches one row into the time bar: its rule again.
    render.fillRectangle(WHITE, 0, header - 1, WIDTH, 1);
    render.drawLine(8, header - 1, WIDTH - 8, header - 1, DARK_GRAY, 1);
    render.clip();
    // @strip profile
    stats.rest += now() - mark;
    // @endstrip
    return true;
  }

  // A card's icon `height` rows tall from `top`: stretched natively (scroll.c), or as
  // built when it stands straight (or the stretched copy could not be made).
  drawIcon(item, top, height) {
    const icon = WIDGETS[item.widget][0];
    if (height === WIDGET_ICON ||
        !Natives.stretchIcon(icon, item.x, top, height, WIDGET_ICON, this.bandTop, this.bandBottom)) {
      render.drawDCI(art(icon), item.x, top);
    }
  }

  // Paints the page within a clip (screen coordinates). The clip starts one row above the
  // band, a row that is not cleared: the firmware draws the first clipped row of an
  // anti-aliased stroke as the stroke's rounded end, which is nothing when the stroke
  // continues above the clip, so a band's first row would lose its strokes. The row above
  // already holds what belongs there.
  drawBand(left, top, right, bottom) {
    if (bottom <= top) return;
    render.clip(left, top - 1, right - left, bottom - top + 1);
    this.draw(top, bottom, right);
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

  // The dock, repainted on its own (render).
  invalidateDock() {
    this.dockDirty = true;
    this.requestDraw();
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
  draw(top, bottom, right = WIDTH) {
    const offset = this.offset, items = this.items;
    // A band's clip starts a row above it (drawBand). The rows are kept for the native
    // icon blit, which cannot read the context's clip.
    setBand(top - 1, bottom, right);
    this.bandTop = top - 1;
    this.bandBottom = bottom;
    // The page, which the dock covers from DOCK_TOP. It is cleared strip by strip, each
    // just before what goes on it, never all at once: the firmware can copy the frame
    // buffer to the display mid-draw (see main.js), and this way it catches at most one
    // item half drawn, not a white screen. An indexed loop: for...of makes an iterator,
    // every frame. An entry reaching under the dock is drawn there too, and covered.
    const page = Math.min(bottom, DOCK_TOP);
    if (page > top) {
      let cleared = top;
      for (let index = 0; index < items.length; index++) {
        const item = items[index], y = item.y - offset + item.rise;
        if (y + item.h <= top || y >= page) continue;
        const end = Math.min(y + item.h, page);
        if (end > cleared) {
          render.fillRectangle(WHITE, 0, cleared, WIDTH, end - cleared);
          cleared = end;
        }
        this.drawItem(item, y);
      }
      if (page > cleared) render.fillRectangle(WHITE, 0, cleared, WIDTH, page - cleared);
    }
    if (bottom > DOCK_TOP) this.drawDock();
    // The result's icon: unfolding and holding in the dock, or flying up the page into its
    // card.
    if (this.transition.active) this.transition.draw();
    setBand(-32768, 32767, 32767);
    if (top > 0) return;
    // The time bar, and the position bar while the reader scrolls.
    render.fillRectangle(WHITE, 0, 0, WIDTH, this.headerHeight);
    drawText(this.clock, this.clockFont, ink(255), this.clockX, this.clockTop);
    render.drawLine(8, this.headerHeight - 1, WIDTH - 8, this.headerHeight - 1, DARK_GRAY, 1);
    if (this.barVisible) this.drawScrollBar();
    // @strip dictation
    if (this.notice) {
      const h = this.bubbleHeight(this.notice);
      this.drawBubble(MARGIN, DOCK_TOP - h - MARGIN, WIDTH - BUBBLE_INSET, h, this.notice, 255, true);
    }
    // @endstrip
  }

  drawItem(item, y) {
    const {x, w, h, shade} = item;
    if (item.type === "day") {
      drawText(item.text, font("Gothic-Bold", 18), DARK_GRAY, item.textX,
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
      if (step === 3) this.drawLines(item.lines, WHITE, x + 8, y + 1 + BUBBLE_TEXT_GAP - this.textTop);
    } else if (item.widget) {
      this.drawCard(item, y);
    } else {
      this.drawBubble(x, y, w, h, item.lines, shade, false);
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
    this.drawLines(lines, ink(shade), x + 8, y + 1 + BUBBLE_TEXT_GAP - this.textTop);
  }

  // Lines of conversation text, left-aligned at `x`, the first line's box at `top`.
  drawLines(lines, color, x, top) {
    for (let index = 0; index < lines.length; index++) {
      drawText(lines[index], this.font, color, x, top + index * this.lineHeight);
    }
  }

  // Where a card's icon sits, from the entry's top: rising into the cutout above the card's
  // bottom edge and hanging below it.
  iconTop(item) {
    return item.card - 1 - ICON_ABOVE;
  }

  // The icon's rows into `span`, for a card drawn at screen row `y`, at a step's
  // `progress` (this frame's by default): at rest, or along an Up or Down step, where the
  // icon's edge facing the travel leads and the other follows, so the icon is stretched
  // over the jump and squashed as the overshoot turns back.
  iconSpan(item, y, progress = this.stretch?.progress ?? NORMAL_MAX) {
    const stretch = this.stretch;
    if (progress >= NORMAL_MAX) {
      span[0] = y + this.iconTop(item);
      span[1] = span[0] + WIDGET_ICON;
      return;
    }
    const rest = item.y + this.iconTop(item);
    const startY = rest - stretch.from, endY = rest - stretch.target;
    const first = segmented(progress, 0, 2, STRETCH_POINT);
    const second = segmented(progress, 1, 2, STRETCH_POINT);
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
    const widget = WIDGETS[item.widget], source = widget[3];
    const h = item.card, edge = y + h - 1, quiet = ink(Math.min(shade, 170));
    resetPen();
    render.frameRoundRect(x, y, w, h, quiet, CARD_RADIUS);
    render.drawLine(x + 7, y, x + w - 8, y, ink(shade), 1);
    // The cutout: the frame's corner cleared away, nothing drawn around it.
    render.fillRectangle(WHITE, x, edge - CUT_HEIGHT + 1, CUT_WIDTH, CUT_HEIGHT);
    // The icon, once the card is fully revealed and the flying icon has landed (and not
    // in a step's exposed strip, as its column is painted next: scrollScreen).
    if (shade === 255 && item !== this.landing && !this.iconsHeld) {
      this.iconSpan(item, y);
      if (inBand(span[0], span[1])) this.drawIcon(item, span[0], span[1] - span[0]);
    }
    if (!inBand(y, y + h)) return;
    body.x = x;
    body.y = y + 1;
    body.w = w;
    if (widget[2] === "weather") {
      drawWeather(WEATHER_DEMO, body, shade);
    } else if (widget[2]) {
      CARDS[widget[2]].draw(body, shade);
    } else {
      // The first line's capitals, the gap below the card's top edge.
      const top = y + 1 + CARD_TEXT_GAP;
      this.drawLines(item.lines, ink(shade), x + CARD_TEXT_INSET, top - this.textTop);
      if (source) {
        drawText(source, font("Gothic-Regular", 14), quiet, x + CARD_TEXT_INSET,
                 top + this.textHeight(item.lines) + SOURCE_GAP - SOURCE_CAP_TOP);
      }
    }
  }

  // The dock: Pebble's microphone at its centre, sliding left as it shrinks to a dot; the
  // cube, while Index thinks, at the left; then (while a result's icon unfolds and flies
  // off) nothing, until the microphone unfolds again.
  drawDock() {
    render.fillRectangle(VIVID_CERULEAN, 0, DOCK_TOP, WIDTH, DOCK_HEIGHT);
    if (this.thinking.active) {
      this.thinking.draw(CUBE_X, CUBE_Y);
    } else if (this.phase === "sliding") {
      drawMic(this.micX, this.micY, this.micScale);
    } else if (this.phase === "regrowing") {
      this.micUnfold.draw();
    } else if (this.phase !== "answering") {
      drawMic(WIDTH >> 1, DOCK_CENTRE);
    }
  }

  // The original history view's position bar: a thin dark thumb down the left edge,
  // sized and placed by how much of the page is on screen.
  drawScrollBar() {
    const visible = DOCK_TOP - this.headerHeight;
    const page = this.contentHeight - this.headerHeight;
    if (page <= visible) return;
    const track = visible - 20;
    const height = Math.max(12, Math.trunc(track * visible / page));
    const top = this.headerHeight + 10 + Math.trunc(this.offset * (track - height) / this.maxOffset);
    render.drawRoundRect(2, top, 2, height, DARK_GRAY, 1, GCORNERS_ALL);
  }
}
