# Index — Alloy

This is the active Index implementation. Build the app in Alloy: the conversation,
widgets, animation and playtest logic run in `src/embeddedjs/` using Moddable XS
and Poco. The small C entry point starts the Alloy runtime and exposes text size.
The sibling `../index` folder is the older native C implementation.

## What it looks like

Index opens like a messaging app, on its history of results: newest at the bottom,
a slim time bar on top, day labels ("Yesterday", "Today") between days, and the
voice input at the very end, a microphone in the thinking ring that sends out a slow
ping. Up/Down or a touch drag scroll the history.

Asking pushes things in from the bottom. The recording's waveform runs in the
user's blue bubble, then the whole transcribed message comes in at once. While Index thinks,
the microphone's ring slides to the bottom left and turns into the thinking cube, like a
messaging app's avatar, with Index's typing bubble ("•••", the dots darkening in turn)
beside it: the cube's height, filling the row, drawn like the cube with 2px black lines. When the result comes in, it takes the words' place: the history keeps
results, not questions. A widget's icon unfolds out of the cube's dot (after the
notification peek), then flies into its card's header as the card rises in. The ring
then grows back at the centre.

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

The app has a 122 KB heap, and it is nearly full. The whole compiled mod is loaded
into it (about 48 KB), XS's heaps grow into most of the rest (about 48 KB of slots and
17 KB of chunks) and never shrink, and native art takes what is left. Running the
whole demo reel leaves about 11 KB free. To keep it that way:

- Code size is RAM. `sh tools/xsb_sizes.sh` prints each module's bytecode size.
- Every live object, closure and table entry costs 16-byte slots; prefer code to
  data tables and keep per-entry properties few.
- The history keeps 10 entries, each with only its wrapped lines. Text caches are
  small and never hold word-wrap candidates.
- Art is looked up per draw, never held, so it is freed once off screen. The map is
  a vector image: a bitmap of it would take ~9 KB while shown.

`INDEX_INSTRUMENT=1 sh tools/build.sh` adds XS's memory instrumentation (free app
heap, chunk, slot and stack use, once a second) to `pebble logs`.
