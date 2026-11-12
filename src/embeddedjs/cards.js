// The bodies of the demo's rich result cards, which fill the card (its icon and label hang
// below it): today's to-dos with a snapshot of the timeline, a translation, and a map with
// a pin and address. Like
// the weather card, their content is hardcoded and set in fixed fonts. Each is one
// function that measures its body (called without a frame) or draws it.
import Poco from "commodetto/Poco";
import {STREET_MAP, PIN_ICON} from "assets";
import {render, LIGHT_GRAY, COBALT, ink, font, drawText, textWidth, resetPen, art, inBand} from "theme";

const PADDING = 10, BOX = 12;
// The map, inset 6px inside the card's top and sides (clear of its rounded corners); its
// location, on Berners St between Eastcastle St and the lane; the pin's tip.
const MAP_WIDTH = 176, MAP_HEIGHT = 94, MAP_INSET = 6, PLACE_X = 96, PLACE_Y = 57;
const PIN_TIP_X = 12, PIN_TIP_Y = 24;

// The card being drawn: its body frame and reveal opacity (no frame while measuring), and
// the ink top of the next row.
let frame, shade, y;

// The demo's rows, and the widths the today card aligns on, measured on first use: a
// fresh array, or a measurement, every frame would be work and garbage on the watch.
const TODOS = ["Take the trash out", "Order more rings", "Speaker on the trike"];
const EVENTS = ["10:00", "Design review", "12:30", "Hendrik visits"];
let timeWidth, linkWidth;

// A row of text with its cap ink at the current row: `capTop` is where the face's cap ink
// starts inside its text box and `cap` how tall it is (from the PBFs), so rows are spaced
// on ink. Tone 0 is ink, 1 quiet grey, 2 cobalt. Moves down past the row and `after`.
const text = (string, family, size, capTop, cap, after, tone = 0, indent = 0) => {
  if (frame) {
    const color = tone === 2 && shade === 255 ? COBALT : ink(tone === 1 ? Math.min(shade, 170) : shade);
    drawText(string, font(family, size), color, frame.x + PADDING + indent, y - capTop);
  }
  y += cap + after;
};

const label = string => text(string, "Gothic-Bold", 14, 5, 9, 8, 1);

const rule = () => {
  if (frame) render.drawLine(frame.x + PADDING, y, frame.x + frame.w - PADDING - 1, y, LIGHT_GRAY, 1);
  y += 11;
};

const today = () => {
  label("TO-DOS");
  for (let index = 0; index < TODOS.length; index++) {
    // A box, its cap-height text centred on it.
    if (frame && inBand(y - 1, y + BOX)) {
      resetPen();
      render.frameRoundRect(frame.x + PADDING, y - 1, BOX, BOX, ink(Math.min(shade, 170)), 2);
    }
    text(TODOS[index], "Gothic-Regular", 18, 7, 11, 10, 0, BOX + 8);
  }
  rule();
  label("TIMELINE");
  timeWidth ??= textWidth("00:00", font("Gothic-Bold", 18));
  for (let index = 0; index < EVENTS.length; index += 2) {
    // A dot in the timeline's colour, the time in bold, then the event.
    if (frame && shade === 255) render.drawCircle(COBALT, frame.x + PADDING + 4, y + 5, 4);
    const before = y;
    text(EVENTS[index], "Gothic-Bold", 18, 7, 11, 0, 0, 14);
    y = before;
    text(EVENTS[index + 1], "Gothic-Regular", 18, 7, 11, 12, 0, 22 + timeWidth);
  }
  // The link that would open the watch's timeline, with its chevron.
  if (frame && inBand(y, y + 10)) {
    linkWidth ??= textWidth("Open timeline", font("Gothic-Bold", 18));
    const x = frame.x + PADDING + linkWidth + 6;
    const color = shade === 255 ? COBALT : ink(shade);
    render.drawLine(x, y + 1, x + 4, y + 5, color, 2);
    render.drawLine(x + 4, y + 5, x, y + 9, color, 2);
  }
  text("Open timeline", "Gothic-Bold", 18, 7, 11, 0, 2);
};

const translate = () => {
  label("ENGLISH");
  text("afternoon", "Gothic-Regular", 28, 10, 18, 10);
  rule();
  label("SPANISH");
  text("la tarde", "Gothic-Bold", 28, 10, 18, 9, 2);
  text("feminine noun", "Gothic-Regular", 18, 7, 11, 0, 1);
};

const map = () => {
  if (frame && shade === 255) {
    // Only when its rows are being painted: the map is the page's largest art.
    if (inBand(y, y + MAP_HEIGHT)) {
      const x = frame.x + ((frame.w - MAP_WIDTH) >> 1);
      render.drawDCI(art(STREET_MAP), x, y);
      // The street's name, its cap ink centred on the street (y 24-34).
      drawText("EASTCASTLE ST", font("Gothic-Bold", 14), ink(170), x + 6, y + 20);
      render.drawCircle(render.makeColor(170, 255, 255), x + PLACE_X, y + PLACE_Y, 9);
      render.drawDCI(art(PIN_ICON), x + PLACE_X - PIN_TIP_X, y + PLACE_Y - PIN_TIP_Y);
    }
  } else if (frame) {
    render.fillRectangle(ink(Math.min(shade, 85)), frame.x + MAP_INSET, y, MAP_WIDTH, MAP_HEIGHT);
  }
  y += MAP_HEIGHT + PADDING;
  text("Elizabeth", "Gothic-Bold", 24, 10, 14, 9);
  text("10 Berners St, London", "Gothic-Regular", 18, 7, 11, 6);
  text("Updated 2 min ago", "Gothic-Regular", 18, 7, 11, 0, 1);
};

// Runs a card's body: draws it into `body` ({x, y, w}) at `opacity`, or with no body only
// measures it. Returns the body's height.
const run = (card, body, opacity) => {
  frame = body;
  shade = opacity;
  const top = body ? body.y : 0;
  y = top + (card === map ? MAP_INSET : PADDING);
  card();
  frame = undefined;
  return y - top + PADDING + 2;
};

export const CARDS = {};
for (const [name, card] of [["today", today], ["translate", translate], ["map", map]]) {
  CARDS[name] = {height: run(card), draw: (body, opacity) => run(card, body, opacity)};
}
