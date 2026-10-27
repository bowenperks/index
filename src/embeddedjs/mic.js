// The voice input in Index's dock: Pebble's own microphone (the dictation screen's),
// redrawn for the dock on the pixel grid (tools/build_assets.py DOCK_MIC), black lines with
// its capsule white inside, in a blue bubble; and the recording's waveform, which is the
// dock's divider come alive.
import Poco from "commodetto/Poco";
import {MIC_SMALL} from "assets";
import {render} from "theme";

export const MIC_WIDTH = 27, MIC_HEIGHT = 28;   // the microphone's canvas

let glyph;

// The microphone centred on (cx, cy), as an IconTransition places it.
export function drawMic(cx, cy) {
  glyph ??= new Poco.PebbleDrawCommandImage(MIC_SMALL);
  render.drawDCI(glyph, cx - (MIC_WIDTH >> 1), cy - (MIC_HEIGHT >> 1));
}

// A live recording's waveform: bars scroll in from the right, their heights following a
// speech-like envelope of syllables and pauses.
// The bars are the divider's dots (chat.js): 45 of them, 2px wide, 4px apart, the quietest
// a 2px square dot, the loudest reaching BAR_REACH rows above and below it.
export const BARS = 45, BAR_PITCH = 4, BAR_WIDTH = 2, BAR_REACH = 16;

export class Waveform {
  constructor() {
    this.levels = new Uint8Array(BARS);
    this.syllable = 0;
    this.pause = 2;
  }

  // Adds the next sample (0-255).
  step() {
    let level;
    if (this.pause > 0) {
      this.pause--;
      level = Math.trunc(Math.random() * 30);
    } else {
      // A syllable rises and falls over a few samples; words end in a short pause.
      this.syllable = (this.syllable + 1) % 5;
      const shape = [120, 230, 255, 180, 90][this.syllable];
      level = Math.trunc(shape * (0.55 + Math.random() * 0.45));
      if (this.syllable === 4 && Math.random() < 0.35) this.pause = 1 + Math.trunc(Math.random() * 2);
    }
    this.levels.copyWithin(0, 1);
    this.levels[BARS - 1] = level;
  }

  // Draws the bars from the dots at x (the first) and row `top` (each dot is rows `top`
  // and `top` + 1), each growing evenly up and down from its dot.
  draw(x, top, color) {
    for (let index = 0; index < BARS; index++) {
      const reach = Math.trunc(BAR_REACH * this.levels[index] / 255);
      render.fillRectangle(color, x + index * BAR_PITCH, top - reach, BAR_WIDTH, 2 + 2 * reach);
    }
  }
}
