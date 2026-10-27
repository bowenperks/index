# Index — Alloy

This is the active Index implementation. Build the app in Alloy: the conversation,
widgets, animation and playtest logic run in `src/embeddedjs/` using Moddable XS
and Poco. The small C entry point starts the Alloy runtime and exposes text size.
The sibling `../index` folder is the older native C implementation.

## What it looks like

Index opens like a messaging app, on its history of results: newest at the bottom,
a slim time bar on top, day labels ("Yesterday", "Today") between days, and below them
the dock, the screen's bottom 49px: the Weather app's mainscreen divider (45 Dark Gray
dots) across it, and on the divider, centred, the voice input in a blue bubble: Pebble's
own microphone, the one the system dictation screen shows, redrawn for the dock on the
pixel grid without its rays, as large as the bubble holds it (21 x 28), black with its
capsule white inside. The divider's middle third
(15 dots) is always left out, whatever sits there, sized for the largest: a result's
icon as it unfolds. Below the divider is the bar, the 29px of a PebbleOS notification's
banner under its status bar (`LAYOUT_BANNER_HEIGHT_RECT`): white until the user speaks.
The microphone is 28px tall, 4px clear of its bubble above and below; the thinking cube
rests 41px tall, the largest that turns inside the dock, as smaller it loses its faces,
and a result's icon unfolds there as big as the cube.
The time bar's clock sits where the firmware's status bar puts it (digits from row 5).
A touch drag scrolls the history above it freely; Up and Down snap between stops, a
message in focus at the bottom of the screen with its icon just above the dock either
way. A message too tall to show whole there also stops at its top, just under the time
bar: going down first, going up after its icon (a day label goes with the message under
it). Text too long to read between those two stops also stops a page of text at a time,
each stop bringing the first line the last one did not show whole to just under the time
bar, the line before it hidden there, until the icon's stop shows the rest. Text in Index's cards and bubbles is
left-aligned, every line, and optically centred: as many empty rows above its first
line's capitals as below its last line's baseline, which in a card is the top of its
corner icon's ink.

Asking opens the bubble sideways into a rectangular blue bubble as wide as the divider
and as tall as the microphone's, and the recording's waveform squashes and stretches in: white bars on the middle 31 of the divider's dots, one tall bar at the
middle spreading out, flattening, past its width and back; each grows up and down from
its place as the voice comes in from the right. Then
the waveform draws back into its middle and the blue bubble becomes the whole transcribed
message: it takes the user's bubble's shape and pushes itself up into the page, the page
going up ahead of it, its top edge leading and its bottom following, and its words show,
from blue to white. While Index thinks, the thinking cube grows out of a dot where the
microphone was, in the divider's gap. When the result comes in, it takes the words' place: the history keeps
results, not questions. A widget's icon unfolds out of the cube's dot (after the
notification peek), then flies up into its card as the card rises in. The microphone
then unfolds in its bubble out of a dot, as the dictation screen's does.

The microphone's art is PebbleOS's `Pebble_80x80_Microphone.svg` (Apache-2.0, Google
LLC), copied to `resources/svg/`; the dock's is redrawn from it on the pixel grid by
`tools/build_assets.py` (DOCK_MIC). The thinking cube is drawn at the dock's size the way PebbleOS
draws its own icons (white body, uniform 2px black lines, round joins, every point on
a pixel centre, on the dock's white) by `tools/build_cube.py` from the Blender cube's geometry
(`tools/cube-geometry.json`); it needs shapely, so it is run by hand when the cube changes.
Its 81 frames ship as bitmaps of that drawing in Pebble's 64 colours
(`resources/images/thinking/`), drawn natively one at a time: as vector commands the
firmware strokes the 2px lines nearer 4px and fills the stickers in.

Widget cards have no header: the card is all information. Its frame stops short of the
bottom-left corner, leaving a cutout with no lines around it, where the widget's 36px icon
sits, rising well into the corner and hanging below the card. There is no other label.

The home screen (date, big clock, icon carousel, greeting) is no longer on the page.
The app's heap cannot hold it alongside the chat (see Memory). `home.js` and
`carousel.js` are kept, unused, so it can be restored.

## Select-driven playtest

```sh
INDEX_PLAYTEST=1 sh tools/build.sh
~/.local/share/uv/tools/pebble-tool/bin/python tools/emulator.py --state /tmp/index-emery
pebble install --phone localhost:54405 dist/index-alloy-playtest.pbw
```

Press Select, or tap the dock, to play the next request of the demo reel: a
simulated 1.8 s recording, then its transcription, thinking, and the result:

1. "Send a message to my wife. Roz just said there's a bike in the distance." Beeper card
2. "Remind me tomorrow at 4 pm to adjust the bike brakes." Reminder card
3. "Turn the living room lights off." Google Home card
4. "What do I have to do today?" To-dos and a timeline snapshot
5. "Does the GDPR say you have to delete every possible piece of personally
   identifiable information?" Web Answer card
6. "Where is Elizabeth?" Map with a pin and the address
7. "What's the weather this afternoon?" Weather card
8. "What's the Spanish word for afternoon?" Translation card

The next press loops back to the first. Presses while Index is busy are ignored.
Relaunching returns to the seeded history; no microphone is needed. The demo's
history, requests and results are in `src/embeddedjs/prompts.js`.

The emulator must boot the 4.33.1 SDK's firmware (older SDKs predate Alloy), which
`tools/emulator.py` does, on isolated ports so other emulators keep running.
`pebble install --emulator` is unreliable here. `tools/screen.sh` takes screenshots
and presses buttons through the QEMU monitor (base port + 3); `--headless` runs the
emulator without a window.

The build uses Index Alloy's UUID `f77fce2d-6016-47d5-84db-984335039681` and
`projectType: moddable`. It is not the sibling native Index package.

## Voice-input build

```sh
sh tools/build.sh
pebble install --phone <phone-ip> dist/index-alloy.pbw
```

The regular build keeps native dictation on Select: the system's dictation screen
records, and its words come in whole. Spoken requests close to the demo's pick the
same results (a message names its own recipient and words); anything else gets a
reply listing what to try. Nothing is really sent, set or switched. The build helper
stages to `/tmp/index-alloy` (set `INDEX_ALLOY_BUILD_DIR` to build elsewhere),
bundles the JavaScript modules into one (tools/bundle.py), shortens the bundle's names
with terser (see Memory; `npm install` in `tools/` fetches it once), and uses the
installed Pebble SDK's Moddable toolchain.

App timers use `src/embeddedjs/timers.js`, which starts one native clock after UI
setup. Keep new delays and animation timers on that scheduler: repeatedly adding
native timers inside callbacks can overflow the current Alloy host's event queue.
Animations paint on their existing frame tick.

## Memory

The app has a 120 KB heap, and the whole compiled mod is loaded into it, byte for byte.
Then XS's heaps grow into it as the code loads (a function object for every function,
a key for every distinct name) and as turns run, and never shrink; native art takes what
is left. Running out is fatal in one of two ways: XS aborts ("Alloy: Fatal Error, memory
full"), or a native allocation fails and the app faults (`App fault! PC: 0`, straight
back to the launcher). An empty mod leaves 104 KB free; the playtest now leaves about
37 KB at launch and 29.7 KB at its lowest over ten turns with scrolling, and the voice
build about 30 KB and 24.5 KB over ten questions (2026-10-27), measured on the emulator,
whose figures match the watch's exactly for the same build. Where the rest went, and
what keeps it:

- The mod is about 42 KB (the voice build's about 2 KB more). Every distinct identifier
  in it was a symbol in the archive and a 16-byte key in the heap, with its name, until
  the build began to shorten names: terser mangles the bundle's local names, and its
  property names too except those the host or the data can reach
  (`tools/terser-reserved.json`, every identifier in the host's own sources plus the
  widget names and the FFI table; regenerate it with `tools/reserved_names.py` when the
  SDK changes). The bundler passes exports by position for the same reason. That took the names from 669 symbols (20 KB of heap all
  told) to the 110 the host needs. `INDEX_MANGLE=1` keeps property names, `=0` all names,
  for readable bytecode when debugging.
- A constant kept as a name is a variable that every function using it captures, a 16-byte
  slot each. So the bundler gives importers the value of an export that is a number rather
  than passing it, and writes in the screen's size and the colours made from numbers
  (Emery is Index's only platform); terser then folds constants into the code that uses
  them, judging by the source's names before it shortens them (`tools/build.sh`).
- A function is an object made each time the code defining it runs. Terser would paste
  a function used once into the function calling it (`metric()` into the text drawing,
  `frameWait()` into each frame's), where it is made again on every call: garbage for
  every line of text drawn and every frame. `reduce_funcs: false` in `tools/terser.json`
  keeps such a function where it is defined. An ordinary `function` also gets a prototype
  object as it is made (48 bytes), which arrows and methods do not, so the modules use
  those; and `x | 0` truncates where `Math.trunc(x)` did, in less code, wherever the value
  is well inside 32 bits.
- Code a build does not use is removed by `tools/strip.py` (blocks between
  `// @strip NAME` and `// @endstrip`): the measuring code unless instrumented, its native
  half in `src/c` too, and from the playtest the dictation session, the spoken-request
  matching (`resolve`), the notice bubble and the page's hiding. The FFI table keeps only
  the native functions the bundle still names, and `assets.js` only the resource ids the
  modules name.
  `sh tools/xsb_sizes.sh` prints each module's bytecode size.
- Every live object, closure and table entry costs 16-byte slots; prefer code to
  data tables, keep per-entry properties few, and let go of what a turn made as soon
  as it lands. Caches of measured text are not worth it: a width per text per font held
  several KB that never came back.
- The history keeps 7 entries, each with only its wrapped lines.
- Art is looked up per draw (two images cached), so it is freed once off screen. The
  map is a vector image: a bitmap of it would take ~9 KB while shown. Alloy's bitmaps
  never free their native memory, so the bitmaps Index draws are drawn natively
  (`src/c/scroll.c`): the thinking cube's frames one at a time, and the weather card's
  icon loaded for each draw and freed straight after. Animation frames
  and clones are native memory XS cannot see, so they are collected every second or
  third frame: a collection costs 2 ms on the watch.
- Poco's own row and display-list buffers are unused on Pebble and kept to the least it
  accepts (theme.js).

Measuring: `INDEX_INSTRUMENT=xs sh tools/build.sh` adds XS's memory instrumentation
(free app heap, chunk, slot and stack use, once a second) to `pebble logs` without
changing the app; `=1` adds the per-turn frame profile as well. The instrumentation
lines only come if `pebble logs` was already connected when the app launched.
`INDEX_AUTOREEL=10` (with `INDEX_PLAYTEST=1`) plays ten turns by itself, an Up and a
Down step after each, for the emulator or a watch on the wrist. Before handing a build
over, run that whole reel on a fresh emulator and look for `memory full` in the log, an
`App fault`, or the launcher in the screenshots: the XS abort is not a fault.

## Frame rate

After each frame's render pass the firmware copies the app's frame buffer to its own and
sends it to the display. While the display is still busy with the frame before, the copy
waits, and on the watch copies come no faster than one every 35-40 ms (measured: the
scroll bench floods frames and logs the render passes' gaps). Alloy draws straight into
the buffer whenever its code runs, so a frame drawn before the last one's copy is copied
half done: a strip unpainted, an icon cleared, the thinking ring's black fill before its
white, seen as flicker. The firmware tells an app nothing when its copy happens, so
`src/c/scroll.c` works it out from the render passes (no sooner than the pass, nor than
40 ms after the copy before) and main.js starts a frame only once `frameWait()` says the
last one's copy is over. Animations step every 10 ms (motion.js) so a frame starts within
10 ms of that, with their latest state: about 25 frames a second. A frame must therefore
draw well inside 40 ms, so frames are kept small: a band while only the voice input
animates, and, when the page
scrolls, the rows already on the screen are moved natively (`src/c/scroll.c`, through
the FFI, which keeps the drawing context from the root layer's update proc) and only
what the scroll exposed is painted: a strip at the top or bottom, the position bar's
column and, on Up and Down, a 40px column band over each card's stretching icon (where
it was and where it is). Drawing an icon's vector art costs 3-5 ms on the watch, so as a
step starts each visible icon's pixels are copied off the screen, where it rests in its
white cutout, and each frame stretched into place by rows natively; text and art outside
the band being painted are skipped before the firmware is asked to lay them out. Poco's
`clip()` on Pebble restores, when popped, the rectangle it saved when pushed, and
`begin()` does not set that rectangle: push the whole screen first (see `scrollScreen`
in chat.js). `INDEX_SCROLLBENCH=1 sh tools/build.sh` makes the app scroll by itself after
launch and log each scroll's frames and where their time went; `=2` first times the
firmware's own drawing calls (tools/bench.c).
