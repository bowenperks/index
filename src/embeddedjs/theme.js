// The screen, colours, fonts and text setting shared by every part of Index.
//
// Its functions are arrows: XS makes every ordinary `function` a prototype object too,
// 48 B of the app's heap from launch, and an arrow has none.
import Poco from "commodetto/Poco";
import {PEN} from "assets";

// Poco on Pebble draws straight into the frame buffer: it never uses the display list or
// the row buffer Poco allocates by default (1 KB and two rows), so they are kept to the
// least it accepts, which leaves the app's heap ~1.2 KB more.
export const render = new Poco(screen, {displayListLength: 0, pixels: screen.width});
export const WIDTH = render.width;
export const HEIGHT = render.height;

// The watch's text size, as Emery reports it: 1 medium, 2 large (its default), 3 extra
// large. Emery cannot show the small size, and never reports it.
export const MEDIUM = 1, LARGE = 2, EXTRA_LARGE = 3;
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
export const ink = opacity => {
  const shade = 255 - opacity;
  return render.makeColor(shade, shade, shade);
};

// Vector art by resource id, the last few used kept. `new PebbleDrawCommandImage` returns
// Alloy's cached image but first makes a throwaway object, and on the watch that garbage,
// for every card every frame, forces collections that stall motion.
const arts = new Map();
export const art = id => {
  let image = arts.get(id);
  if (!image) {
    // Two at most: the map and a disc are ~1 KB of native memory each, and the cards
    // that need more are off screen more often than on.
    if (arts.size >= 2) arts.delete(arts.keys().next().value);
    arts.set(id, image = new Poco.PebbleDrawCommandImage(id));
  }
  return image;
};

// Poco's frameRoundRect strokes at the graphics context's current width, which drawing a
// PDC leaves at its last command's width (the icons' 2-3px). Drawing a 1px line off screen
// sets it back to 1 before an outline.
let pen;
export const resetPen = () => {
  pen ??= new Poco.PebbleDrawCommandImage(PEN);
  render.drawDCI(pen, -16, -16);
};

const fonts = new Map();
export const font = (family, size) => {
  const key = family + size;
  let found = fonts.get(key);
  if (!found) {
    found = new render.Font(family, size);
    fonts.set(key, found);
  }
  return found;
};

// Text is placed as the native app placed graphics_draw_text boxes: by the box's top.
// Poco positions a line by its cap height instead, offset by the font's cap bearing.
// Worked out once per font, with the font's line height: reading a font's metrics is a
// call into native code, and text is drawn many times a frame.
const metrics = new Map();
const metric = f => {
  let found = metrics.get(f);
  if (!found) metrics.set(f, found = [f.height - f.ascent - 1, f.height]);
  return found;
};

// The rows being painted (screen coordinates). A frame often paints only a band of the
// screen: text outside it is skipped, and callers check larger art with inBand, rather
// than handing it to the firmware to lay out and clip away. The firmware lays out every
// line whose 127px text box reaches the clip at all, so without this a band a few rows
// high costs the text of whole cards.
// A narrow band (a scroll's icon column) also ends at `right`: text that starts beyond it
// is skipped too.
let bandTop = -32768, bandBottom = 32767, bandRight = 32767;
export const setBand = (top, bottom, right) => {
  bandTop = top;
  bandBottom = bottom;
  bandRight = right;
};
export const inBand = (top, bottom) => bottom > bandTop && top < bandBottom;

// @strip profile
// Lines of text drawn this frame, for the instrumented build's profile.
export const stats = {texts: 0, shift: 0, icons: 0, strip: 0, rest: 0, stretch: 0, stretches: 0};
// @endstrip

export const drawText = (text, f, color, x, top) => {
  const found = metric(f);
  // A line's ink starts inside its box, but its descenders hang below it, by up to 6 rows
  // in Gothic 36 (4 in Gothic 24 and 28): a line ending that far above the band still
  // reaches it.
  if (top + found[1] + 6 <= bandTop || top - 2 >= bandBottom || x >= bandRight) return;
  // @strip profile
  stats.texts++;
  // @endstrip
  render.drawText(text, f, color, x, top + found[0] - 1);
};

// A text's width is measured natively every time. A cache of recent widths per font
// came to hold entries for every font the cards use, a few KB of the XS heap (which
// never shrinks), to save a handful of measurements a frame.
export const textWidth = (text, f) => render.getTextWidth(text, f);

// Word wrap as Pebble's text layout does it: whole words per line, a word too long for a
// line broken by character, and a trailing ellipsis when lines run out. Candidate lines are
// measured uncached, so a long text's many prefixes never fill the width cache; the lines
// are not cached either, since each entry keeps its own.
export const wrap = (text, f, width, maxLines = 64) => {
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
};

// graphics_text_layout_get_content_size: the widest line, and a font height per line.
export const measure = (text, f, width, maxLines) => {
  const lines = wrap(text, f, width, maxLines);
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, textWidth(line, f));
  return {w: widest, h: lines.length * f.height, lines};
};

