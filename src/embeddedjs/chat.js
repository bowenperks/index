// Index's one scrolling page, laid out like a messaging app: the history of what Index has
// done, newest at the bottom, under a slim time bar, and at the very end the voice input,
// a microphone in the thinking ring. The page opens on the newest results with the
// microphone beneath them.
//
// Asking pushes things in from the bottom: the recording's waveform in the user's bubble,
// then the whole transcribed message at once. The microphone's ring then slides to the
// bottom left and turns into the thinking cube, with Index's typing bubble ("•••") beside
// it. When the result comes in it takes the words' place, so the history keeps results
// rather than questions.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {setTimeout, clearTimeout, setInterval, clearInterval} from "timers";
import * as assets from "assets";
import {Animation, NORMAL_MAX, easeInOut, easeOut, now} from "motion";
import {render, WIDTH, HEIGHT, CONTENT_SIZE, MEDIUM, EXTRA_LARGE, WHITE, DARK_GRAY, VIVID_CERULEAN,
        ink, font, drawText, textWidth, measure, resetPen} from "theme";
import Thinking, {RING_RADIUS_Q8, drawRing} from "thinking";
import IconTransition, {UNFOLD_MS, HOLD_MS} from "transition";
import {drawWeather, DEMO as WEATHER_DEMO} from "weather";
import {CARDS} from "cards";
import {drawMic, Waveform, RING} from "mic";
import {HISTORY} from "prompts";

const CAPACITY = 10;   // history entries (results and day labels) kept, to bound memory
// Index's replies sit at the left margin with a tail; the user's bubbles are solid pills
// against the right margin; cards take a narrower margin on both sides and have no tail.
const MARGIN = 12, GAP = 8, BUBBLE_INSET = 38, PILL_RADIUS = 12, CARD_MARGIN = 6;
// Widget cards have no header: the card is all information. Its bottom-left corner is cut
// away (the frame stops 40px in from the left and 19px up from the bottom) and the widget's
// 36px icon sits in the cutout, rising 15px above the bottom edge and hanging below it.
// The widget's name is set underneath the card, its caps 3px below the bottom edge,
// centred along the edge from the cutout to the card's right. The caption row takes 21px
// below the card.
const CARD_RADIUS = 7, WIDGET_BODY = 154;
const CUT_WIDTH = 40, CUT_HEIGHT = 19, ICON_ABOVE = 15, CAPTION_GAP = 4, CAPTION_BELOW = 21;
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
// The voice input's slot at the end of the page: the ring's centre sits 36px down, so the
// thinking cube's art (31px above its centre, up to 42 below as it turns) fits inside it.
const SLOT_HEIGHT = 80, SLOT_CENTRE = 36;
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
// Timings, in milliseconds. The ping goes out over 15 steps of 80ms, every 26 steps.
const PING_STEP = 80, PING_STEPS = 15, PING_PERIOD = 26;
const WAVE_STEP = 70, THINK_AFTER = 300, THINK_MIN = 800;
const FADE_MS = 200, REVEAL_MS = 300, RISE = 40, REGROW_MS = 260;

// Each widget: its name (set in capitals under the card), its icon for the cutout and
// the large one the peek unfolds, and its body if not text.
const WIDGETS = {
  weather: ["WEATHER", assets.WEATHER_MEDIUM, assets.WEATHER_LARGE, "weather"],
  beeper: ["BEEPER", assets.BEEPER_MEDIUM, assets.BEEPER_LARGE],
  reminder: ["REMINDER", assets.REMINDER_MEDIUM, assets.REMINDER_LARGE],
  home: ["GOOGLE HOME", assets.HOME_MEDIUM, assets.HOME_LARGE],
  today: ["TODAY", assets.TODAY_MEDIUM, assets.TODAY_LARGE, "today"],
  web: ["WEB ANSWER", assets.WEB_MEDIUM, assets.WEB_LARGE, "", "Source: GDPR, Article 17"],
  map: ["LOCATION", assets.PIN_MEDIUM, assets.PIN_LARGE, "map"],
  translate: ["TRANSLATE", assets.TRANSLATE_MEDIUM, assets.TRANSLATE_LARGE, "translate"],
};

// A fading bubble steps through the 64-colour palette from Index blue to the page.
const FADE_BLUES = [render.makeColor(170, 255, 255), render.makeColor(85, 170, 255), VIVID_CERULEAN];

export default class Chat {
  // `ready(question)` is asked for the result once Index has thought; `talk()` is a tap on
  // the microphone.
  constructor(ready, invalidate, talk) {
    this.ready = ready;
    this.invalidate = invalidate;
    this.talk = talk;
    this.items = [];
    this.phase = "idle";
    this.offset = 0;
    this.notice = "";
    this.pingStep = PING_STEPS;
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
    // Widget names are set in Gothic Bold for the text size (24 at the default), with cap
    // bearings from the PBFs; a name too wide for the space beside the icon drops a size.
    this.captions = [[font("Gothic-Bold", 28), 10, 18], [font("Gothic-Bold", 24), 10, 14],
                     [font("Gothic-Bold", 18), 7, 11]].slice(CONTENT_SIZE < MEDIUM ? 2 : extraLarge ? 0 : 1);
    this.tail = new Poco.PebbleDrawCommandImage(assets.BUBBLE_TAIL).clone();
    this.thinking = new Thinking(invalidate, () => this.thinkingDone());
    this.transition = new IconTransition(invalidate, () => this.landResult(), () => this.finishTurn());
    for (const [day, widget, text] of HISTORY) {
      this.items.push(day ? this.size({type: "day", text: day}) : this.makeResult(widget, text));
    }
    this.refreshTime();
    this.layout();
    this.offset = this.maxOffset;
  }

  // --- the page's entries ------------------------------------------------------------

  makeResult(widget, text) {
    return this.size({type: "result", widget: WIDGETS[widget] ? widget : undefined}, text);
  }

  textHeight(lines) {
    return lines.length * this.font.height - this.textTop + this.textDescender;
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
      const [, , , body, source] = WIDGETS[item.widget];
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
      // The card itself; the entry also holds the caption row hanging below it.
      item.card = h;
      h += CAPTION_BELOW;
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
  // transcribes `question`.
  listen(question, ms) {
    if (this.busy || !this.visible) return false;
    this.beginTurn(question);
    this.phase = "listening";
    this.waveform = new Waveform();
    this.push(this.size({type: "voice"}));
    this.waveTimer = setInterval(() => {
      this.waveform.step();
      this.invalidate();
    }, WAVE_STEP);
    this.timer = setTimeout(() => this.transcribe(), ms);
    return true;
  }

  // A request already transcribed by the system's dictation.
  ask(question) {
    if (this.busy || !question || !question.trim()) return false;
    this.beginTurn(question);
    this.transcribe();
    return true;
  }

  beginTurn(question) {
    this.question = question;
    this.stopPing();
    this.trim();
  }

  // The recording becomes the user's whole message at once, pushed in from the bottom;
  // then Index thinks.
  transcribe() {
    if (this.waveTimer !== undefined) clearInterval(this.waveTimer);
    this.waveTimer = undefined;
    if (this.items[this.items.length - 1].type === "voice") this.items.pop();
    this.waveform = undefined;
    this.phase = "transcribing";
    this.push(this.size({type: "query"}, this.question));
    this.timer = setTimeout(() => this.slide(), THINK_AFTER);
  }

  // Index starts typing: the microphone's ring slides to the bottom left, where it becomes
  // the thinking cube, like a messaging app's avatar beside its typing bubble.
  slide() {
    this.phase = "sliding";
    const from = WIDTH >> 1;
    new Animation(SLIDE_MS, easeInOut, progress => {
      this.ringX = from + Math.trunc((CUBE_X - from) * progress / NORMAL_MAX);
      this.invalidate();
    }, () => this.startThinking()).schedule();
  }

  // The cube turns until the answer is ready (at least one turn), then folds away into a
  // dot, which a widget's icon unfolds out of.
  startThinking() {
    this.phase = "thinking";
    if (!this.thinking.start(RING_RADIUS_Q8)) {
      this.thinkingDone();
      return;
    }
    this.thinking.setCloseRadius(WIDGET_DOT_RADIUS_Q8);
    this.thinkingAt = now();
    this.timer = setTimeout(() => this.thinking.requestStop(), THINK_MIN);
  }

  thinkingDone() {
    this.phase = "answering";
    this.invalidate();
    this.ready(this.question);
  }

  // The result has come in: the question fades and the result takes its place, rising in
  // from the bottom. A widget's icon first unfolds out of the cube's dot, holds, then flies
  // into the card's header as the card arrives.
  result(widget, text) {
    if (this.phase !== "answering") return;
    const index = this.items.findIndex(item => item.type === "query");
    const item = this.makeResult(widget, text);
    this.pending = [index, item];
    const slot = this.slotTop - this.offset;
    const flying = item.widget && slot >= 0 && slot + SLOT_HEIGHT <= HEIGHT &&
      this.transition.start(WIDGETS[item.widget][2], CUBE_X, slot + SLOT_CENTRE);
    // The question fades out just before the result arrives; a flying icon lands the result
    // itself, as its flight begins.
    this.timer = setTimeout(() => {
      const query = this.items[index];
      new Animation(FADE_MS, easeInOut, progress => {
        query.shade = 255 - Math.trunc(progress * 255 / NORMAL_MAX);
        this.invalidate();
      }, () => {
        if (!flying) this.landResult();
      }).schedule();
    }, flying ? UNFOLD_MS + HOLD_MS - FADE_MS : 0);
  }

  landResult() {
    const [index, item] = this.pending;
    this.pending = undefined;
    this.items.splice(index, 1, item);
    item.shade = 0;
    item.rise = RISE;
    this.layout();
    // The page rests at its end, but never with a card's top tucked under the time bar.
    const offset = Math.min(this.maxOffset, item.y - this.headerHeight - 4);
    this.setOffset(offset, true);
    if (this.transition.active) {
      // The icon flies into the card's cutout.
      this.transition.retarget({x: item.x, y: item.y - offset + this.iconTop(item),
                                w: WIDGET_ICON, h: WIDGET_ICON});
      this.landing = item;
    }
    // The result rises into place as it darkens in.
    new Animation(REVEAL_MS, easeOut, progress => {
      item.rise = RISE - Math.trunc(RISE * progress / NORMAL_MAX);
      item.shade = progress < NORMAL_MAX / 3 ? 85 : progress < NORMAL_MAX * 2 / 3 ? 170 : 255;
      this.invalidate();
    }).schedule();
    if (!this.transition.active) this.finishTurn();
  }

  // The turn is over: the microphone's ring grows back, out of a dot, at the centre.
  finishTurn() {
    this.landing = undefined;
    this.phase = "regrowing";
    this.regrowQ8 = WIDGET_DOT_RADIUS_Q8;
    new Animation(REGROW_MS, easeOut, progress => {
      this.regrowQ8 = WIDGET_DOT_RADIUS_Q8 +
        Math.trunc((RING_RADIUS_Q8 - WIDGET_DOT_RADIUS_Q8) * progress / NORMAL_MAX);
      this.invalidate();
    }, () => this.idle()).schedule();
  }

  // Between turns, the turn's art is let go and collected at once: its native memory (the
  // flown icon, the typing bubble's copy) is invisible to XS, which would otherwise hold
  // it until a collection happened for other reasons.
  idle() {
    this.phase = "idle";
    this.typingArt = undefined;
    Debug.gc();
    this.invalidate();
    if (this.visible) this.startPing();
  }

  // --- the microphone's ping --------------------------------------------------------

  startPing() {
    if (this.pingTimer !== undefined) return;
    this.pingStep = 0;
    this.pingTimer = setInterval(() => {
      this.pingStep = (this.pingStep + 1) % PING_PERIOD;
      const slot = this.slotTop - this.offset;
      if (this.pingStep <= PING_STEPS && slot < HEIGHT) this.invalidate();
    }, PING_STEP);
  }

  stopPing() {
    if (this.pingTimer !== undefined) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.pingStep = PING_STEPS;
  }

  // --- scrolling ----------------------------------------------------------------------

  get maxOffset() {
    return Math.max(0, this.contentHeight - HEIGHT);
  }

  clamp(offset) {
    return Math.max(0, Math.min(this.maxOffset, offset));
  }

  setOffset(offset, animated) {
    const target = this.clamp(offset);
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
    this.invalidate();
  }

  // The position bar shows while the reader scrolls and slips away half a second after
  // the page comes to rest. Programmatic scrolls never summon it.
  showBar() {
    if (this.barTimer !== undefined) clearTimeout(this.barTimer);
    this.barTimer = setTimeout(() => {
      this.barTimer = undefined;
      this.barVisible = false;
      this.invalidate();
    }, 500);
    this.barVisible = true;
    this.invalidate();
  }

  // Up / Down step the page as the original history view did: one visible height less
  // 48 pixels of overlap per press, animated, from wherever the reader is. The page holds
  // still while Index is listening, thinking or answering.
  scroll(down) {
    if (!this.visible || this.busy) return;
    const page = HEIGHT - this.headerHeight - 48;
    const target = this.clamp(this.offset + (down ? page : -page));
    this.showBar();
    this.setOffset(target, true);
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

  // A notice in Index's bubble, briefly over the bottom of the page.
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
    if (!this.busy) this.startPing();
    this.invalidate();
  }

  hide() {
    this.visible = false;
    this.touchOrigin = undefined;
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.notice = "";
    this.stopPing();
  }

  // --- drawing --------------------------------------------------------------------------

  draw() {
    render.fillRectangle(WHITE, 0, 0, WIDTH, HEIGHT);
    const offset = this.offset;
    for (const item of this.items) {
      const y = item.y - offset + item.rise;
      if (y + item.h > 0 && y < HEIGHT) this.drawItem(item, y);
    }
    this.drawSlot(this.slotTop - offset);
    // The time bar, and the position bar while the reader scrolls.
    render.fillRectangle(WHITE, 0, 0, WIDTH, this.headerHeight);
    drawText(this.clock, this.clockFont, ink(255), (WIDTH - textWidth(this.clock, this.clockFont)) >> 1, this.clockTop);
    render.drawLine(8, this.headerHeight - 1, WIDTH - 8, this.headerHeight - 1, DARK_GRAY, 1);
    if (this.barVisible) this.drawScrollBar();
    // The widget's icon unfolds over the page, then flies into its card's header.
    if (this.transition.active) this.transition.draw();
    if (this.notice) {
      const h = this.textHeight(this.notice) + 18;
      this.drawBubble(MARGIN, HEIGHT - h - MARGIN, WIDTH - BUBBLE_INSET, h, this.notice, 255);
    }
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
  drawBubble(x, y, w, h, lines, shade) {
    if (!shade) return;
    const border = ink(Math.min(shade, 170));
    render.drawRoundRect(x, y, w, h, WHITE, 7, GCORNERS_ALL);
    resetPen();
    render.frameRoundRect(x, y, w, h, border, 7);
    this.tail.process(command => command.stroke = border);
    render.drawDCI(this.tail, x - 5, y + h - 1 - 9);
    render.drawLine(x + 7, y, x + w - 8, y, ink(shade), 1);
    this.drawLines(lines, ink(shade), x + 8, y + 9 - this.textTop);
  }

  drawLines(lines, color, x, top) {
    for (let index = 0; index < lines.length; index++) {
      drawText(lines[index], this.font, color, x, top + index * this.font.height);
    }
  }

  // Where a card's icon sits, from the entry's top: rising into the cutout above the card's
  // bottom edge and hanging below it.
  iconTop(item) {
    return item.card - 1 - ICON_ABOVE;
  }

  // A card is Index's reply frame without the tail, all information: the reply's text or
  // the widget's own content. Its bottom-left corner is cut away, the frame simply stopping
  // short, and the widget's icon sits there; its name is set underneath, beside the icon
  // and centred on it.
  drawCard(item, y) {
    const {x, w, shade} = item;
    if (!shade) return;
    const [label, icon, , body, source] = WIDGETS[item.widget];
    const h = item.card, edge = y + h - 1, quiet = ink(Math.min(shade, 170));
    render.drawRoundRect(x, y, w, h, WHITE, CARD_RADIUS, GCORNERS_ALL);
    resetPen();
    render.frameRoundRect(x, y, w, h, quiet, CARD_RADIUS);
    render.drawLine(x + 7, y, x + w - 8, y, ink(shade), 1);
    // The cutout: the frame's corner cleared away, nothing drawn around it.
    render.fillRectangle(WHITE, x, edge - CUT_HEIGHT + 1, CUT_WIDTH, CUT_HEIGHT);
    // The icon, once the card is fully revealed and the flying icon has landed.
    const iconTop = y + this.iconTop(item);
    if (shade === 255 && item !== this.landing) render.drawDCI(new Poco.PebbleDrawCommandImage(icon), x, iconTop);
    // The name under the card, centred along the bottom edge from the cutout to the right.
    const room = w - CUT_WIDTH;
    const [face, capTop] = this.captions.find(([f]) => textWidth(label, f) <= room) ?? this.captions.at(-1);
    drawText(label, face, ink(shade), x + CUT_WIDTH + ((room - textWidth(label, face)) >> 1),
             edge + CAPTION_GAP - capTop);
    if (body === "weather") {
      drawWeather(WEATHER_DEMO, {x, y: y + 1, w}, shade);
    } else if (body) {
      CARDS[body].draw({x, y: y + 1, w}, shade);
    } else {
      const top = y + CARD_TEXT_PADDING;
      this.drawLines(item.lines, ink(shade), x + CARD_TEXT_INSET, top - this.textTop);
      if (source) {
        drawText(source, font("Gothic-Regular", 14), quiet, x + CARD_TEXT_INSET,
                 top + this.textHeight(item.lines) + SOURCE_GAP - SOURCE_CAP_TOP);
      }
    }
  }

  // The voice input: the microphone in its ring (pinging while it waits, swelling with the
  // voice while it listens), or, while Index thinks, the cube at the bottom left with its
  // typing bubble.
  drawSlot(top) {
    if (top >= HEIGHT) return;
    const cx = WIDTH >> 1, cy = top + SLOT_CENTRE;
    if (this.thinking.active) {
      this.thinking.draw(CUBE_X, cy);
      this.drawTyping(cy);
    } else if (this.phase === "sliding") {
      drawRing(this.ringX ?? cx, cy, RING_RADIUS_Q8, RING_RADIUS_Q8);
    } else if (this.phase === "regrowing") {
      drawRing(cx, cy, this.regrowQ8, this.regrowQ8);
    } else if (this.phase !== "answering") {
      const level = this.waveform ? this.waveform.level >> 6 : 0;
      drawMic(cx, cy, RING + level, this.pingStep < PING_STEPS ? (this.pingStep << 10) / PING_STEPS | 0 : undefined);
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
    this.typingArt ??= new Poco.PebbleDrawCommandImage(assets.TYPING_BUBBLE).clone();
    let first = true;
    this.typingArt.process(command => {
      if (first) command.fill = ink(shade);
      first = false;
    });
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
