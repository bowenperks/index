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
let lastDraw = 0;
function invalidate() {
  drawPending = true;
  if (!isAnimating() && drawTimer === undefined) {
    drawTimer = setTimeout(() => {
      drawTimer = undefined;
      draw();
    }, 0);
  }
}

function draw() {
  if (!drawPending) return;
  drawPending = false;
  // While the system's dictation window is up, Index must not draw over it.
  if (dictating || !chat) return;
  lastDraw = now();
  chat.render();
}

onFrame(draw);

const chat = new Chat(questionReady, invalidate, talk);

// Index's result for a question, once it has thought.
function questionReady(question) {
  const {widget, text} = resolve(question);
  chat.result(widget, text);
}

// A transcribed question starts a turn.
function ask(question) {
  if (!chat.ask(question)) {
    chat.showNotice("I couldn't start that question. Please try again.");
  }
}

function playNext() {
  if (dictating || chat.busy) return;
  const [question] = DEMO[nextDemo];
  if (!chat.listen(question, RECORDING_MS)) return;
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
