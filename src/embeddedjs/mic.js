// The voice input at the end of Index's page: Pebble's own microphone (the dictation
// screen's), which sends out a slow ping while it waits; and the recording's waveform,
// which runs inside the user's bubble.
import Poco from "commodetto/Poco";
import Debug from "debug";
import {MIC} from "assets";
import {render, WHITE, DARK_GRAY, LIGHT_GRAY} from "theme";

export const MIC_SIZE = 36;       // the microphone's art, square
const PING_FROM = 21;             // where a ping starts, just clear of the microphone
const PING_REACH = 12;            // how far it travels

let glyph;

// The microphone centred on (cx, cy). `ping` is the outgoing ping's progress, 0-1024, or
// undefined; `scale` shrinks the microphone (as it turns into the thinking cube's dot).
export function drawMic(cx, cy, ping, scale = 1) {
  if (ping !== undefined && ping < 1024) {
    // A thin ring that leaves the microphone and fades, dark then light, as it goes.
    const reach = PING_FROM + Math.trunc(PING_REACH * ping / 1024);
    render.drawCircle(ping < 512 ? DARK_GRAY : LIGHT_GRAY, cx, cy, reach);
    render.drawCircle(WHITE, cx, cy, reach - 2);
  }
  if (scale === 1) {
    glyph ??= new Poco.PebbleDrawCommandImage(MIC);
    render.drawDCI(glyph, cx - (MIC_SIZE >> 1), cy - (MIC_SIZE >> 1));
    return;
  }
  // A scaled copy is native memory XS cannot see: collect the last one before making it.
  Debug.gc();
  const small = new Poco.PebbleDrawCommandImage(MIC).clone().scale(scale);
  const half = Math.trunc(MIC_SIZE * scale / 2);
  render.drawDCI(small, cx - half, cy - half);
}

// A live recording's waveform: bars scroll in from the right, their heights following a
// speech-like envelope of syllables and pauses.
export const BARS = 15, BAR_PITCH = 6, BAR_WIDTH = 3, BAR_MIN = 3, BAR_MAX = 24;

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
