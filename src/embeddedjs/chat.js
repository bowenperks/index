// Index's one scrolling page, laid out like a messaging app: the history of what Index has
// done, newest at the bottom, under a slim time bar, and below it the dock: a dotted
// divider across the screen with the voice input, Pebble's microphone in a blue bubble,
// sitting on it. The page opens on the newest results.
//
// Asking opens the microphone's bubble across the divider, the recording's waveform
// running along it in white; then that bubble becomes the user's whole message, pushing
// itself up into the page, and the thinking cube grows where the microphone was. When the
// result comes in it takes the words' place, so the history keeps results rather than
// questions.
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
import {drawMic, drawMicScaled, Waveform, BARS as WAVE_BARS} from "mic";
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
// The dock: the screen's bottom 49px, below the page. Across it, the Weather app's
// mainscreen divider (45 Dark Gray dots, 2px square, 4px apart, centred: weather_app_
// layout.c), 20px down; on it, centred, the microphone in a blue bubble (Index blue, 36px
// across), black with its capsule white inside, filling the bubble but for 4 rows above
// and below (mic.js). The divider's
// middle third (DIVIDER_SIDE dots each side of it) is left out, always the same, whatever
// sits there: room for the largest, a result's icon unfolding past the cube's size, 4px
// clear of it (FLOAT_REACH). Below the divider is the bar, the 29px of
// a PebbleOS notification's banner under its status bar (LAYOUT_BANNER_HEIGHT_RECT),
// white. While the user speaks the bubble opens across the divider (below) and the
// divider's middle dots, white, are the recording's waveform: each grows up and down from
// its place as the voice comes in from the right (mic.js).
// The page draws down to the top of the dock (PAGE_BOTTOM) and rests a GAP above it, its
// last entry and every Up / Down stop, so the rows above the divider stay clear, as drawn;
// drawn to the divider, the next entry's top showed there under the bubble at every stop.
// What sits on the divider can reach a little above the dock (FLOAT_*: the most it covers,
// the cube's frames), over the page.
const DOCK_HEIGHT = 49, DOCK_TOP = HEIGHT - DOCK_HEIGHT;
const BAR_HEIGHT = 29, BAR_TOP = HEIGHT - BAR_HEIGHT;
const PAGE_BOTTOM = DOCK_TOP;
const DIVIDER_DOTS = 45, DIVIDER_PITCH = 4, DIVIDER_DOT = 2, DIVIDER_SIDE = 15;
const DIVIDER_LEFT = (WIDTH - ((DIVIDER_DOTS - 1) * DIVIDER_PITCH + DIVIDER_DOT)) >> 1;
// The bubble's centre: Poco's drawCircle fills the 36px square from (x - r, y - r), so its
// middle is the edge between rows y - 1 and y, which is the 2px divider's middle (rows
// BAR_TOP and BAR_TOP + 1): 17 rows of bubble above the divider and 17 below.
const DOCK_X = WIDTH >> 1, BUBBLE_Y = BAR_TOP + 1, BUBBLE_RADIUS = 18;
// While Index thinks, the cube takes the bubble's place, centred on the divider too: once
// the user's bubble has risen out of the dock, the cube grows out of a 3px dot there and
// folds back into one, which a widget's icon unfolds out of, as big as the cube
// (tools/build_assets.py dock_icon), before it flies up into its card. 41px at rest, 45px
// as it turns (tools/build_cube.py): smaller, the cube lost its faces. FLOAT_REACH is the
// furthest either reaches from the centre: the largest icon's 46px canvas, 4px past it
// unfolding.
const CUBE_Y = BUBBLE_Y, DOT_Q8 = 256;
const FLOAT_REACH = 27;
const FLOAT_TOP = CUBE_Y - FLOAT_REACH, FLOAT_LEFT = DOCK_X - FLOAT_REACH - 1;
const FLOAT_RIGHT = DOCK_X + FLOAT_REACH + 1;
// Asking, all at once: the microphone squashes flat into the middle of its bubble
// (SQUASH_MS, eased in), as the bubble springs open sideways (EXPAND_MS, a little past
// the divider's width and back) into a rectangular bubble as wide as the divider and as
// tall as the microphone's, its corners from the circle's to the user's bubbles'
// PILL_RADIUS. The opening reveals the waveform, its bars on the middle 31 of the
// divider's dots: a ripple runs out from the middle, each bar coming in RIPPLE_STAGGER
// after the one inside it (once the bubble's edge is REVEAL_MARGIN past it, where even
// its tallest is inside the rounded end), rising up to RIPPLE_PEAK rows (less further
// out) and settling to its level over RIPPLE_MS.
const SQUASH_MS = 150, EXPAND_MS = 300;
const RIPPLE_DELAY = 50, RIPPLE_STAGGER = 16, RIPPLE_MS = 240;
const LISTEN_WIDTH = (DIVIDER_DOTS - 1) * DIVIDER_PITCH + DIVIDER_DOT;
const REVEAL_MARGIN = 9, RIPPLE_PEAK = 10;
const WAVE_HALF = WAVE_BARS >> 1;
const WAVE_LEFT = DIVIDER_LEFT + ((DIVIDER_DOTS - WAVE_BARS) >> 1) * DIVIDER_PITCH;
const OPEN_MS = RIPPLE_DELAY + WAVE_HALF * RIPPLE_STAGGER + RIPPLE_MS;
// The words in, that bubble conforms to the user's bubble and pushes itself up into the
// page as it (LIFT_MS), the waveform drawing back into its middle over the first WAVE_OUT
// of the way (of NORMAL_MAX).
const LIFT_MS = 300, WAVE_OUT = NORMAL_MAX * 2 / 5 | 0;
// As the result comes in, the user's words go as an unsent message does in iOS Messages,
// in a puff (POOF_MS): the words fade as the bubble draws in a little (POOF_WORDS_MS),
// then the bubble falls in on its middle, eased in (POOF_COLLAPSE_MS), paling for the
// last of it (from POOF_PALE of the way), bursting into bits of its blue (one for every
// POOF_AREA square pixels of it, POOF_MIN to POOF_MAX, from all over it) that drift out up
// to POOF_SPREAD and up to POOF_RISE more, eased out, shrinking and paling into the page.
const POOF_MS = 500, POOF_WORDS_MS = 90, POOF_COLLAPSE_MS = 240, POOF_PALE = 0.55;
const POOF_AREA = 70, POOF_MIN = 40, POOF_MAX = 160, POOF_SPREAD = 22, POOF_RISE = 8;
// Day labels between the history's days: Gothic Bold 18's cap ink, centred in the row.
const DAY_HEIGHT = 22, DAY_CAP_TOP = 7, DAY_CAP = 11;
// Timings, in milliseconds.
const WAVE_STEP = 70, THINK_MIN = 800;
const FADE_MS = 200, REVEAL_MS = 300, RISE = 40;
// On Up and Down, a card's icon travels as Timeline's pin icons do: its trailing edge
// sets off a sixth of the way through (Timeline's point duration), so the icon stretches
// along the travel and squashes into place.
const STRETCH_POINT = fraction(5, 6);
const PREPARE_MS = 250;   // into a recording (and again later), text is measured

// Each widget: its icon for the cutout and the cube-sized one that unfolds in the dock,
// and its body if not text.
const WIDGETS = {
  weather: [assets.WEATHER_MEDIUM, assets.WEATHER_DOCK, "weather"],
  beeper: [assets.BEEPER_MEDIUM, assets.BEEPER_DOCK],
  reminder: [assets.REMINDER_MEDIUM, assets.REMINDER_DOCK],
  home: [assets.HOME_MEDIUM, assets.HOME_DOCK],
  today: [assets.TODAY_MEDIUM, assets.TODAY_DOCK, "today"],
  web: [assets.WEB_MEDIUM, assets.WEB_DOCK, "", "Source: GDPR, Article 17"],
  map: [assets.PIN_MEDIUM, assets.PIN_DOCK, "map"],
  translate: [assets.TRANSLATE_MEDIUM, assets.TRANSLATE_DOCK, "translate"],
};

// A fading bubble steps through the 64-colour palette from Index blue to the page.
const FADE_BLUES = [render.makeColor(170, 255, 255), render.makeColor(85, 170, 255), VIVID_CERULEAN];

// Once Poco has drawn, Index keeps the drawing context natively too (scroll.c).
let hooked = false;
// A card's icon's rows this frame (iconSpan), one reused pair, and the frame handed to a
// card's body: no garbage per card per frame.
const span = [0, 0];
const body = {x: 0, y: 0, w: 0};

// The recording's bubble `open` (0 to NORMAL_MAX) of the way from the microphone's circle
// to the divider's width: its left edge, width and corner radius, into `shape`. Here and
// throughout this file, `| 0` truncates as Math.trunc would, in less code than the call:
// what it truncates is never more than NORMAL_MAX, far inside its 32 bits.
const shape = [0, 0, 0];
const openShape = open => {
  const left = DOCK_X - BUBBLE_RADIUS, size = 2 * BUBBLE_RADIUS;
  shape[0] = left - ((left - DIVIDER_LEFT) * open / NORMAL_MAX | 0);
  shape[1] = size + ((LISTEN_WIDTH - size) * open / NORMAL_MAX | 0);
  shape[2] = BUBBLE_RADIUS - ((BUBBLE_RADIUS - PILL_RADIUS) * open / NORMAL_MAX | 0);
};

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

  // The playtest: records for `ms`, the waveform running in the dock's blue bubble, then
  // transcribes `question`. `answer` ({widget, text}) is Index's result, known up front.
  listen(question, ms, answer) {
    if (this.busy || !this.visible) return false;
    this.beginTurn(question, answer, true);
    this.phase = "listening";
    this.waveform = new Waveform();
    this.expand = 0;
    this.waveHalf = -1;
    this.micSquash = 0;
    // Each bar's rise above its level as the ripple passes, by its distance from the middle.
    const bumps = this.waveBumps = new Int8Array(WAVE_HALF + 1);
    this.listenAnimation = new Animation(OPEN_MS, linear, progress => {
      const time = progress * OPEN_MS / NORMAL_MAX;
      // The bubble: an ease-out-back, quick off the mark, a little past the end and back.
      const u = Math.min(1, time / EXPAND_MS) - 1;
      this.expand = NORMAL_MAX * (1 + 2 * u * u * u + u * u) | 0;
      // The microphone: eased in, so it starts to squash gently and goes flat quickly.
      const squash = Math.min(1, time / SQUASH_MS);
      this.micSquash = squash * squash;
      openShape(this.expand);
      const inside = (shape[1] >> 1) - REVEAL_MARGIN;
      for (let bar = 0; bar <= WAVE_HALF; bar++) {
        const start = RIPPLE_DELAY + bar * RIPPLE_STAGGER;
        // The bars from here out are not in yet: not their turn, or the edge not past them.
        if (bar > this.waveHalf && (time < start || bar * DIVIDER_PITCH + 1 > inside)) break;
        this.waveHalf = Math.max(this.waveHalf, bar);
        const ripple = (time - start) / RIPPLE_MS;
        bumps[bar] = ripple > 0 && ripple < 1
          ? Math.round((RIPPLE_PEAK - (bar >> 1)) * Math.sin(Math.PI * ripple)) : 0;
      }
      this.invalidateDock();
    }, () => {
      this.expand = NORMAL_MAX;
      this.waveHalf = WAVE_HALF;
      this.micSquash = 1;
      this.waveBumps = undefined;
      this.invalidateDock();
    }).schedule();
    this.waveTimer = setInterval(() => {
      this.waveform.step();
      this.invalidateDock();
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
    this.beginTurn(question, answer, false);
    this.transcribe();
    return true;
  }

  // A turn starts at the end of the page, where the user's words come in: the page goes
  // there as the bubble opens (`animated`), or at once after dictation, and any Up / Down
  // step stops.
  beginTurn(question, answer, animated) {
    this.question = question;
    this.answer = answer;
    this.query = this.prepared = undefined;
    this.trim();
    this.setOffset(this.maxOffset, animated);
  }

  prepareQuery() {
    this.query ??= this.size({type: "query"}, this.question);
  }

  prepareResult() {
    this.prepTimer = undefined;
    this.prepared ??= this.makeResult(this.answer.widget, this.answer.text);
  }

  // The recording becomes the user's whole message: the blue bubble in the dock (the
  // recording's, or the microphone's when the system's dictation recorded) conforms to the
  // user's bubble and pushes itself up into the page as it, the page going up ahead of its
  // top edge, the divider showing again under it. The top edge leads and the bottom
  // follows, as a Timeline pin's edges do, so the bubble stretches as it rises. Landed, it
  // is the message's entry: its words show, from the bubble's blue to white, and Index
  // thinks.
  transcribe() {
    if (this.waveTimer !== undefined) clearInterval(this.waveTimer);
    this.waveTimer = undefined;
    this.listenAnimation?.unschedule();
    this.listenAnimation = this.waveBumps = undefined;
    const listening = this.phase === "listening";
    openShape(listening ? this.expand : 0);
    const x = shape[0], w = shape[1], radius = shape[2], half = listening ? this.waveHalf : -1;
    this.phase = "transcribing";
    this.prepareQuery();
    // The entry is on the page from the start, hidden while the bubble rising is drawn.
    const query = this.query;
    query.shade = 0;
    query.textColor = VIVID_CERULEAN;
    this.items.push(query);
    this.layout();
    const from = this.offset, to = this.maxOffset;
    const top = query.y - to, bottom = top + query.h;
    const startTop = BUBBLE_Y - BUBBLE_RADIUS, startBottom = startTop + 2 * BUBBLE_RADIUS;
    const lift = this.lift = {x, w, radius, half, top: startTop, bottom: startBottom, drawnTop: startTop};
    new Animation(LIFT_MS, linear, progress => {
      const lead = easeInOut(segmented(progress, 0, 2, STRETCH_POINT));
      const trail = easeInOut(segmented(progress, 1, 2, STRETCH_POINT));
      const both = easeInOut(progress);
      lift.top = startTop + ((top - startTop) * lead / NORMAL_MAX | 0);
      lift.bottom = startBottom + ((bottom - startBottom) * trail / NORMAL_MAX | 0);
      lift.x = x + ((query.x - x) * both / NORMAL_MAX | 0);
      lift.w = w + ((query.w - w) * both / NORMAL_MAX | 0);
      lift.radius = radius + ((PILL_RADIUS - radius) * both / NORMAL_MAX | 0);
      lift.half = half >= 0 && progress < WAVE_OUT ? half * (WAVE_OUT - progress) / WAVE_OUT | 0 : -1;
      this.offsetChanged(from + ((to - from) * lead / NORMAL_MAX | 0));
      this.invalidateDock();
    }, () => {
      // The entry takes the bubble's place, exactly where it landed; the next frame paints
      // it there and over where the bubble was last drawn (floatTop).
      this.landed = lift.drawnTop;
      this.landedTop = lift.top;
      this.lift = this.waveform = undefined;
      query.shade = 255;
      this.invalidateDock();
      let shown = 0;
      new Animation(FADE_MS, linear, progress => {
        const step = progress < NORMAL_MAX / 3 ? 1 : progress < NORMAL_MAX * 2 / 3 ? 2 : 3;
        if (step === shown) return;
        shown = step;
        query.textColor = step === 3 ? WHITE : FADE_BLUES[2 - step];
        this.invalidateArea(query.y, query.y + query.h);
      }).schedule();
      this.startThinking();
    }).schedule();
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
      this.transition.start(WIDGETS[item.widget][1], DOCK_X, CUBE_Y, undefined, false, DOCK_X, CUBE_Y);
    // The question goes in a puff just before the result arrives (only its band
    // repainting); a flying icon lands the result itself, as its flight begins.
    this.timer = setTimeout(() => this.poofQuery(this.items[index], () => {
      if (!flying) this.landResult();
    }), flying ? UNFOLD_MS + HOLD_MS - POOF_MS : 0);
  }

  // The user's words go in a puff (POOF_MS), then `done()`: the entry is hidden at once and
  // its bubble drawn by drawPoof until it has gone. Each bit of the puff is four numbers
  // (page coordinates): where it starts, inside the bubble's rounded corners, and how far
  // it drifts, out from the bubble's middle and up.
  poofQuery(query, done) {
    const {x, y, w, h} = query;
    query.shade = 0;
    const count = Math.max(POOF_MIN, Math.min(POOF_MAX, w * h / POOF_AREA | 0));
    const bits = new Int16Array(count * 4);
    const cx = x + (w >> 1), cy = y + (h >> 1);
    for (let index = 0; index < bits.length; index += 4) {
      const bx = x + 4 + Math.random() * (w - 8) | 0, by = y + 4 + Math.random() * (h - 8) | 0;
      const dx = bx - cx, dy = by - cy, length = Math.sqrt(dx * dx + dy * dy) || 1;
      const reach = POOF_SPREAD * (0.5 + Math.random() * 0.8);
      bits[index] = bx;
      bits[index + 1] = by;
      bits[index + 2] = dx * reach / length + (Math.random() - 0.5) * 8 | 0;
      bits[index + 3] = dy * reach / length / 2 - POOF_RISE * (0.5 + Math.random() / 2) | 0;
    }
    const poof = this.poof = {x, y, w, h, lines: query.lines, bits, time: 0};
    const top = y - POOF_SPREAD - POOF_RISE - 4, bottom = y + h + POOF_SPREAD + 4;
    new Animation(POOF_MS, linear, progress => {
      poof.time = progress * POOF_MS / NORMAL_MAX | 0;
      this.invalidateArea(top, bottom);
    }, () => {
      this.poof = undefined;
      this.invalidateArea(top, bottom);
      done();
    }).schedule();
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
      item.rise = RISE - (RISE * progress / NORMAL_MAX | 0);
      item.shade = progress < NORMAL_MAX / 3 ? 85 : progress < NORMAL_MAX * 2 / 3 ? 170 : 255;
      this.invalidateArea(item.y, item.y + item.h + RISE);
    }).schedule();
    if (!this.transition.active) this.finishTurn();
  }

  // The turn is over: the bubble is back, the microphone unfolding in it out of a dot, as
  // the dictation screen's does.
  finishTurn() {
    this.landing = undefined;
    this.phase = "regrowing";
    if (!this.micUnfold.start(assets.MIC_SMALL, DOCK_X, BUBBLE_Y, undefined, true)) this.idle();
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
      this.offsetChanged(this.clamp(from + ((target - from) * progress / NORMAL_MAX | 0)));
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
  // end. A message is in focus at the bottom of the screen, its icon a GAP above the dock,
  // whichever way the page goes. One too tall to show whole there also stops at its top,
  // a GAP below the time bar: going down that comes first, going up after its icon. A day
  // label goes with the message under it: that message's top stop shows the label above
  // it. Text too long to read between its top and its icon also stops a page of text at a
  // time: each stop brings the first line the last one did not show whole to the top,
  // the line before it hidden under the time bar, until the icon's stop shows the rest.
  // Stops within SNAP_SLACK of `from` are passed over, so a press always moves the page.
  nextStop(from, down) {
    const header = this.headerHeight, items = this.items, lineHeight = this.lineHeight;
    // The screen row a page's first line's capitals go to, and a line's ink from its
    // capitals to its descenders.
    const reading = header - 1 + this.textTop - this.textDescender;
    const ink = lineHeight - this.textTop + this.textDescender;
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
      consider(bottom);
      if (top >= bottom) continue;
      consider(top);
      const lines = item.lines;
      if (!lines) continue;
      const first = item.y + 1 + (item.widget ? CARD_TEXT_GAP : BUBBLE_TEXT_GAP);
      let stop = top;
      for (let line = 0; line < lines.length; line++) {
        const caps = first + line * lineHeight;
        if (caps + ink <= stop + PAGE_BOTTOM) continue;   // shown whole at this stop
        if (caps >= bottom + header) break;               // the icon's stop shows it
        stop = caps - reading;
        consider(stop);
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
      if (top >= header && top + WIDGET_ICON <= PAGE_BOTTOM) {
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
      // A tap on the bar, or on the bubble, asks.
      const {x, y} = this.touchOrigin;
      if (!this.dragging && (y >= BAR_TOP || y >= BUBBLE_Y - BUBBLE_RADIUS &&
                             x >= DOCK_X - BUBBLE_RADIUS && x < DOCK_X + BUBBLE_RADIUS)) {
        this.talk();
      }
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
    this.clockTop = this.headerHeight === 28 ? ((this.headerHeight - 1 - inkHeight) / 2 | 0) - bearing
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
      // A band of the page, the dock, or both in one band down to the bottom. The dock's
      // band starts where what floats on the divider can reach, the page under it painted
      // first.
      let top = this.floatTop(0), bottom = HEIGHT;
      if (dirty === "area") {
        top = Math.max(this.headerHeight, this.dirtyTop - this.offset);
        if (dock) top = Math.min(top, this.floatTop(0));
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
    if (this.lift) this.lift.drawnTop = this.lift.top;
    this.landed = undefined;
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

  // A scrolled frame. The page's rows on the screen (between the time bar and the divider)
  // move by the scroll, natively (scroll.c), and only what that exposed is painted: a strip
  // at the bottom or the top and the position bar's column, the rows under what floats on
  // the divider (moved with the page, so painted again with it on top), and the dock when
  // it changed too. Everything else on the page moved with the rows, except, in an Up /
  // Down step, the icons, which stretch instead. Each is painted again over the rows it
  // covered last frame (moved with the rows) and covers now, in its 40px column, bands
  // that meet merged so every icon is drawn once; the strip leaves them out. False when
  // the rows cannot be moved: before the hook is in, or by a whole page.
  scrollScreen(dy, dock) {
    const header = this.headerHeight, step = dy < 0 ? -dy : dy, stretch = this.stretch;
    if (!hooked || step >= PAGE_BOTTOM - header || (!step && !stretch)) return false;
    // @strip profile
    let mark = now();
    // @endstrip
    if (step && !Natives.shiftRows(header, PAGE_BOTTOM, dy)) return false;
    // @strip profile
    stats.shift += now() - mark;
    mark = now();
    // @endstrip
    render.begin();
    // Poco's clip stack on Pebble restores, when a clip is popped, the rectangle it saved
    // when that clip was pushed, and begin() does not set that rectangle: so the whole
    // screen is pushed first, and each band's pop restores the whole screen.
    render.clip(0, 0, WIDTH, HEIGHT);
    // The dock's band, painted last, can reach above the bottom strip (as the user's bubble
    // rises): then it paints the strip too, not after it.
    const float = this.floatTop(dy);
    const covered = dock && !stretch && float <= PAGE_BOTTOM - step;
    this.iconsHeld = stretch !== undefined;
    if (dy > 0 && !covered) this.drawBand(0, PAGE_BOTTOM - step, WIDTH, PAGE_BOTTOM);
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
        const last = Math.min(PAGE_BOTTOM, Math.max(to, span[1]) + 1);
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
    render.fillRectangle(WHITE, 0, header, BAR_COLUMN, PAGE_BOTTOM - header);
    if (this.barVisible) this.drawScrollBar();
    if (dock) this.drawBand(0, float, WIDTH, HEIGHT);
    else if (step) this.drawBand(FLOAT_LEFT, float, FLOAT_RIGHT, PAGE_BOTTOM);
    // A band at the top of the page reaches one row into the time bar: its rule again.
    render.fillRectangle(WHITE, 0, header - 1, WIDTH, 1);
    render.drawLine(8, header - 1, WIDTH - 8, header - 1, DARK_GRAY, 1);
    render.clip();
    // @strip profile
    stats.rest += now() - mark;
    // @endstrip
    return true;
  }

  // The highest screen row the dock's band repaints from: as high as what floats on the
  // divider reaches (the cube's frames, the user's bubble rising out of the dock), now or
  // as last drawn. What was last drawn on the page's rows moved with them: up by `dy` when
  // the page moves up, so for that the band reaches that much higher.
  floatTop(dy) {
    const moved = dy > 0 ? dy : 0, lift = this.lift;
    let top = FLOAT_TOP - moved;
    if (lift) top = Math.min(top, lift.top, lift.drawnTop - moved);
    if (this.landed !== undefined) top = Math.min(top, this.landedTop, this.landed - moved);
    return Math.max(this.headerHeight, top);
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
    // The page, down to the dock. It is cleared strip by strip, each just before what goes
    // on it, never all at once: the firmware can copy the frame buffer to the display
    // mid-draw (see main.js), and this way it catches at most one item half drawn, not a
    // white screen. An indexed loop: for...of makes an iterator, every frame.
    const page = Math.min(bottom, PAGE_BOTTOM);
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
    if (bottom > FLOAT_TOP) this.drawDock();
    // The user's bubble rising out of the dock into the page.
    if (this.lift) this.drawLift();
    // The user's words going in a puff as the result comes in.
    if (this.poof) this.drawPoof();
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
    } else if (item.type === "query") {
      // The user's words: a solid pill with no tail, so it never reads as Index. As the
      // result comes in it goes in a puff (drawPoof).
      const step = shade >= 255 ? 3 : shade * 3 / 255 | 0;
      if (!step) return;
      render.drawRoundRect(x, y, w, h, FADE_BLUES[step - 1], PILL_RADIUS, GCORNERS_ALL);
      // Its words, as they show (transcribe): from the bubble's blue, unseen, to white.
      const color = item.textColor;
      if (step === 3 && color !== VIVID_CERULEAN) {
        this.drawLines(item.lines, color, x + 8, y + 1 + BUBBLE_TEXT_GAP - this.textTop);
      }
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

  // The dock: while the user speaks, the microphone's bubble opened across the divider, the
  // divider's dots in it the waveform; otherwise the divider, its middle third left out for
  // what sits there, over the page's last rows: the microphone in its bubble, at rest and as
  // it unfolds again after a turn; nothing while the user's bubble rises out of the dock
  // (drawLift); the cube while Index thinks; then (while a result's icon unfolds there and
  // flies off) nothing.
  drawDock() {
    render.fillRectangle(WHITE, 0, DOCK_TOP, WIDTH, DOCK_HEIGHT);
    const phase = this.phase;
    if (phase === "listening") {
      // The bubble opening sideways, over the divider, until it covers it.
      const open = this.expand;
      if (open < NORMAL_MAX) this.drawDivider();
      openShape(open);
      render.drawRoundRect(shape[0], BUBBLE_Y - BUBBLE_RADIUS, shape[1], 2 * BUBBLE_RADIUS, VIVID_CERULEAN,
                           shape[2], GCORNERS_ALL);
      if (this.waveHalf >= 0) this.waveform?.draw(WAVE_LEFT, BAR_TOP, WHITE, this.waveHalf, this.waveBumps);
      // The microphone squashing flat over the bars coming in under it, a little wider.
      const squash = this.micSquash;
      if (squash < 0.9) drawMicScaled(DOCK_X, BUBBLE_Y, 1 + squash / 4, 1 - squash);
      return;
    }
    const bubble = phase === "idle" || phase === "regrowing";
    this.drawDivider();
    if (this.thinking.active) {
      this.thinking.draw(DOCK_X, CUBE_Y);
    } else if (bubble) {
      render.drawCircle(VIVID_CERULEAN, DOCK_X, BUBBLE_Y, BUBBLE_RADIUS);
      if (phase === "regrowing") this.micUnfold.draw();
      else drawMic(DOCK_X, BUBBLE_Y);
    }
  }

  // The user's bubble rising out of the dock (transcribe), over the page and the dock, the
  // waveform drawing back into its middle on its middle row.
  drawLift() {
    const lift = this.lift;
    render.drawRoundRect(lift.x, lift.top, lift.w, lift.bottom - lift.top, VIVID_CERULEAN, lift.radius,
                         GCORNERS_ALL);
    if (lift.half >= 0) this.waveform?.draw(WAVE_LEFT, ((lift.top + lift.bottom) >> 1) - 1, WHITE, lift.half);
  }

  // The user's words going in a puff (poofQuery): the bubble, drawing in a little as its
  // words fade, then falling in on its middle; the bits of its blue, the same blue at
  // first and hidden on it, showing as it falls in, drifting off as they shrink and pale.
  // None show over the time bar or the dock.
  drawPoof() {
    const poof = this.poof, time = poof.time, offset = this.offset, top = poof.y - offset;
    if (time < POOF_WORDS_MS + POOF_COLLAPSE_MS) {
      // The bubble's size, in 256ths: 256 to 248 as the words fade, then down to nothing.
      const fall = (time - POOF_WORDS_MS) / POOF_COLLAPSE_MS;
      const scale = time < POOF_WORDS_MS ? 256 - (8 * time / POOF_WORDS_MS | 0) : 248 * (1 - fall * fall) | 0;
      const w = poof.w * scale >> 8, h = poof.h * scale >> 8;
      if (w > 0 && h > 0) {
        render.drawRoundRect(poof.x + ((poof.w - w) >> 1), top + ((poof.h - h) >> 1), w, h,
                             fall > POOF_PALE ? FADE_BLUES[1] : VIVID_CERULEAN,
                             Math.min(PILL_RADIUS, w >> 1, h >> 1), GCORNERS_ALL);
      }
      if (time < POOF_WORDS_MS) {
        const step = time * 3 / POOF_WORDS_MS | 0;
        this.drawLines(poof.lines, step ? FADE_BLUES[step - 1] : WHITE, poof.x + 8,
                       top + 1 + BUBBLE_TEXT_GAP - this.textTop);
        return;
      }
    }
    const life = (time - POOF_WORDS_MS) / (POOF_MS - POOF_WORDS_MS), drift = 1 - (1 - life) * (1 - life);
    const size = life < 0.5 ? 3 : life < 0.8 ? 2 : 1;
    const color = life < 0.45 ? VIVID_CERULEAN : FADE_BLUES[life < 0.75 ? 1 : 0];
    const header = this.headerHeight, bits = poof.bits;
    for (let index = 0; index < bits.length; index += 4) {
      const bx = bits[index] + (bits[index + 2] * drift | 0);
      const by = bits[index + 1] - offset + (bits[index + 3] * drift | 0);
      if (by >= header && by + size <= PAGE_BOTTOM) render.fillRectangle(color, bx, by, size, size);
    }
  }

  // The divider's dots, DIVIDER_SIDE at each end: its middle third is always left out.
  drawDivider() {
    for (let index = 0; index < DIVIDER_SIDE; index++) {
      render.fillRectangle(DARK_GRAY, DIVIDER_LEFT + index * DIVIDER_PITCH, BAR_TOP, DIVIDER_DOT, DIVIDER_DOT);
      render.fillRectangle(DARK_GRAY, DIVIDER_LEFT + (DIVIDER_DOTS - 1 - index) * DIVIDER_PITCH, BAR_TOP,
                           DIVIDER_DOT, DIVIDER_DOT);
    }
  }

  // The original history view's position bar: a thin dark thumb down the left edge,
  // sized and placed by how much of the page is on screen.
  drawScrollBar() {
    const visible = DOCK_TOP - this.headerHeight;
    const page = this.contentHeight - this.headerHeight;
    if (page <= visible) return;
    const track = visible - 20;
    const height = Math.max(12, track * visible / page | 0);
    const top = this.headerHeight + 10 + (this.offset * (track - height) / this.maxOffset | 0);
    render.drawRoundRect(2, top, 2, height, DARK_GRAY, 1, GCORNERS_ALL);
  }
}
