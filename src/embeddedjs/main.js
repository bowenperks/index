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
// After each frame's render pass the firmware copies the app's frame buffer to its own and
// sends it to the display: a copy at most every 40 ms on the watch (measured), as each
// waits for the display to take the last. A frame drawn into the buffer before the last
// one's copy is copied half done: a strip unpainted, an icon cleared, the thinking ring's
// black fill before its white, seen as flicker. The firmware tells an app nothing when its
// copy happens, so it is worked out: a frame's copy is due when its render pass has run
// (scroll.c counts them) and no sooner than COPY_PERIOD_MS after the last frame's, and the
// next frame waits for it. Animations tick every 10 ms (motion.js), so a frame starts
// within 10 ms of that, with the animations' latest state: 25 frames a second, evenly.
const COPY_PERIOD_MS = 40;
// A frame's render pass follows within milliseconds; if none has come by this long (the
// window covered, say), the frame is taken as gone rather than waited on.
const PASS_TIMEOUT_MS = 100;
let copyDue = -COPY_PERIOD_MS, submittedAt = 0, submittedPasses = -1;

const frameWait = () => {
  const time = now();
  if (submittedPasses >= 0 && Natives.renderCount() === submittedPasses &&
      time - submittedAt < PASS_TIMEOUT_MS) {
    return 2;
  }
  return copyDue + 2 - time;
};

const frameSubmitted = () => {
  submittedAt = now();
  submittedPasses = Natives.renderCount();
  copyDue = Math.max(submittedAt, copyDue + COPY_PERIOD_MS);
};
// @strip profile
let lastDrawEnd = 0;
// @endstrip
const invalidate = () => {
  drawPending = true;
  if (!isAnimating() && drawTimer === undefined) armDraw();
};

const armDraw = (wait = 0) => {
  drawTimer = setTimeout(() => {
    drawTimer = undefined;
    draw();
  }, wait);
};

// Instrumented builds (INDEX_INSTRUMENT=1) keep, per phase of a turn, how many frames were
// drawn, how long they took, and the longest wait between frames, and log it all once the
// turn is over (logging during it would itself delay frames), to find stalls on the watch.
const PROFILE = false;
// Instrumented builds with INDEX_SCROLLBENCH=1 also press Up and Down by themselves after
// launch, so a scroll can be measured on the watch with nobody at its buttons.
const SCROLL_BENCH = false;
// @strip profile
const profile = PROFILE ? {} : undefined;
let profiling = false, renders = 0, scrollStart = 0, lastEndMs = 0, underCopy = 0;

const record = (key, gap, draw, texts) => {
  if (!chat.busy && chat.stretch === undefined) {
    if (!profiling) return;
    profiling = false;
    for (const name in profile) {
      const s = profile[name];
      trace(`${name}: ${s.frames} frames, draw avg ${s.sum / s.frames | 0} max ${s.max}, ` +
            `gap max ${s.gap}, late ${s.late}, texts avg ${s.texts / s.frames | 0} max ${s.textMax}\n`);
      delete profile[name];
    }
    const passes = Natives.renderCount();
    trace(`render passes ${passes - renders} in ${now() - scrollStart}ms; ms in shift ${stats.shift}, ` +
          `strip ${stats.strip}, icon column ${stats.icons}, rest ${stats.rest}; ` +
          `drawn before the last frame's render pass ${underCopy}\n`);
    Natives.renderLog();
    underCopy = 0;
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
};
// @endstrip

const draw = () => {
  if (!drawPending) return;
  // While the system's dictation window is up, Index must not draw over it.
  if (dictating || !chat) {
    drawPending = false;
    return;
  }
  const wait = frameWait();
  if (wait > 0) {
    // The last frame's copy is not over: the next animation tick, or a timer, draws it.
    if (!isAnimating() && drawTimer === undefined) armDraw(wait);
    return;
  }
  drawPending = false;
  const start = now();
  // @strip profile
  const kind = chat.dirty === true ? "full" : chat.dirty === "scroll" ? "shift" :
    chat.dirty === "confirm" ? "window" : "band";
  // A frame after the question has waited on the user's answer follows no stall.
  const waited = chat.confirm.active && !chat.confirm.moving;
  stats.texts = 0;
  if (Natives.renderStamp() < lastEndMs) underCopy++;
  // @endstrip
  if (chat.render()) frameSubmitted();
  const end = now();
  // @strip profile
  if (PROFILE) record(chat.phase + " " + kind, waited ? 0 : start - lastDrawEnd, end - start, stats.texts);
  lastDrawEnd = end;
  lastEndMs = Natives.nowMs();
  // @endstrip
};

onFrame(draw);

// Select, or a tap on the microphone. Defined before the page, which is handed it.
const talk = () => {
  if (PLAYTEST) queuePlayNext();
  // @strip dictation
  else startDictation();
  // @endstrip
};

const chat = new Chat(invalidate, talk);

// @strip dictation
import {resolve} from "prompts";
// A transcribed question starts a turn, with Index's result for it known up front.
const ask = question => {
  if (!chat.ask(question, resolve(question))) {
    chat.showNotice("I couldn't start that question. Please try again.");
  }
};
// @endstrip

const playNext = () => {
  if (dictating || chat.busy) return;
  const [question, widget, text, confirm] = DEMO[nextDemo];
  if (!chat.listen(question, RECORDING_MS, {widget, text, confirm})) return;
  trace(`Index Alloy playtest ${nextDemo + 1}/${DEMO.length}: ${question}\n`);
  nextDemo = (nextDemo + 1) % DEMO.length;
};

const queuePlayNext = () => {
  if (playtestPending || dictating || chat.busy) return;
  playtestPending = true;
  // Return from the firmware's button callback before laying out/drawing a turn.
  // This lets queued button events drain instead of holding the input handler open.
  setTimeout(() => {
    playtestPending = false;
    playNext();
  }, 33);
};

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

const startDictation = () => {
  if (!dictation || dictating || chat.busy) return;
  try {
    dictation.start();
  } catch (error) {
    chat.showNotice("Dictation isn't available.");
    return;
  }
  dictating = true;
  chat.hide();
};

const dictationFinished = () => {
  dictating = false;
  chat.show();
  // Repaint once the dictation window has finished leaving, too.
  setTimeout(invalidate, 350);
};
// @endstrip

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
  setTimeout(() => {
    Natives.renderLog();
    let flips = 0;
    const flood = globalThis.setInterval(() => {
      render.begin(0, 0, 1, 1);
      render.fillRectangle(++flips % 2 ? render.makeColor(255, 255, 255) : render.makeColor(254, 254, 254), 0, 0, 1, 1);
      render.end();
    }, 5);
    globalThis.setTimeout(() => {
      globalThis.clearInterval(flood);
      trace(`flood: ${flips} frames drawn\n`);
      Natives.renderLog();
    }, 1500);
  }, 4000);
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
const reelNext = () => {
  if (reelTurn++ >= AUTOREEL) return;
  // A turn that asks first is answered Yes, so its result, its Up and Down steps and the
  // next turn come later.
  const asks = DEMO[nextDemo][3] !== undefined, wait = asks ? 1500 : 0;
  talk();
  if (asks) setTimeout(() => chat.choose(true), 6000);
  setTimeout(() => chat.scroll(false), 8000 + wait);
  setTimeout(() => chat.scroll(true), 8800 + wait);
  setTimeout(reelNext, 9600 + wait);
};
if (PLAYTEST && AUTOREEL) setTimeout(reelNext, 3000);
// @endstrip

// Start the sole native timer after startup allocation and UI setup have completed.
startTimers();
