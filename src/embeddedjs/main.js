// Index: a conversational assistant demo for Pebble Time 2, in Alloy.
//
// Select asks by voice; Index thinks, then answers with a reply or a widget card. Up and
// Down (or a touch drag) scroll the one page that holds the home screen and the
// conversation. Everything is drawn with Poco into the watch's frame buffer.
import Button from "pebble/button";
import Dictation from "pebble/dictation";
import {render} from "theme";
import Home from "home";
import Chat from "chat";
import {widgetFor, replyFor} from "prompts";
import {onFrame, isAnimating} from "motion";
import {setTimeout, startTimers} from "timers";

// The build helper enables this only in the Select-driven playtest package.
const PLAYTEST = false;
const PLAYTEST_PROMPTS = [
  "weather", "alarm", "beeper", "timer", "reminder",
  "new note", "use a tool", "add to note", "help",
];
let nextPlaytestPrompt = 0;
let playtestPending = false;
let drawPending = false;
let drawTimer;
let dictating = false;

// Animation updates paint on their existing frame tick. Scheduling a zero-delay draw
// from every tick can accumulate expired native timers in Alloy's event queue.
function invalidate() {
  drawPending = true;
  if (!isAnimating() && drawTimer === undefined) {
    drawTimer = setTimeout(() => {
      drawTimer = undefined;
      draw();
    }, 33);
  }
}

function draw() {
  if (!drawPending) return;
  drawPending = false;
  // While the system's dictation window is up, Index must not draw over it.
  if (dictating || !chat) return;
  render.begin();
  chat.draw();
  render.end();
}

onFrame(draw);

const home = new Home(invalidate);
const chat = new Chat(home, questionReady, invalidate);

// Index's reply to a question, once it has thought: the prompt's widget card, or text.
function questionReady(id, question) {
  const reply = replyFor(question);
  const widget = widgetFor(question);
  if (!widget || !chat.widget(id, widget, reply)) chat.answer(id, reply);
}

// A transcribed question starts a turn; a widget prompt tells the page which card is
// coming, so the thinking cube can close into that widget's dot.
function ask(question) {
  const id = chat.begin(question);
  if (!id) {
    chat.showNotice("I couldn't start that question. Please try again.");
    return false;
  }
  const widget = widgetFor(question);
  if (widget) chat.expectWidget(id, widget);
  return true;
}

function playNext() {
  if (dictating || chat.busy || chat.reveal?.scheduled) return;
  const question = PLAYTEST_PROMPTS[nextPlaytestPrompt];
  if (!ask(question)) return;
  trace(`Index Alloy playtest ${nextPlaytestPrompt + 1}/${PLAYTEST_PROMPTS.length}: ${question}\n`);
  nextPlaytestPrompt = (nextPlaytestPrompt + 1) % PLAYTEST_PROMPTS.length;
}

function queuePlayNext() {
  if (playtestPending || dictating || chat.busy || chat.reveal?.scheduled) return;
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

const selectButton = new Button({
  type: "select",
  single: true,
  onPush(down) {
    if (!down) return;
    if (PLAYTEST) queuePlayNext();
    else startDictation();
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
  },
});

watch.addEventListener("minutechange", () => {
  home.refresh();
  chat.refreshTime();
});

// The icon ring spins in once the launcher's transition has finished and Index has focus.
// Opened from the launcher, focus can arrive before this script is running to hear it, so
// the ring also starts on its own shortly after launch.
watch.addEventListener("didFocus", inFocus => {
  if (inFocus) home.carousel.start();
});
setTimeout(() => home.carousel.start(), 300);

chat.show();

// Development only: questions asked automatically after launch, to exercise the page
// without dictation (for example in the emulator). Empty in releases.
const AUTOPLAY = [];
if (!PLAYTEST) {
  AUTOPLAY.forEach((question, index) => setTimeout(() => ask(question), 2500 + index * 9000));
}

// Start the sole native timer after startup allocation and UI setup have completed.
startTimers();
