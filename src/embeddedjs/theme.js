// The screen, colours, fonts and text setting shared by every part of Index.
import Poco from "commodetto/Poco";
import {PEN} from "assets";

export const render = new Poco(screen);
export const WIDTH = render.width;
export const HEIGHT = render.height;

// The watch's text size: 0 small, 1 medium, 2 large (Emery's default), 3 extra large.
export const SMALL = 0, MEDIUM = 1, LARGE = 2, EXTRA_LARGE = 3;
let contentSize = LARGE;
try {
  contentSize = Natives.contentSize();
} catch (error) {
  console.log("Index: text size unavailable, using large: " + error);
}
export const CONTENT_SIZE = contentSize;

export const WHITE = render.makeColor(255, 255, 255);
export const BLACK = render.makeColor(0, 0, 0);
export const DARK_GRAY = render.makeColor(85, 85, 85);
export const LIGHT_GRAY = render.makeColor(170, 170, 170);
export const VIVID_CERULEAN = render.makeColor(0, 170, 255);
export const COBALT = render.makeColor(0, 85, 170);

// Animations pass opacity: 0 is hidden, 255 fully visible (black on the white page).
export function ink(opacity) {
  const shade = 255 - opacity;
  return render.makeColor(shade, shade, shade);
}

// Vector art by resource id, the last few used kept. `new PebbleDrawCommandImage` returns
// Alloy's cached image but first makes a throwaway object, and on the watch that garbage,
// for every card every frame, forces collections that stall motion.
const arts = new Map();
export function art(id) {
  let image = arts.get(id);
  if (!image) {
    // Two at most: the map and a disc are ~1 KB of native memory each, and the cards
    // that need more are off screen more often than on.
    if (arts.size >= 2) arts.delete(arts.keys().next().value);
    arts.set(id, image = new Poco.PebbleDrawCommandImage(id));
  }
  return image;
}

// Poco's frameRoundRect strokes at the graphics context's current width, which drawing a
// PDC leaves at its last command's width (the icons' 2-3px). Drawing a 1px line off screen
// sets it back to 1 before an outline.
let pen;
export function resetPen() {
  pen ??= new Poco.PebbleDrawCommandImage(PEN);
  render.drawDCI(pen, -16, -16);
}

const fonts = new Map();
export function font(family, size) {
  const key = family + size;
  let found = fonts.get(key);
  if (!found) {
    found = new render.Font(family, size);
    fonts.set(key, found);
  }
  return found;
}

// Text is placed as the native app placed graphics_draw_text boxes: by the box's top.
// Poco positions a line by its cap height instead, offset by the font's cap bearing.
// Worked out once per font: reading a font's metrics is a call into native code, and text
// is drawn many times a frame.
const capOffsets = new Map();
function capOffset(f) {
  let offset = capOffsets.get(f);
  if (offset === undefined) capOffsets.set(f, offset = f.height - f.ascent - 1);
  return offset;
}

export function drawText(text, f, color, x, top) {
  render.drawText(text, f, color, x, top + capOffset(f) - 1);
}

// A text's width is measured natively every time. A cache of recent widths per font
// came to hold entries for every font the cards use, a few KB of the XS heap (which
// never shrinks), to save a handful of measurements a frame.
export const textWidth = (text, f) => render.getTextWidth(text, f);

// Word wrap as Pebble's text layout does it: whole words per line, a word too long for a
// line broken by character, and a trailing ellipsis when lines run out. Candidate lines are
// measured uncached, so a long text's many prefixes never fill the width cache; the lines
// are not cached either, since each entry keeps its own.
export function wrap(text, f, width, maxLines = 64) {
  let lines = [];
  let line = "";
  const words = text.split(" ").filter(word => word.length);
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const candidate = line ? line + " " + word : word;
    if (textWidth(candidate, f) <= width) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let rest = word;
    while (textWidth(rest, f) > width && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), f) > width) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = lines.slice(maxLines - 1).join(" ");
    while (last.length && textWidth(last + "…", f) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    lines = kept;
  }
  return lines;
}

// graphics_text_layout_get_content_size: the widest line, and a font height per line.
export function measure(text, f, width, maxLines) {
  const lines = wrap(text, f, width, maxLines);
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, textWidth(line, f));
  return {w: widest, h: lines.length * f.height, lines};
}

