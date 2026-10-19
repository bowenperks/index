# Index — Alloy

This is the active Index implementation. Build the app in Alloy: the conversation,
widgets, animation and playtest logic run in `src/embeddedjs/` using Moddable XS
and Poco. The small C entry point starts the Alloy runtime and exposes text size.
The sibling `../index` folder is the older native C implementation.

## What it looks like

Index opens like a messaging app, on its history of results: newest at the bottom,
a slim time bar on top, day labels ("Yesterday", "Today") between days, and the
voice input at the very end: Pebble's own microphone, the one the system dictation
screen shows, at its own 80px. Up/Down or a touch drag scroll the history. The last line
of each of Index's messages is centred in its bubble.

Asking pushes things in from the bottom. The recording's waveform runs in the user's
blue bubble, then the whole transcribed message comes in at once. While Index thinks,
the microphone shrinks to a dot as it slides to the bottom left, and the dot grows into
the thinking cube, like a messaging app's avatar, with Index's typing bubble ("•••",
the dots darkening in turn) beside it: the cube's height, filling the row, drawn like the
cube with 2px black lines. When the result comes in, it takes the words' place: the
history keeps results, not questions. A widget's icon unfolds out of the cube's dot
(after the notification peek), then flies into its card as the card rises in. The
microphone then unfolds out of a dot at the centre, as the dictation screen's does.

The microphone's art is PebbleOS's `Pebble_80x80_Microphone.svg` (Apache-2.0, Google
LLC), copied to `resources/svg/` and converted to a PDC by `tools/build_assets.py`.

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

Press Select, or tap the microphone, to play the next request of the demo reel: a
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
back to the launcher). An empty mod leaves 104 KB free; Index now leaves about 35 KB at
launch and 22 KB after ten turns with scrolling, measured on the emulator, whose figures
match the watch's exactly for the same build. Where the rest went, and what keeps it:

- The mod is 41 KB, 34 of it bytecode. Every distinct identifier in it was a symbol in
  the archive and a 16-byte key in the heap, with its name, until the build began to
  shorten names: terser mangles the bundle's local names, and its property names too
  except those the host or the data can reach (`tools/terser-reserved.json`, every
  identifier in the host's own sources plus the widget names and the FFI table; regenerate
  it with `tools/reserved_names.py` when the SDK changes). The bundler passes exports by
  position for the same reason. That took the names from 669 symbols (20 KB of heap all
  told) to the 110 the host needs. `INDEX_MANGLE=1` keeps property names, `=0` all names,
  for readable bytecode when debugging.
- Code a build does not use is removed by `tools/strip.py` (blocks between
  `// @strip NAME` and `// @endstrip`): the measuring code unless instrumented, and from
  the playtest the dictation session, the spoken-request matching (`resolve`), the notice
  bubble and the page's hiding. `assets.js` lists only the resource ids the modules name.
  `sh tools/xsb_sizes.sh` prints each module's bytecode size.
- Every live object, closure and table entry costs 16-byte slots; prefer code to
  data tables, keep per-entry properties few, and let go of what a turn made as soon
  as it lands. Caches of measured text are not worth it: a width per text per font held
  several KB that never came back.
- The history keeps 7 entries, each with only its wrapped lines.
- Art is looked up per draw (two images cached), so it is freed once off screen. The
  map is a vector image: a bitmap of it would take ~9 KB while shown. Animation frames
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

After each frame the firmware copies the app's frame buffer to its own and sends it to
the display, which takes under 20 ms on the watch. While the display is still busy with
the frame before, the copy waits for it, and a frame drawn into the buffer meanwhile
reaches the display half done: a white flash, icons gone for a moment. So a frame starts
no sooner than 28 ms after the last one started and 6 ms after it ended
(`FRAME_PERIOD_MS` and `FRAME_SETTLE_MS` in main.js): every 33 ms tick, 30 a second,
as long as each frame draws within its tick. A frame that takes longer skips a tick, so
frames are kept small: a band while only the voice input animates, and, when the page
scrolls, the rows already on the screen are moved natively (`src/c/scroll.c`, through
the FFI, which keeps the drawing context from the root layer's update proc) and only
what the scroll exposed is painted: a strip at the top or bottom, the position bar's
column and, on Up and Down, each card's stretching icon. Poco's `clip()` on Pebble
restores, when popped, the rectangle it saved when pushed, and `begin()` does not set
that rectangle: push the whole screen first (see `scrollScreen` in chat.js).
