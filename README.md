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
bundles the JavaScript modules to limit startup memory, and uses the installed
Pebble SDK's Moddable toolchain.

App timers use `src/embeddedjs/timers.js`, which starts one native clock after UI
setup. Keep new delays and animation timers on that scheduler: repeatedly adding
native timers inside callbacks can overflow the current Alloy host's event queue.
Animations paint on their existing frame tick.

## Memory

The app has a 122 KB heap, and it is full. The whole compiled mod is loaded into it
(about 49 KB), XS's heaps grow into most of the rest (about 50 KB of slots, mostly the
function objects of all the code, and 17 KB of chunks) and never shrink, and native
art takes what is left: a few KB. Running out does not raise an error: a native
allocation fails and the app faults (`App fault! PC: 0`). To stay inside:

- Code size is RAM twice over: in the mod, and as the function objects XS makes for
  it. `sh tools/xsb_sizes.sh` prints each module's bytecode size. Code a build does
  not use is removed by `tools/strip.py` (blocks between `// @strip NAME` and
  `// @endstrip`): the measuring code unless instrumented, dictation from the playtest.
- Every live object, closure and table entry costs 16-byte slots; prefer code to
  data tables, keep per-entry properties few, and let go of what a turn made as soon
  as it lands.
- The history keeps 7 entries, each with only its wrapped lines. Text caches are
  small and never hold word-wrap candidates.
- Art is looked up per draw (two images cached), so it is freed once off screen. The
  map is a vector image: a bitmap of it would take ~9 KB while shown. Animation frames
  and clones are native memory XS cannot see, so they are collected every second or
  third frame: a collection costs 2 ms on the watch.
- The voice build also holds a dictation session and has the least room (~8 KB free
  at rest); test the whole reel on it too.

`INDEX_INSTRUMENT=1 sh tools/build.sh` adds XS's memory instrumentation (free app
heap, chunk, slot and stack use, once a second) to `pebble logs`, and a per-turn frame
profile. Before handing a build over, run the whole reel (ten Select presses through
`tools/screen.sh`) on a fresh emulator and watch for faults.

## Frame rate

The firmware flushes the whole screen to the display for every frame, whatever the
app changed, which takes about 40 ms on the watch: no Alloy animation can exceed
roughly 15-20 frames a second there, however little it draws. Frames are therefore
paced at a steady two ticks (15 a second, `FRAME_GAP_MS` in main.js); an uneven one
or two ticks reads as stutter. Partial repaints still matter: they cut the app's own
drawing from ~25 ms to under 10.
