// Index: a conversational assistant demo for Pebble Time 2, in Alloy.
//
// Index opens on its history of results, newest at the bottom, with the microphone beneath
// them. Select (or a tap on the microphone) asks by voice; the words come in, Index thinks,
// and the result takes their place. Up and Down (or a touch drag) scroll the history.
// Everything is drawn with Poco into the watch's frame buffer.
import Button from "pebble/button";
import Dictation from "pebble/dictation";
import Chat from "chat";
import {DEMO, resolve} from "prompts";
import {onFrame, isAnimating, now} from "motion";
import {setTimeout, startTimers} from "timers";

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
// After each frame the firmware copies the app's frame buffer to the display on its own
// task, and when the display is still busy it defers that copy to a later moment. A frame
// drawn into the buffer too soon can then be copied half done: a white flash, icons gone
// for a moment. So a frame is never started until the previous one has had FRAME_GAP_MS
// to reach the display (its copy takes well under that).
const FRAME_GAP_MS = 24;
let lastDraw = 0, lastDrawEnd = -FRAME_GAP_MS;
function invalidate() {
  drawPending = true;
  if (!isAnimating() && drawTimer === undefined) armDraw();
}

function armDraw() {
  drawTimer = setTimeout(() => {
    drawTimer = undefined;
    draw();
  }, Math.max(0, lastDrawEnd + FRAME_GAP_MS - now()));
}

// Instrumented builds (INDEX_INSTRUMENT=1) keep, per phase of a turn, how many frames were
// drawn, how long they took, and the longest wait between frames, and log it all once the
// turn is over (logging during it would itself delay frames), to find stalls on the watch.
const PROFILE = false;
const profile = PROFILE ? {} : undefined;
let profiling = false;

function record(key, gap, draw) {
  if (!chat.busy) {
    if (!profiling) return;
    profiling = false;
    for (const name in profile) {
      const s = profile[name];
      trace(`${name}: ${s.frames} frames, draw avg ${Math.trunc(s.sum / s.frames)} max ${s.max}, ` +
            `gap max ${s.gap}, late ${s.late}\n`);
      delete profile[name];
    }
    return;
  }
  const s = profile[key] ??= {frames: 0, sum: 0, max: 0, gap: 0, late: 0};
  s.frames++;
  s.sum += draw;
  if (draw > s.max) s.max = draw;
  // The first frame of a turn follows the idle wait, which is no gap.
  if (profiling) {
    if (gap > s.gap) s.gap = gap;
    if (gap > 50) s.late++;
  }
  profiling = true;
}

function draw() {
  if (!drawPending) return;
  // While the system's dictation window is up, Index must not draw over it.
  if (dictating || !chat) {
    drawPending = false;
    return;
  }
  if (now() - lastDrawEnd < FRAME_GAP_MS) {
    // Too soon after the last frame: the next animation tick, or a timer, draws it.
    if (!isAnimating() && drawTimer === undefined) armDraw();
    return;
  }
  drawPending = false;
  lastDraw = now();
  const kind = chat.dirty === true ? "full" : "band";
  chat.render();
  const end = now();
  if (PROFILE) record(chat.phase + " " + kind, lastDraw - lastDrawEnd, end - lastDraw);
  lastDrawEnd = end;
}

onFrame(draw);

const chat = new Chat(invalidate, talk);

// A transcribed question starts a turn, with Index's result for it known up front.
function ask(question) {
  if (!chat.ask(question, resolve(question))) {
    chat.showNotice("I couldn't start that question. Please try again.");
  }
}

function playNext() {
  if (dictating || chat.busy) return;
  const [question] = DEMO[nextDemo];
  if (!chat.listen(question, RECORDING_MS, resolve(question))) return;
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

// Select, or a tap on the microphone.
function talk() {
  if (PLAYTEST) queuePlayNext();
  else startDictation();
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
    if (drawPending && now() - lastDraw >= 20) draw();
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

// Start the sole native timer after startup allocation and UI setup have completed.
startTimers();
