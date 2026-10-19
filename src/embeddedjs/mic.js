// The voice input at the end of Index's page: a microphone inside the thinking ring, which
// sends out a slow ping while it waits and swells with the voice while it listens; and the
// recording's waveform, which runs inside the user's bubble.
import Poco from "commodetto/Poco";
import {MIC} from "assets";
import {render, WHITE, BLACK, DARK_GRAY, LIGHT_GRAY} from "theme";

export const RING = 20;           // the thinking ring's resting radius, in pixels
const STROKE = 3;                 // the ring's width, as drawRing's coverage gives it
const PING_REACH = 12;            // how far past the ring a ping travels

let glyph;

// The ring and microphone centred on (cx, cy). `radius` is the ring's (RING at rest, more
// while a voice is loud); `ping` is the outgoing ping's progress, 0-1024, or undefined.
export function drawMic(cx, cy, radius, ping) {
  if (ping !== undefined && ping < 1024) {
    // A thin ring that leaves the microphone's and fades, dark then light, as it goes.
    const reach = radius + 1 + Math.trunc(PING_REACH * ping / 1024);
    render.drawCircle(ping < 512 ? DARK_GRAY : LIGHT_GRAY, cx, cy, reach);
    render.drawCircle(WHITE, cx, cy, reach - 2);
  }
  render.drawCircle(BLACK, cx, cy, radius);
  render.drawCircle(WHITE, cx, cy, radius - STROKE);
  glyph ??= new Poco.PebbleDrawCommandImage(MIC);
  render.drawDCI(glyph, cx - (glyph.width >> 1), cy - (glyph.height >> 1));
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

  get level() {
    return this.levels[BARS - 1];
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
