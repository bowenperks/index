# Index — Alloy

This is the active Index implementation. Build the app in Alloy: the conversation,
widgets, animation and playtest logic run in `src/embeddedjs/` using Moddable XS
and Poco. The small C entry point starts the Alloy runtime and exposes text size.
The sibling `../index` folder is the older native C implementation.

## Select-driven playtest

```sh
INDEX_PLAYTEST=1 sh tools/build.sh
pebble install --emulator emery dist/index-alloy-playtest.pbw
```

Press Select to submit the next example and play its thinking and reply animations:
weather, alarm, beeper, timer, reminder, new note, use a tool, add to note, then help.
The next press loops back to weather. Extra presses during thinking, transitions
or answer reveals are ignored without skipping examples. Up/Down and touch still
scroll the conversation. Relaunching returns to the start; no microphone is needed.

The build uses Index Alloy's UUID `f77fce2d-6016-47d5-84db-984335039681` and
`projectType: moddable`. It is not the sibling native Index package.

## Voice-input build

```sh
sh tools/build.sh
pebble install --phone <phone-ip> dist/index-alloy.pbw
```

The regular build keeps native dictation on Select. Both builds use the same Alloy
UI and local canned replies. No real reminders, alarms or messages are scheduled.
The build helper stages to `/tmp/index-alloy`, bundles the JavaScript modules to
limit startup memory, and uses the installed Pebble SDK's Moddable toolchain.

App timers use `src/embeddedjs/timers.js`, which starts one native clock after UI
setup. Keep new delays and animation timers on that scheduler: repeatedly adding
native timers inside callbacks can overflow the current Alloy host's event queue.
Animations paint on their existing frame tick. Conversation history is limited to
12 turns, with bounded text caches and native animation frames released before
their replacements are loaded.
