# Index Alloy

Index Alloy is a UI demo of a voice assistant for Pebble Time 2 (Emery), written in Alloy
(Moddable XS JavaScript and Poco). You ask by voice, Index answers with a widget card in a
chat-style history, and it asks for a yes or no before any action that cannot be undone.
All results are hardcoded: nothing is really sent, set or switched.

## How it works

- **Ask:** Select, or a tap on the dock, opens the microphone's bubble into a live waveform.
  The words then lift into the page as your message.
- **Think:** a cube turns in the dock.
- **Answer:** the widget's icon unfolds and flies into its card: message, reminder, smart
  home, to-dos, web answer, map, weather or translation. Up and Down snap between cards, as
  Timeline does.
- **Confirm:** before an irreversible action, Index asks in the conversation, an orange dot
  on its question until you answer. The answers sit at the bottom of the screen as two pills
  to tap, with PebbleOS's own tick and cross; Select opens them in a window that slides in
  with PebbleOS's window push instead. Back is No. A No is not a reply but a centred
  "Request denied" across the conversation.

## Build and run

Needs the Pebble SDK 4.33.1 (older SDKs predate Alloy) and terser (`npm install` in `tools/`).

Playtest, where Select plays the demo's ten requests and no microphone is needed:

```sh
INDEX_PLAYTEST=1 sh tools/build.sh
~/.local/share/uv/tools/pebble-tool/bin/python tools/emulator.py --state /tmp/index-emery
pebble install --phone localhost:54405 dist/index-alloy-playtest.pbw
```

Voice build, with dictation on Select, for the watch:

```sh
sh tools/build.sh
pebble install --phone <phone-ip> dist/index-alloy.pbw
```

`tools/build.sh` stages the project to `/tmp` (the SDK build fails on exFAT), bundles the
modules into one and shortens their names with terser. Optional flags:
`INDEX_INSTRUMENT=xs` logs heap use to `pebble logs`, `INDEX_AUTOREEL=10` plays ten turns
by itself, and `INDEX_SCROLLBENCH=1` times scrolling on the watch.

## Code

| Path | What it is |
| --- | --- |
| `src/embeddedjs/chat.js` | The page: history, dock, scrolling and each turn |
| `src/embeddedjs/confirm.js` | The confirmation window, a reusable widget |
| `src/embeddedjs/cards.js`, `weather.js` | Widget card bodies |
| `src/embeddedjs/thinking.js`, `transition.js`, `mic.js` | Cube, icon unfold and flight, microphone and waveform |
| `src/embeddedjs/motion.js`, `timers.js` | Pebble's animation curves, and the app's single timer |
| `src/embeddedjs/prompts.js` | The demo's requests and results |
| `src/c/scroll.c` | Native frame-buffer helpers: row and column shifts, icon and bitmap drawing |
| `tools/` | Build, bundler, asset and cube generators, emulator |

`home.js` and `carousel.js` are the former home screen, kept but unused.

## Confirming an action

Give a result a `confirm`, the question and Index's reply to a No, in `prompts.js`:

```js
["Unlock the front door.", "home", "Unlocked the front door",
 ["Unlock the front door?", "The front door stays locked"]],
```

To reuse `confirm.js` on another Alloy page, see its header comment. It needs `theme.js`,
`motion.js` and `timers.js`, plus `shiftColumns` and `iconDraw` from `scroll.c` in the
manifest's FFI table.

## Memory and frame rate

- The app heap is 120 KB and the whole mod loads into it. The playtest leaves about 28 KB
  free at launch and 19 KB at its lowest over ten turns. Every function and property name
  costs heap, so the build mangles names and folds constants. Art is drawn natively and
  freed after each draw, because Alloy's bitmaps never free their memory.
- Frames are paced to the display's copy, about 40 ms on the watch. Scrolling shifts rows
  natively and paints only what was exposed.
- Before installing on a watch, run the instrumented ten-turn reel on a fresh emulator and
  check the log for `memory full` or `App fault`.

The microphone is drawn from PebbleOS's `Pebble_80x80_Microphone.svg`, and the tick and cross
are PebbleOS's action bar icons, `action_bar_icon_check.png` and `action_bar_icon_x.png`,
unchanged (Apache-2.0, Google LLC). App UUID: `f77fce2d-6016-47d5-84db-984335039681`.
