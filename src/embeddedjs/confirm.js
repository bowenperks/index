// The answers to a question Index asks before an action that cannot be taken back, such as
// unlocking a door or sending someone a message, for when they cannot be tapped: Chat asks
// in the conversation, with the answers as pills under the question, and Select opens this.
//
// It is PebbleOS's action menu opened over a notification. A black window comes in from the
// right with the firmware's own window push and pushes the page out of the frame to the
// left, leaving the page's right edge in a strip. At the top of the window is the widget's
// icon, drawn white; below it the question, which says exactly what will happen and to what
// ("Unlock the front door?"); and at the bottom the answers, YES above NO, listed as the
// action menu lists its items. Up and Down move between them and Select takes the one in
// white, which shows as a menu cell's highlight before the window goes back the way it came.
// Back closes it without an answer, as it closes the action menu. There is no timeout.
//
// To use it from another page: construct it with `invalidate()` (repaint) and `done(yes)`
// (true, false, or undefined when closed without an answer),
// call start() when the question is ready, and while it is `active` hand it the page's frames
// (render) and touches (touch). While it asks it adds a Button for Select, Up, Down and Back;
// Alloy calls every Button bound to a key, so the page's own Select, Up and Down must do
// nothing meanwhile (Index's do nothing while Chat is busy). The page provides its text font
// (`font`, `lineHeight`, and `textTop`, the rows from a line's top down to its capitals) and
// `draw(top, bottom)`, which paints the page as it rests. The page's leftmost column should
// be white: the gap left of the page is filled white while the window overshoots on its way
// out. The frame is moved by scroll.c's shiftColumns and the icon drawn by its iconDraw,
// which work once the page has called hookRender after its first frame.
import Button from "pebble/button";
import {Animation, linear, moook} from "motion";
import {setTimeout} from "timers";
import {render, WIDTH, HEIGHT, CONTENT_SIZE, EXTRA_LARGE, WHITE, BLACK, DARK_GRAY, font, drawText, textWidth,
        wrap} from "theme";

// The strip of the page left showing, as wide as the action menu's crumbs column at the
// Large size (crumbs_layer.c), and the window's width inside its 2px left edge.
const STRIP = 16, EDGE = 2, PANE = WIDTH - STRIP - EDGE;
// The firmware's window push and pop (window_stack_animation_rect.c): the moook curve with no
// middle frames, 7 frames of 33 ms. A 1px nudge, 20px, then almost the whole way in a single
// frame, 4px past and back. The taken answer shows for PRESSED_MS before the window goes.
const PUSH_MS = 231, PUSH_MID = 0, PRESSED_MS = 120;
// The icon's bar is as tall as a notification's banner with its status bar on Emery; the
// icon is the 25px size a banner shows (TimelineResourceSizeTiny).
const BAR = 49, ICON = 25, ICON_TOP = (BAR - ICON) >> 1;
// The answers' rows, ROW tall with PAD above and below, at the bottom of the window. Their
// words and the question's are INSET from the window's edge, the action menu's cell inset
// at the Large size (menu_layer_system_cells.c).
const ROW = 36, PAD = 8, INSET = 10;
const ANSWERS = 2 * ROW + 2 * PAD, ANSWERS_TOP = HEIGHT - ANSWERS;
// The question keeps GAP clear of the bar and the answers. Too long for the page's font, it
// steps down Gothic's sizes ([size, rows from a line's top to its capitals]) until it fits,
// and in the last, Gothic 18, it is ellipsised.
const GAP = 6, SMALLER = [[28, 10], [24, 10], [18, 7]];
// The answers' font, the action menu's at the watch's text size (Gothic 24 Bold, or Gothic
// 28 at Extra Large), and where its capitals start in the line and how tall they are.
const EXTRA = CONTENT_SIZE === EXTRA_LARGE;
const ITEM_CAP_TOP = 10, ITEM_CAP = EXTRA ? 18 : 14;
// The firmware draws no letter that starts left of the clip, so a page painted under a narrow
// clip starts GLYPH_SLACK further left (Gothic 36's widest letter) and loses none.
const GLYPH_SLACK = 32;
const NO = 0, YES = 1;
const LABELS = ["NO", "YES"];
// A touch that cannot answer: one begun before the window landed, or on the page beside it.
const IGNORED = {x: -1, y: -1};

export default class Confirm {
  constructor(invalidate, done) {
    this.invalidate = invalidate;
    this.done = done;
    this.active = false;
  }

  // Asks `question` over `page`, with `icon` above it: a 25px black-and-white PDC resource
  // id (drawn inverted), or none. The text is laid out once here.
  start(question, icon, page) {
    if (this.active) return false;
    const room = ANSWERS_TOP - BAR - 2 * GAP, width = PANE - 2 * INSET;
    let f = page.font, lineHeight = page.lineHeight, textTop = page.textTop;
    let lines = wrap(question, f, width);
    for (let index = 0; index < SMALLER.length && lines.length * lineHeight - textTop > room; index++) {
      const size = SMALLER[index][0], last = index === SMALLER.length - 1;
      if (size >= page.lineHeight && !last) continue;
      f = font("Gothic-Regular", size);
      lineHeight = f.height;
      textTop = SMALLER[index][1];
      lines = last ? wrap(question, f, width, (room + textTop) / lineHeight | 0) : wrap(question, f, width);
    }
    this.page = page;
    this.icon = icon;
    this.font = f;
    this.lineHeight = lineHeight;
    this.lines = lines;
    this.widths = lines.map(line => textWidth(line, f));
    // Centred on its ink: as many rows above the first line's capitals as below the last
    // line's baseline.
    this.questionTop = BAR + ((ANSWERS_TOP - BAR - (lines.length * lineHeight - textTop)) >> 1) - textTop;
    this.itemFont = EXTRA ? font("Gothic-Regular", 28) : font("Gothic-Bold", 24);
    this.labelWidths = [textWidth(LABELS[NO], this.itemFont), textWidth(LABELS[YES], this.itemFont)];
    // The question's lines and the answers all start INSET in; how far the widest reaches.
    this.reach = Math.max(...this.widths, ...this.labelWidths);
    this.choice = YES;
    this.answered = this.drawn = this.touchOrigin = undefined;
    this.changed = this.closing = false;
    this.active = this.moving = true;
    this.x = WIDTH;
    this.animation = new Animation(PUSH_MS, linear, progress => {
      this.moveTo(moook(progress, WIDTH, STRIP, PUSH_MID));
    }, () => {
      this.animation = undefined;
      this.moving = false;
    }).schedule();
    // Until it is closed, once the window has gone, Back is NO rather than leaving the app.
    // Alloy calls every Button bound to a key, so Select, Up and Down reach the page's own
    // Buttons as well, which ignore them meanwhile.
    this.buttons = new Button({
      types: ["select", "up", "down", "back"],
      single: true,
      onPush: (down, type) => {
        if (!down) return;
        if (type === "back") this.finish(undefined);
        else if (type === "select") this.press();
        else this.pick(type === "up" ? YES : NO);
      },
    });
    return true;
  }

  moveTo(x) {
    if (x === this.x) return;
    this.x = x;
    this.invalidate();
  }

  // The answer in white is taken, but not before the window has landed: a press meant for
  // something else cannot answer a question that has not been read.
  press() {
    if (!this.moving) this.finish(this.choice);
  }

  pick(choice) {
    if (!this.active || this.closing || choice === this.choice) return;
    this.choice = choice;
    this.changed = true;
    this.invalidate();
  }

  // Ends the asking with the answer taken, shown a moment first, or with none (Back). Back
  // may come while the window is still arriving: as in the firmware, it lands at once and
  // then goes.
  finish(choice) {
    if (!this.active || this.closing) return;
    this.closing = true;
    if (this.animation) {
      this.animation.unschedule();
      this.animation = undefined;
      this.moving = false;
      this.moveTo(STRIP);
    }
    this.answered = choice;
    if (choice !== undefined) this.choice = choice;
    this.changed = true;
    this.invalidate();
    setTimeout(() => {
      this.moving = true;
      this.animation = new Animation(PUSH_MS, linear, progress => {
        this.moveTo(moook(progress, STRIP, WIDTH, PUSH_MID));
      }, () => {
        this.buttons.close();
        this.active = this.moving = false;
        this.animation = this.buttons = this.page = this.lines = this.widths = this.labelWidths = this.font =
          this.itemFont = undefined;
        this.done(choice === undefined ? undefined : choice === YES);
      }).schedule();
    }, choice === undefined ? 0 : PRESSED_MS);
  }

  // A Touch sensor sample ([{x, y}] while the finger is down, [] when it lifts). A tap on an
  // answer's row picks it, and on the one already picked takes it.
  touch(points) {
    const point = points[0], origin = this.touchOrigin;
    if (point && !origin) {
      this.touchOrigin = this.moving || this.closing || point.x < this.x + EDGE ? IGNORED : point;
    } else if (!point && origin) {
      this.touchOrigin = undefined;
      const y = origin.y - ANSWERS_TOP;
      if (y < 0 || origin === IGNORED) return;
      const choice = y < ANSWERS >> 1 ? YES : NO;
      if (choice === this.choice) this.press();
      else this.pick(choice);
    }
  }

  // Paints a frame. `moved` is true when only the window has changed since the last frame.
  //
  // The page and the window move as one, so while the window comes in, leftwards from a
  // frame already drawn, the frame is moved natively and only the window's columns that
  // this uncovers at the right are painted, from a column that cuts through no text (edge).
  // At rest only the window is painted. Any other frame paints the page where its columns
  // will show, moves it out of the frame to the left (or right, past the page's place, as
  // the window overshoots going), and paints the window over the rest. A window whose
  // answer changed is painted whole.
  render(moved) {
    const x = this.x, drawn = this.drawn, changed = this.changed;
    this.changed = false;
    if (moved && drawn !== undefined && x <= drawn && drawn <= WIDTH && x < WIDTH && (x === drawn || !changed)) {
      if (x < drawn) Natives.shiftColumns(0, HEIGHT, drawn - x);
      const left = x < drawn ? this.edge(x, WIDTH - (drawn - x)) : x;
      render.begin(left, 0, WIDTH - left, HEIGHT);
      this.draw(x, left);
    } else {
      const hidden = WIDTH - x, shown = hidden > GLYPH_SLACK ? hidden - GLYPH_SLACK : 0;
      render.begin();
      // Poco's clip stack restores, when a clip is popped, the rectangle saved when it was
      // pushed, which begin() does not set: so the whole screen is pushed first.
      render.clip(0, 0, WIDTH, HEIGHT);
      render.clip(shown, 0, WIDTH - shown, HEIGHT);
      this.page.draw(0, HEIGHT);
      render.clip();
      Natives.shiftColumns(0, HEIGHT, hidden);
      if (hidden < 0) render.fillRectangle(WHITE, 0, 0, -hidden, HEIGHT);
      this.draw(x, 0);
      render.clip();
    }
    render.end();
    this.drawn = x;
  }

  // The first column to paint from, at or left of `from`, that cuts through neither the text
  // nor the icon of the window at `x`: a letter cut by the clip would not be drawn at all.
  edge(x, from) {
    const inside = x + EDGE, iconX = inside + ((PANE - ICON) >> 1), textX = inside + INSET;
    let left = from;
    if (left > iconX && left < iconX + ICON) left = iconX;
    if (left > textX && left < textX + this.reach) left = textX;
    return left;
  }

  // Text is handed to the firmware only if it reaches the columns being painted (from
  // `left`) and starts on the screen.
  text(string, f, color, x, top, width, left) {
    if (x < WIDTH && x + width > left) drawText(string, f, color, x, top);
  }

  // The window with its left edge at column `x`, its black reaching to the screen's right
  // edge as it overshoots (as the firmware fills that gap with its edge column). Only the
  // columns from `left` on are being painted.
  draw(x, left) {
    if (x >= WIDTH) return;
    render.fillRectangle(BLACK, x, 0, WIDTH - x, HEIGHT);
    const inside = x + EDGE, width = WIDTH - inside;
    if (width <= 0) return;
    const iconX = inside + ((PANE - ICON) >> 1);
    if (this.icon && iconX < WIDTH && iconX + ICON > left) Natives.iconDraw(this.icon, iconX, ICON_TOP);
    const lines = this.lines;
    for (let index = 0; index < lines.length; index++) {
      this.text(lines[index], this.font, WHITE, inside + INSET, this.questionTop + index * this.lineHeight,
                this.widths[index], left);
    }
    const taken = this.answered !== undefined;
    for (let row = 0; row < 2; row++) {
      const choice = row ? NO : YES, chosen = choice === this.choice, top = ANSWERS_TOP + PAD + row * ROW;
      if (chosen && taken) render.fillRectangle(WHITE, inside, top, width, ROW);
      this.text(LABELS[choice], this.itemFont, chosen ? (taken ? BLACK : WHITE) : DARK_GRAY, inside + INSET,
                top + ((ROW - ITEM_CAP) >> 1) - ITEM_CAP_TOP, this.labelWidths[choice], left);
    }
  }
}
