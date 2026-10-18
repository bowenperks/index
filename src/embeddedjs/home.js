// The home screen, the top section of Index's one scrolling page: the date and time, the
// icon ring, and Index's greeting bubble across the bottom.
import Poco from "commodetto/Poco";
import {BUBBLE_GREETING} from "assets";
import Carousel, {SIZE as CAROUSEL_SIZE, INSET as CAROUSEL_INSET} from "carousel";
import {render, WIDTH, HEIGHT, CONTENT_SIZE, MEDIUM, ink, font, drawText, textWidth,
        measure, drawWrapped} from "theme";

export const DEFAULT_MESSAGE = "What can I help you with?";

// Pebble SDK Home's top margin for the time, and the am/pm marker's box with its Gothic 18
// ink inside it (descender excluded).
const TIME_TOP = 19, PERIOD_TOP = 46, PERIOD_INK_TOP = 4, PERIOD_INK_HEIGHT = 13;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
                "September", "October", "November", "December"];

// The greeting is a fixed panel across the bottom band, its ink centred inside, so its
// frame does not move as messages change length; 75px holds two Gothic 28 lines.
const BUBBLE_HEIGHT = 75, BUBBLE_BOTTOM_GAP = 6, BUBBLE_PADDING = 8, BUBBLE_TEXT_PADDING = 8;

export default class Home {
  constructor(invalidate) {
    this.invalidate = invalidate;
    this.carousel = new Carousel(invalidate);
    this.smallFont = font("Gothic-Bold", 18);
    if (CONTENT_SIZE <= MEDIUM) {
      this.timeFont = font("Leco-Bold", 36);
      this.timeInkTop = 11;
      this.timeInkHeight = 25;
      this.timeBold = true;
    } else {
      this.timeFont = font("Leco-Regular", 42);
      this.timeInkTop = 13;
      this.timeInkHeight = 29;
      this.timeBold = false;
    }
    this.messageFont = font("Gothic-Regular", CONTENT_SIZE <= MEDIUM ? 24 : 28);
    this.textTop = 10;
    this.textDescender = 4;
    this.greeting = new Poco.PebbleDrawCommandImage(BUBBLE_GREETING);
    this.bubbleTop = HEIGHT - BUBBLE_BOTTOM_GAP - BUBBLE_HEIGHT;
    // The ring is centred in the gap between the header's time and the greeting.
    const headerBottom = this.clockBottom;
    this.carouselFrame = {
      x: CAROUSEL_INSET,
      y: headerBottom + Math.trunc((this.bubbleTop - headerBottom - CAROUSEL_SIZE) / 2),
      w: WIDTH - 2 * CAROUSEL_INSET, h: CAROUSEL_SIZE,
    };
    this.setMessage(DEFAULT_MESSAGE);
    this.refresh();
  }

  // The bottom of the header's ink; the conversation's slim time bar takes over below it.
  get clockBottom() {
    return Math.max(TIME_TOP + this.timeInkTop + this.timeInkHeight,
                    PERIOD_TOP + PERIOD_INK_TOP + PERIOD_INK_HEIGHT);
  }

  refresh() {
    const now = new Date();
    this.date = MONTHS[now.getMonth()] + " " + now.getDate();
    const hour = now.getHours() % 12;
    this.time = (hour || 12) + ":" + String(now.getMinutes()).padStart(2, "0");
    this.period = now.getHours() < 12 ? "am" : "pm";
    // Leading-digit left bearings measured from the PBFs, so the time's ink (not its glyph
    // box) starts on the ring's cut-off and the bubble's edge.
    const lead = this.time[0];
    this.timeInkLeft = lead === "7" ? 1 : (this.timeBold && lead !== "3") ? 2 : 3;
    this.invalidate();
  }

  setMessage(message) {
    this.message = message ?? "";
    // The bubble's interior less its padding is the most ink it holds.
    const interior = BUBBLE_HEIGHT - 2;
    const inkLimit = interior - 2 * BUBBLE_PADDING;
    const width = WIDTH - 2 * CAROUSEL_INSET - 2 * (BUBBLE_TEXT_PADDING + 1);
    const maxLines = Math.max(1, Math.trunc((inkLimit + this.textTop - this.textDescender) / this.messageFont.height));
    const measured = measure(this.message, this.messageFont, width, maxLines);
    const inkHeight = Math.max(0, Math.min(inkLimit, measured.h - this.textTop + this.textDescender));
    this.text = {
      x: CAROUSEL_INSET + 1 + BUBBLE_TEXT_PADDING,
      y: this.bubbleTop + 1 + Math.trunc((interior - inkHeight) / 2) - this.textTop,
      w: width, maxLines,
    };
    this.invalidate();
  }

  show() {
    this.carousel.show();
  }

  hide() {
    this.carousel.hide();
  }

  // Draws the section with its top at `top` (minus the page's scroll).
  draw(top) {
    const left = 8;
    let date = this.date;
    if (textWidth(date, this.smallFont) > WIDTH - 16) {
      date = date.slice(0, 3) + date.slice(date.lastIndexOf(" "));
    }
    drawText(date, this.smallFont, ink(255), left, top + 1);
    // Pebble SDK Home's top margin and the LECO glyphs' bearings.
    const timeLeft = left - this.timeInkLeft;
    drawText(this.time, this.timeFont, ink(255), timeLeft, top + TIME_TOP);
    drawText(this.period, this.smallFont, ink(255),
             timeLeft + textWidth(this.time, this.timeFont) + 5, top + PERIOD_TOP);

    render.drawDCI(this.greeting, CAROUSEL_INSET - 5, top + this.bubbleTop);
    const welcome = this.message === DEFAULT_MESSAGE;
    drawWrapped(this.message, this.messageFont, ink(255), this.text.x, top + this.text.y,
                this.text.w, welcome ? "left" : "center", this.text.maxLines);

    const frame = this.carouselFrame;
    this.carousel.draw({x: frame.x, y: top + frame.y, w: frame.w, h: frame.h});
  }
}
