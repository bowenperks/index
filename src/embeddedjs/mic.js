// The voice input in Index's dock: Pebble's own microphone (the dictation screen's, scaled
// to the notification banner's 25px icon: 25px of ink on a 24px canvas), black lines with
// its capsule white inside, in a blue bubble; and the recording's waveform, which runs in
// the dock's blue bar.
import Poco from "commodetto/Poco";
import {MIC_SMALL} from "assets";
import {render} from "theme";

export const MIC_SIZE = 24;       // the microphone's canvas, square

let glyph;

// The microphone centred on (cx, cy).
export function drawMic(cx, cy) {
  glyph ??= new Poco.PebbleDrawCommandImage(MIC_SMALL);
  render.drawDCI(glyph, cx - (MIC_SIZE >> 1), cy - (MIC_SIZE >> 1));
}

// A live recording's waveform: bars scroll in from the right, their heights following a
// speech-like envelope of syllables and pauses.
// Sized for the dock's 29px bar: 21 bars 6px apart (123px across, centred), up to 21px
// tall, the quietest 3px (a dot).
export const BARS = 21, BAR_PITCH = 6, BAR_WIDTH = 3, BAR_MIN = 3, BAR_MAX = 21;

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

  get width() {
    return (BARS - 1) * BAR_PITCH + BAR_WIDTH;
  }

  // Draws the bars with their left edge at x, centred on cy.
  draw(x, cy, color) {
    for (let index = 0; index < BARS; index++) {
      const height = BAR_MIN + Math.trunc((BAR_MAX - BAR_MIN) * this.levels[index] / 255);
      const half = height >> 1;
      const bar = x + 1 + index * BAR_PITCH;
      // A 3px line has round ends; inset them so the bar's ink is `height` tall.
      render.drawLine(bar, cy - half + 1, bar, cy + half - 1, color, BAR_WIDTH);
    }
  }
}
