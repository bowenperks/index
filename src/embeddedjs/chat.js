// Index's one scrolling page: the home screen is its top section and the conversation
// stacks below it. A slim time bar takes over once the big clock has scrolled away, and
// thinking (and a widget icon's entrance) get a screen of their own.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {setTimeout, clearTimeout} from "timers";
import * as assets from "assets";
import {Animation, NORMAL_MAX, easeInOut, easeOut} from "motion";
import {render, WIDTH, HEIGHT, CONTENT_SIZE, SMALL, MEDIUM, EXTRA_LARGE, WHITE, DARK_GRAY,
        VIVID_CERULEAN, ink, font, drawText, textWidth, measure, drawWrapped, resetPen} from "theme";
import Thinking, {RING_RADIUS_Q8} from "thinking";
import IconTransition from "transition";
import {drawWeather, DEMO as WEATHER_DEMO} from "weather";

const CAPACITY = 12;
// Conversation bubbles stack straight down the page below the home section: each question
// is a solid pill hugging its text against the right margin, its reply a tailed bubble
// left-aligned under it, separated by one small fixed gap.
const MARGIN = 12, GAP = 8, BUBBLE_INSET = 38, PILL_RADIUS = 12, CARD_MARGIN = 6;
// Widget cards: a blue header band (the icon in a 41px square at its left, the label
// centred across the card) closed off by a divider above the body.
const CARD_RADIUS = 7, CARD_SQUARE = 41, CARD_HEADER = CARD_SQUARE + 1, WIDGET_BODY = 154;
const WIDGET_ICON = 25, WIDGET_DOT_RADIUS_Q8 = 4 * 256;   // the notification peek's 9px dot
// A text card's reply is set like a notification's body: the conversation font,
// left-aligned at the card's 10px inset, with a text bubble's 9px above and below.
const CARD_TEXT_INSET = 10, CARD_TEXT_PADDING = 9;
const GCORNERS_TOP = 3, GCORNERS_ALL = 15;
const SCROLL_MS = 250;   // a ScrollLayer's animated offset
const TOUCH_DECIDE = 6, CAROUSEL_TOUCH_SLOP = 6;

const WIDGETS = {
  weather: {label: "Weather", large: assets.WEATHER_LARGE},
  alarm: {label: "Alarm", icon: assets.ALARM_ICON, large: assets.ALARM_LARGE},
  beeper: {label: "Beeper", icon: assets.BEEPER_ICON, large: assets.BEEPER_LARGE},
  timer: {label: "Timer", icon: assets.TIMER_ICON, large: assets.TIMER_LARGE},
  reminder: {label: "Reminder", icon: assets.REMINDER_ICON, large: assets.REMINDER_LARGE},
  note: {label: "Note", icon: assets.NOTE_ICON, large: assets.NOTE_LARGE},
  tool: {label: "Tool", icon: assets.TOOL_ICON, large: assets.TOOL_LARGE},
};

function chatLayout(contentWidth, top, questionHeight, questionWidth, answerHeight, answerWidth) {
  const width = contentWidth - BUBBLE_INSET;
  if (!questionWidth || questionWidth > width) questionWidth = width;
  const layout = {
    question: {x: contentWidth - MARGIN - questionWidth, y: top, w: questionWidth, h: questionHeight},
    bottom: top + questionHeight,
  };
  layout.answer = {x: MARGIN, y: layout.bottom + GAP, w: answerWidth || width, h: answerHeight};
  if (answerHeight) layout.bottom = layout.answer.y + answerHeight;
  return layout;
}

export default class Chat {
  constructor(home, ready, invalidate) {
    this.home = home;
    this.ready = ready;
    this.invalidate = invalidate;
    this.turns = [];
    this.layouts = [];
    this.nextId = 0;
    this.activeId = 0;
    this.offset = 0;
    this.followLatest = true;
    this.visible = false;
    this.homeInView = false;
    this.notice = "";
    this.revealProgress = 1024;
    this.revealDistance = 8;
    this.contentWidth = WIDTH;
    this.homeHeight = HEIGHT;
    this.clockBottom = home.clockBottom;
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
    // Widget headers use Bobby's widget-title face, with cap bearings from the PBFs.
    if (CONTENT_SIZE < MEDIUM) {
      this.headerFont = font("Gothic-Bold", 18);
      this.headerCapTop = 7;
      this.headerCap = 11;
    } else if (CONTENT_SIZE === MEDIUM) {
      this.headerFont = font("Gothic-Bold", 24);
      this.headerCapTop = 10;
      this.headerCap = 14;
    } else {
      this.headerFont = font("Gothic-Bold", 28);
      this.headerCapTop = 10;
      this.headerCap = 18;
    }
    this.tail = new Poco.PebbleDrawCommandImage(assets.BUBBLE_TAIL).clone();
    this.thinking = new Thinking(invalidate, () => this.markReady());
    this.transition = new IconTransition(invalidate, () => this.revealAnswer(56, 300),
                                         () => this.invalidate());
    this.refreshTime();
    this.layout();
  }

  // --- the conversation ------------------------------------------------------------

  find(id) {
    return this.turns.find(turn => turn.id === id);
  }

  get conversationBusy() {
    return this.turns.length > 0 && this.turns[this.turns.length - 1].state !== "answered";
  }

  get busy() {
    return this.conversationBusy || this.transition.active;
  }

  get hasHistory() {
    return this.turns.length > 0;
  }

  // Starts a turn for a question; Index replies once thinking has run.
  begin(question) {
    if (this.busy || !question || !question.trim()) return 0;
    if (this.turns.length === CAPACITY) this.turns.shift();
    // Reclaim the previous turn's temporary objects before growing the conversation.
    Debug.gc();
    do {
      this.nextId = (this.nextId + 1) >>> 0 || 1;
    } while (this.find(this.nextId));
    this.turns.push({id: this.nextId, state: "thinking", question, answer: "", widget: undefined});
    this.activeId = this.nextId;
    this.followLatest = true;
    this.layout();
    this.focusLatest(true);
    this.show();
    return this.activeId;
  }

  // The reply to this turn will be this widget (known from the request, as a real result
  // would be while thinking): the cube then closes into the widget's dot.
  expectWidget(id, widget) {
    this.expectedWidget = widget;
    this.expectedId = id;
  }

  answer(id, text) {
    const turn = this.find(id);
    if (!turn || !text) return;
    Object.assign(turn, {answer: text, widget: undefined, state: "answered", answerHeight: undefined});
    if (id === this.activeId) {
      this.cancelTimer();
      this.thinking.cancel();
    }
    this.layout();
    if (id === this.activeId) {
      this.focusLatest(this.visible);
      this.revealAnswer(8, 240);
    }
  }

  // Answers a turn with a widget card; the text is its fallback.
  widget(id, widget, text) {
    const turn = this.find(id);
    if (!turn || !text || !WIDGETS[widget]) return false;
    Object.assign(turn, {answer: text, widget, state: "answered", answerHeight: undefined});
    const expected = this.expectedWidget && this.expectedId === id ? this.expectedWidget : undefined;
    this.expectedWidget = undefined;
    if (id === this.activeId) {
      this.cancelTimer();
      this.thinking.cancel();
    }
    this.layout();
    if (id !== this.activeId) return true;
    if (expected === widget && this.startWidgetTransition(turn)) return true;
    this.focusReply(this.visible);
    this.revealAnswer(8, 240);
    return true;
  }

  // --- layout ----------------------------------------------------------------------

  textBubbleHeight(text, width) {
    if (!text) return 0;
    return measure(text, this.font, width - 16).h - this.textTop + this.textDescender + 18;
  }

  bubbleHeight(text) {
    return this.textBubbleHeight(text, this.contentWidth - BUBBLE_INSET);
  }

  // A question pill hugs its widest line: eight pixels of padding each side plus two of
  // slack so the drawn text never re-wraps.
  questionWidth(text) {
    return measure(text, this.font, this.contentWidth - BUBBLE_INSET - 16).w + 18;
  }

  cardBodyHeight(text, cardWidth) {
    return measure(text, this.font, cardWidth - 2 * CARD_TEXT_INSET).h - this.textTop +
           this.textDescender + 2 * CARD_TEXT_PADDING;
  }

  layout() {
    // Drop the old geometry before building its replacement: keeping both full layouts
    // alive can grow XS's slot heap, which leaves less native memory for animation art.
    this.layouts.length = 0;
    Debug.gc();
    // The first bubble clears the slim time bar that overlays the top of the conversation.
    let top = this.homeHeight + this.headerHeight + GAP;
    this.layouts = this.turns.map(turn => {
      // Font and content width stay fixed for this page. Retain just the dimensions,
      // so adding a reply never remeasures the entire conversation's text.
      if (turn.questionHeight === undefined) {
        turn.questionHeight = this.bubbleHeight(turn.question);
        turn.questionWidth = this.questionWidth(turn.question);
      }
      const answerWidth = turn.widget ? this.contentWidth - 2 * CARD_MARGIN : 0;
      if (turn.answerHeight === undefined) {
        // Every card has the same width and header; the text cards keep a text bubble's
        // body instead of the weather card's full one.
        turn.answerHeight = turn.widget
          ? CARD_HEADER + (turn.widget === "weather" ? WIDGET_BODY
            : this.cardBodyHeight(turn.answer, answerWidth))
          : this.bubbleHeight(turn.answer);
      }
      const layout = chatLayout(this.contentWidth, top, turn.questionHeight,
                                turn.questionWidth, turn.answerHeight, answerWidth);
      // Cards have no tail, so they take the wider card margin on both sides.
      if (turn.widget) layout.answer.x = CARD_MARGIN;
      top = layout.bottom + GAP;
      return layout;
    });
    // A conversation is at least one screen tall so the home section can scroll fully
    // away. A shorter one sits at the bottom of that screen, like a messaging app.
    let conversation = top - GAP + MARGIN - this.homeHeight;
    if (conversation < HEIGHT) {
      const shift = HEIGHT - conversation;
      for (const layout of this.layouts) {
        layout.question.y += shift;
        layout.answer.y += shift;
        layout.bottom += shift;
      }
      conversation = HEIGHT;
      // A lone exchange: the question floats centred between the time bar and its reply.
      const only = this.layouts[0];
      if (this.layouts.length === 1 && only.answer.h) {
        const spaceTop = this.homeHeight + this.headerHeight;
        only.question.y = spaceTop + Math.trunc((only.answer.y - spaceTop - only.question.h) / 2);
      }
    }
    this.contentHeight = this.turns.length ? this.homeHeight + conversation : this.homeHeight;
    this.invalidate();
  }

  // --- scrolling -------------------------------------------------------------------

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
    if (!animated) {
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
    this.updateHomeMotion();
    if (this.barVisible) this.showBar();
    this.invalidate();
  }

  focusLatest(animated) {
    if (!this.turns.length || !this.followLatest) return;
    this.setOffset(this.maxOffset, animated);
  }

  // Where the page rests for the latest reply: its end, but never with a widget's top
  // (its header) tucked under the time bar.
  replyOffset() {
    const offset = this.maxOffset;
    const last = this.turns.length - 1;
    if (last < 0 || !this.turns[last].widget) return offset;
    return Math.min(offset, this.layouts[last].answer.y - this.headerHeight - 4);
  }

  focusReply(animated) {
    if (!this.turns.length || !this.followLatest) return;
    this.setOffset(this.replyOffset(), animated);
  }

  updateHomeMotion() {
    const inView = this.visible && this.offset < this.homeHeight;
    if (inView === this.homeInView) return;
    this.homeInView = inView;
    if (inView) this.home.show();
    else this.home.hide();
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
  // 48 pixels of overlap per press, animated, from wherever the reader is.
  scroll(down) {
    if (!this.visible || this.noticeScreenActive) return;
    const page = HEIGHT - this.headerHeight - 48;
    const offset = this.offset;
    let target = offset + (down ? page : -page);
    // The main screen is never left half exposed. Up stops at the top of the conversation
    // first; the next Up goes all the way to the main screen. Down from the main screen
    // lands on the first message.
    if (down) {
      if (target > 0 && target < this.homeHeight) target = this.homeHeight;
    } else if (offset > this.homeHeight && target < this.homeHeight) {
      target = this.homeHeight;
    } else if (target < this.homeHeight) {
      target = 0;
    }
    const clamped = this.clamp(target);
    this.followLatest = clamped >= this.maxOffset - 4;
    this.showBar();
    this.setOffset(clamped, true);
  }

  // --- touch -------------------------------------------------------------------------

  // A Touch sensor sample: [{x, y}] while the finger is down, [] when it lifts.
  touch(points) {
    if (!this.visible || !points) return;
    const point = points[0];
    if (point && !this.fingerDown) {
      this.fingerDown = true;
      this.lastTouch = point;
      this.touchDown(point);
    } else if (point) {
      this.lastTouch = point;
      if (this.touching) this.touchMove(point, false);
    } else if (this.fingerDown) {
      this.fingerDown = false;
      if (this.touching) this.touchMove(this.lastTouch, true);
    }
  }

  touchDown(point) {
    if (this.noticeScreenActive) return;
    if (this.timeBarVisible && point.y < this.headerHeight) return;
    this.touching = true;
    this.touchOrigin = point;
    this.touchOffset = this.offset;
    this.touchAxis = undefined;
    // The icon row, on screen, with a little slop above and below it.
    const strip = this.home.carouselFrame;
    const top = strip.y - this.touchOffset - CAROUSEL_TOUCH_SLOP;
    this.touchOnCarousel = point.x >= strip.x && point.x < strip.x + strip.w &&
      point.y >= top && point.y < top + strip.h + 2 * CAROUSEL_TOUCH_SLOP;
    this.setOffset(this.touchOffset, false);
    if (!this.touchOnCarousel) this.showBar();
  }

  // A drag is decided by its first few pixels: sideways from the icon row drags the ring;
  // anything else scrolls the page.
  touchMove(point, liftoff) {
    const delta = point.y - this.touchOrigin.y;
    const dx = point.x - this.touchOrigin.x;
    if (this.touchAxis === undefined) {
      if (this.touchOnCarousel && Math.abs(dx) > TOUCH_DECIDE && Math.abs(dx) > Math.abs(delta)) {
        this.touchAxis = "sideways";
        this.home.carousel.dragBegin();
      } else if (Math.abs(delta) > (this.touchOnCarousel ? TOUCH_DECIDE : 3)) {
        this.touchAxis = "vertical";
        if (this.touchOnCarousel) this.showBar();
      }
    }
    if (this.touchAxis === "sideways") {
      this.home.carousel.dragTo(dx);
      if (liftoff) {
        this.touching = false;
        this.home.carousel.dragEnd();
      }
      return;
    }
    if (this.touchAxis === "vertical") {
      this.setOffset(this.touchOffset - delta, false);
      this.followLatest = this.offset >= this.maxOffset - 4;
    }
    if (liftoff) {
      this.touching = false;
      if (this.offset > 0 && this.offset < this.homeHeight) {
        // A drag that ends inside the main screen completes it: upward goes all the way
        // to the top, downward to the first message.
        const target = delta > 0 ? 0 : this.homeHeight;
        this.followLatest = target >= this.maxOffset - 4;
        this.setOffset(target, true);
      }
    }
  }

  // --- thinking and replies ---------------------------------------------------------

  cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  startThinking() {
    this.timer = undefined;
    if (!this.visible) return;
    if (!this.thinking.start(RING_RADIUS_Q8)) {
      this.markReady();
      return;
    }
    // A reply known to be a widget closes the cube into the peek's dot for its icon.
    if (this.expectedWidget && this.expectedId === this.activeId) {
      this.thinking.setCloseRadius(WIDGET_DOT_RADIUS_Q8);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.thinking.requestStop();
    }, 800);
  }

  markReady() {
    if (!this.visible) return;
    this.cancelTimer();
    this.invalidate();
    const turn = this.find(this.activeId);
    if (!turn || turn.state !== "thinking") return;
    turn.state = "waiting";
    this.ready(turn.id, turn.question);
  }

  // A reply rises `distance` pixels into place as it darkens in.
  revealAnswer(distance, duration) {
    this.cancelReveal();
    if (!this.visible) return;
    this.revealProgress = 0;
    this.revealDistance = distance;
    this.reveal = new Animation(duration, easeOut, progress => {
      this.revealProgress = Math.trunc(progress * 1024 / NORMAL_MAX);
      this.invalidate();
    }, () => {
      this.reveal = undefined;
      this.revealProgress = 1024;
      this.invalidate();
    }).schedule();
  }

  cancelReveal() {
    this.reveal?.unschedule();
    this.reveal = undefined;
    this.revealProgress = 1024;
  }

  // Like a notification's peek: the widget's icon unfolds where the cube closed, holds,
  // then squashes and stretches into the card's header square as the card slides up.
  startWidgetTransition(turn) {
    if (!this.visible) return false;
    // The page settles where the card will rest first; the transition covers it until then.
    const offset = this.replyOffset();
    this.setOffset(offset, false);
    const card = this.layouts[this.layouts.length - 1].answer;
    const inset = (CARD_SQUARE - WIDGET_ICON) >> 1;
    return this.transition.start(WIDGETS[turn.widget].large, this.contentWidth >> 1, (HEIGHT >> 1) - 4,
      {x: card.x + inset, y: card.y + inset - offset, w: WIDGET_ICON, h: WIDGET_ICON});
  }

  // A notice in Index's bubble: on the home screen's greeting before any conversation,
  // otherwise briefly over the page.
  showNotice(message) {
    if (!this.hasHistory) {
      this.home.setMessage(message);
      return;
    }
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.notice = message;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = undefined;
      this.notice = "";
      this.invalidate();
    }, 3500);
    this.invalidate();
  }

  refreshTime() {
    const now = new Date();
    if (watch.hour12) {
      const hour = now.getHours() % 12 || 12;
      this.clock = hour + ":" + String(now.getMinutes()).padStart(2, "0") + " " +
                   (now.getHours() < 12 ? "AM" : "PM");
    } else {
      this.clock = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    }
    const bearing = this.headerHeight === 28 ? 10 : 7;
    const descender = this.headerHeight === 28 ? 4 : 3;
    const inkHeight = this.clockFont.height - bearing + descender;
    this.clockTop = Math.trunc((this.headerHeight - 1 - inkHeight) / 2) - bearing;
    this.invalidate();
  }

  // The page shows while Index's window is up; dictation's system window hides it.
  show() {
    this.refreshTime();
    this.visible = true;
    this.updateHomeMotion();
    const turn = this.find(this.activeId);
    if (turn && turn.state === "thinking" && this.timer === undefined && !this.thinking.active) {
      this.timer = setTimeout(() => this.startThinking(), 180);
    }
    this.invalidate();
  }

  hide() {
    this.visible = this.touching = this.fingerDown = false;
    if (this.noticeTimer !== undefined) clearTimeout(this.noticeTimer);
    this.noticeTimer = undefined;
    this.notice = "";
    this.cancelTimer();
    this.cancelReveal();
    if (this.barTimer !== undefined) clearTimeout(this.barTimer);
    this.barTimer = undefined;
    this.barVisible = false;
    this.thinking.cancel();
    this.transition.cancel();
    this.updateHomeMotion();
  }

  // --- drawing -----------------------------------------------------------------------

  get noticeScreenActive() {
    return this.thinking.active || (this.transition.active && !this.transition.isFlying);
  }

  get timeBarVisible() {
    return this.offset > this.clockBottom;
  }

  draw() {
    if (this.noticeScreenActive) {
      this.drawNoticeScreen();
      return;
    }
    render.fillRectangle(WHITE, 0, 0, WIDTH, HEIGHT);
    const offset = this.offset;
    if (offset < this.homeHeight) this.home.draw(-offset);
    this.turns.forEach((turn, index) => {
      const position = this.layouts[index];
      if (position.bottom + 4 < offset || position.question.y > offset + HEIGHT) return;
      const question = position.question;
      this.drawBubble({...question, y: question.y - offset}, turn.question, true, 255);
      if (!position.answer.h) return;
      const answer = {...position.answer, y: position.answer.y - offset};
      let shade = 255;
      if (turn.id === this.activeId && this.reveal) {
        answer.y += Math.trunc(this.revealDistance * (1024 - this.revealProgress) / 1024);
        shade = this.revealProgress < 340 ? 85 : this.revealProgress < 680 ? 170 : 255;
      }
      if (turn.widget) {
        // While the transition's icon is travelling, the header square waits for it.
        const landing = turn.id === this.activeId && this.transition.active;
        this.drawCard(answer, turn, shade, !landing);
      } else {
        this.drawBubble(answer, turn.answer, false, shade);
      }
    });
    if (this.timeBarVisible) {
      this.drawTimeBar();
      if (this.barVisible) this.drawScrollBar();
    }
    // The icon flies over the page as the reply slides up beneath it.
    if (this.transition.isFlying) this.transition.draw();
    if (this.notice) {
      const height = this.bubbleHeight(this.notice);
      this.drawBubble({x: MARGIN, y: HEIGHT - height - MARGIN, w: this.contentWidth - BUBBLE_INSET, h: height},
                      this.notice, false, 255);
    }
  }

  drawBubble(rect, text, user, shade) {
    if (!text || !shade) return;
    if (user) {
      // The user's questions are solid pills with no tail, so they never read as Index.
      render.drawRoundRect(rect.x, rect.y, rect.w, rect.h, VIVID_CERULEAN, PILL_RADIUS, GCORNERS_ALL);
    } else {
      // Index's replies keep the thin grey outline of the home greeting, with its tail.
      const border = ink(Math.min(shade, 170));
      render.drawRoundRect(rect.x, rect.y, rect.w, rect.h, WHITE, 7, GCORNERS_ALL);
      resetPen();
      render.frameRoundRect(rect.x, rect.y, rect.w, rect.h, border, 7);
      this.tail.process(command => command.stroke = border);
      render.drawDCI(this.tail, rect.x - 5, rect.y + rect.h - 1 - 9);
      render.drawLine(rect.x + 7, rect.y, rect.x + rect.w - 8, rect.y, ink(shade), 1);
    }
    drawWrapped(text, this.font, user ? WHITE : ink(shade), rect.x + 8, rect.y + 9 - this.textTop,
                rect.w - 16);
  }

  // A card is Index's reply frame without the tail, its header band and the divider
  // closing it off; the weather card's body is the report, the others' the reply text.
  drawCard(rect, turn, shade, showIcon) {
    const widget = WIDGETS[turn.widget];
    render.drawRoundRect(rect.x, rect.y, rect.w, rect.h, WHITE, CARD_RADIUS, GCORNERS_ALL);
    resetPen();
    render.frameRoundRect(rect.x, rect.y, rect.w, rect.h, ink(Math.min(shade, 170)), CARD_RADIUS);
    render.drawLine(rect.x + 7, rect.y, rect.x + rect.w - 8, rect.y, ink(shade), 1);
    if (shade === 255) {
      render.drawRoundRect(rect.x, rect.y, rect.w, CARD_SQUARE, VIVID_CERULEAN, CARD_RADIUS, GCORNERS_TOP);
      if (showIcon) {
        const x = rect.x + ((CARD_SQUARE - WIDGET_ICON) >> 1), y = rect.y + ((CARD_SQUARE - WIDGET_ICON) >> 1);
        if (turn.widget === "weather") {
          render.drawBitmap(new Poco.PebbleBitmap(assets.WEATHER_ICON_TINY), x, y);
        } else {
          render.drawDCI(new Poco.PebbleDrawCommandImage(widget.icon), x, y);
        }
      }
    }
    // Until fully revealed the label stays ink-grey; then it is white on the band.
    const label = widget.label;
    drawText(label, this.headerFont, shade === 255 ? WHITE : ink(shade),
             rect.x + Math.trunc((rect.w - textWidth(label, this.headerFont)) / 2),
             rect.y + Math.trunc((CARD_SQUARE - this.headerCap) / 2) - this.headerCapTop);
    const divider = rect.y + CARD_HEADER - 1;
    render.drawLine(rect.x, divider, rect.x + rect.w - 1, divider, ink(Math.min(shade, 170)), 1);
    if (turn.widget === "weather") {
      drawWeather(WEATHER_DEMO, {x: rect.x, y: divider + 1, w: rect.w}, shade);
    } else {
      drawWrapped(turn.answer, this.font, ink(shade), rect.x + CARD_TEXT_INSET,
                  divider + 1 + CARD_TEXT_PADDING - this.textTop, rect.w - 2 * CARD_TEXT_INSET);
    }
  }

  drawTimeBar() {
    render.fillRectangle(WHITE, 0, 0, this.contentWidth, this.headerHeight);
    drawText(this.clock, this.clockFont, ink(255),
             Math.trunc((this.contentWidth - textWidth(this.clock, this.clockFont)) / 2), this.clockTop);
    render.drawLine(8, this.headerHeight - 1, this.contentWidth - 8, this.headerHeight - 1, DARK_GRAY, 1);
  }

  // The original history view's position bar: a thin dark thumb down the left edge,
  // sized and placed by how much of the conversation is on screen.
  drawScrollBar() {
    const visible = HEIGHT - this.headerHeight;
    const conversation = this.contentHeight - this.homeHeight;
    if (conversation <= visible) return;
    const track = visible - 20;
    const height = Math.max(12, Math.trunc(track * visible / conversation));
    const offset = Math.max(0, this.offset - this.homeHeight);
    const top = this.headerHeight + 10 + Math.trunc(offset * (track - height) / (conversation - visible));
    render.drawRoundRect(2, top, 2, height, DARK_GRAY, 1, GCORNERS_ALL);
  }

  // Thinking gets a screen of its own: the time bar, Index's bubble at the bottom saying
  // what is happening, and the animation at the screen's centre (the cube's art sits 4px
  // below its canvas centre). A widget's icon unfolding out of the closed cube has the
  // screen to itself.
  drawNoticeScreen() {
    render.fillRectangle(WHITE, 0, 0, WIDTH, HEIGHT);
    this.drawTimeBar();
    if (this.transition.active) {
      this.transition.draw();
      return;
    }
    const text = "Thinking...";
    const height = this.bubbleHeight(text);
    this.drawBubble({x: MARGIN, y: HEIGHT - height - MARGIN, w: this.contentWidth - BUBBLE_INSET, h: height},
                    text, false, 255);
    this.thinking.draw(this.contentWidth >> 1, (HEIGHT >> 1) - 4);
  }
}
