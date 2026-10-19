// Index: a conversational assistant demo for Pebble Time 2, in Alloy.
//
// Index opens on its history of results, newest at the bottom, with the microphone beneath
// them. Select (or a tap on the microphone) asks by voice; the words come in, Index thinks,
// and the result takes their place. Up and Down (or a touch drag) scroll the history.
// Everything is drawn with Poco into the watch's frame buffer.
import Button from "pebble/button";
// @strip dictation
import Dictation from "pebble/dictation";
// @endstrip
import Chat from "chat";
import {DEMO} from "prompts";
import {onFrame, isAnimating, now} from "motion";
import {setTimeout, startTimers} from "timers";
// @strip profile
import {cubeStats} from "thinking";
import {stats, render} from "theme";
import {BEEPER_MEDIUM, STREET_MAP, PEN} from "assets";
// @endstrip

// The build helper enables this only in the Select-driven playtest package, which asks
// the demo reel's requests in turn with a simulated recording instead of dictation.
const PLAYTEST = false;
const RECORDING_MS = 1800;
let nextDemo = 0;
let playtestPending = false;
let drawPending = false;
let drawTimer;
let dictating = false;

// Animation updates paint on their existing frame tick; other changes paint on the next
// tick of the app's one timer (timers.js), never on a native timer of their own.
//
// After each frame the firmware copies the app's frame buffer to its own, on its own
// task and at once, then sends it to the display, which takes under 20ms on the watch.
// While the display is still busy with the frame before, the copy waits for it, and a
// frame drawn into the buffer meanwhile is copied half done: a white flash, icons gone
// for a moment. The display's transfer of the last frame began before this one was
// drawn, so it is over FRAME_PERIOD_MS after this one started; the prompt copy is done
// FRAME_SETTLE_MS after it ended. A frame starts no sooner than either: every 33ms tick
// while a frame draws within the tick, 30 a second.
const FRAME_PERIOD_MS = 28, FRAME_SETTLE_MS = 6;
let frameDue = 0;   // when the next frame may start
// @strip profile
let lastDrawEnd = 0;
// @endstrip
function invalidate() {
  drawPending = true;
  if (!isAnimating() && drawTimer === undefined) armDraw();
}

function armDraw() {
  drawTimer = setTimeout(() => {
    drawTimer = undefined;
    draw();
  }, Math.max(0, frameDue - now()));
}

// Instrumented builds (INDEX_INSTRUMENT=1) keep, per phase of a turn, how many frames were
// drawn, how long they took, and the longest wait between frames, and log it all once the
// turn is over (logging during it would itself delay frames), to find stalls on the watch.
const PROFILE = false;
// Instrumented builds with INDEX_SCROLLBENCH=1 also press Up and Down by themselves after
// launch, so a scroll can be measured on the watch with nobody at its buttons.
const SCROLL_BENCH = false;
// @strip profile
const profile = PROFILE ? {} : undefined;
let profiling = false, renders = 0, scrollStart = 0;

function record(key, gap, draw, texts) {
  if (!chat.busy && chat.stretch === undefined) {
    if (!profiling) return;
    profiling = false;
    for (const name in profile) {
      const s = profile[name];
      trace(`${name}: ${s.frames} frames, draw avg ${Math.trunc(s.sum / s.frames)} max ${s.max}, ` +
            `gap max ${s.gap}, late ${s.late}, texts avg ${Math.trunc(s.texts / s.frames)} max ${s.textMax}\n`);
      delete profile[name];
    }
    const passes = Natives.renderCount();
    trace(`render passes ${passes - renders} in ${now() - scrollStart}ms; ms in shift ${stats.shift}, ` +
          `strip ${stats.strip}, icon column ${stats.icons}, rest ${stats.rest}\n`);
    stats.shift = stats.icons = stats.strip = stats.rest = stats.stretch = stats.stretches = 0;
    renders = passes;
    if (!SCROLL_BENCH) {
      const [collections, collectionMax, loadMax] = cubeStats();
      trace(`cube: ${collections} collections, longest ${collectionMax}ms; longest frame load ${loadMax}ms\n`);
    }
    return;
  }
  if (!profiling) {
    renders = Natives.renderCount();
    scrollStart = now();
  }
  const s = profile[key] ??= {frames: 0, sum: 0, max: 0, gap: 0, late: 0, texts: 0, textMax: 0};
  s.frames++;
  s.sum += draw;
  s.texts += texts;
  if (texts > s.textMax) s.textMax = texts;
  if (draw > s.max) s.max = draw;
  // The first frame of a turn follows the idle wait, which is no gap.
  if (profiling) {
    if (gap > s.gap) s.gap = gap;
    if (gap > 50) s.late++;
  }
  profiling = true;
}
// @endstrip

function draw() {
  if (!drawPending) return;
  // While the system's dictation window is up, Index must not draw over it.
  if (dictating || !chat) {
    drawPending = false;
    return;
  }
  if (now() < frameDue) {
    // Too soon after the last frame: the next animation tick, or a timer, draws it.
    if (!isAnimating() && drawTimer === undefined) armDraw();
    return;
  }
  drawPending = false;
  const start = now();
  // @strip profile
  const kind = chat.dirty === true ? "full" : chat.dirty === "scroll" ? "shift" : "band";
  stats.texts = 0;
  // @endstrip
  chat.render();
  const end = now();
  // @strip profile
  if (PROFILE) record(chat.phase + " " + kind, start - lastDrawEnd, end - start, stats.texts);
  lastDrawEnd = end;
  // @endstrip
  frameDue = Math.max(start + FRAME_PERIOD_MS, end + FRAME_SETTLE_MS);
}

onFrame(draw);

const chat = new Chat(invalidate, talk);

// @strip dictation
import {resolve} from "prompts";
// A transcribed question starts a turn, with Index's result for it known up front.
function ask(question) {
  if (!chat.ask(question, resolve(question))) {
    chat.showNotice("I couldn't start that question. Please try again.");
  }
}
// @endstrip

function playNext() {
  if (dictating || chat.busy) return;
  const [question, widget, text] = DEMO[nextDemo];
  if (!chat.listen(question, RECORDING_MS, {widget, text})) return;
  trace(`Index Alloy playtest ${nextDemo + 1}/${DEMO.length}: ${question}\n`);
  nextDemo = (nextDemo + 1) % DEMO.length;
}

function queuePlayNext() {
  if (playtestPending || dictating || chat.busy) return;
  playtestPending = true;
  // Return from the firmware's button callback before laying out/drawing a turn.
  // This lets queued button events drain instead of holding the input handler open.
  setTimeout(() => {
    playtestPending = false;
    playNext();
  }, 33);
}

// @strip dictation
const dictation = PLAYTEST ? undefined : new Dictation({
  byteLength: 160,
  onReadable() {
    const question = this.read() ?? "";
    dictationFinished();
    ask(question);
  },
  onError(status) {
    dictationFinished();
    // 3 is DictationSessionStatusFailureSystemAborted: the user backed out.
    if (status !== 3) chat.showNotice("I couldn't hear that. Try again?");
  },
});
dictation?.configure({confirm: true});

function startDictation() {
  if (!dictation || dictating || chat.busy) return;
  try {
    dictation.start();
  } catch (error) {
    chat.showNotice("Dictation isn't available.");
    return;
  }
  dictating = true;
  chat.hide();
}

function dictationFinished() {
  dictating = false;
  chat.show();
  // Repaint once the dictation window has finished leaving, too.
  setTimeout(invalidate, 350);
}
// @endstrip

// Select, or a tap on the microphone.
function talk() {
  if (PLAYTEST) queuePlayNext();
  // @strip dictation
  else startDictation();
  // @endstrip
}

const selectButton = new Button({
  type: "select",
  single: true,
  onPush(down) {
    if (down) talk();
  },
});

const scrollButtons = new Button({
  types: ["up", "down"],
  single: {repeat: 180},
  onPush(down, type) {
    if (down) chat.scroll(type === "down");
  },
});

const touch = new device.sensor.Touch({
  onSample() {
    chat.touch(this.sample());
    // A finger is followed at once, not on the next timer tick (at most every 20ms).
    if (drawPending) draw();
  },
});

watch.addEventListener("minutechange", () => chat.refreshTime());

chat.show();

// Development only: questions asked automatically after launch, to exercise the page
// without dictation (for example in the emulator). Empty in releases.
const AUTOPLAY = [];
if (!PLAYTEST) {
  AUTOPLAY.forEach((question, index) => setTimeout(() => ask(question), 2500 + index * 9000));
}

// @strip profile
if (SCROLL_BENCH) {
  // First what the firmware's drawing calls cost on their own (tools/bench.c), over the
  // whole screen and in an icon band's clip; then two pages up and back, twice, a
  // scroll every 1.2 s.
  if (Natives.benchDraw) setTimeout(() => {
    render.begin();
    render.clip(0, 0, render.width, render.height);
    Natives.benchDraw(BEEPER_MEDIUM, STREET_MAP, PEN, 0);
    render.clip(6, 60, 40, 100);
    Natives.benchDraw(BEEPER_MEDIUM, STREET_MAP, PEN, 1);
    render.clip();
    render.clip();
    render.end();
    chat.invalidate();
  }, 2500);
  const presses = [false, false, true, true, false, false, true, true];
  presses.forEach((down, index) => setTimeout(() => {
    trace(`bench ${index + 1}/${presses.length}: ${down ? "down" : "up"}\n`);
    chat.scroll(down);
  }, 6000 + index * 1200));
}
// @endstrip

// @strip autoreel
// INDEX_AUTOREEL=N builds play N turns of the reel by themselves, an Up and a Down step
// after each, to measure memory on the watch with nobody at its buttons.
const AUTOREEL = 0;
let reelTurn = 0;
function reelNext() {
  if (reelTurn++ >= AUTOREEL) return;
  talk();
  setTimeout(() => chat.scroll(false), 8000);
  setTimeout(() => chat.scroll(true), 8800);
  setTimeout(reelNext, 9600);
}
if (PLAYTEST && AUTOREEL) setTimeout(reelNext, 3000);
// @endstrip

// Start the sole native timer after startup allocation and UI setup have completed.
startTimers();
