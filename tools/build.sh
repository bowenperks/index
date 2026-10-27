#!/bin/sh
# Build Index (Alloy) into dist/index-alloy.pbw.
#
# The Pebble SDK build does not work on ExFAT volumes, so the project is mirrored to a
# local directory (INDEX_ALLOY_BUILD_DIR, default /tmp/index-alloy) and built there.
# Generated art and the resource table are refreshed first, and the JavaScript modules are
# bundled into one (tools/bundle.py).
#
# INDEX_AUTOPLAY='["weather", "alarm"]' builds dist/index-alloy-autoplay.pbw instead, which
# asks those questions by itself after launch (for the emulator, which has no microphone).
# INDEX_PLAYTEST=1 builds dist/index-alloy-playtest.pbw: Select advances one example at a time.
# INDEX_INSTRUMENT=1 adds XS memory instrumentation (slot, chunk and stack use, free app
# heap) and a per-turn frame profile to the build's log, readable with `pebble logs` while
# a log listener is connected.
# INDEX_INSTRUMENT=xs adds only XS's memory instrumentation, without the profile's code,
# so the figures are the plain build's. INDEX_AUTOREEL=N (with INDEX_PLAYTEST=1) plays N
# turns by itself, an Up and a Down step after each.
# INDEX_SCROLLBENCH=1 makes the app press Up and Down by itself after launch and log each
# scroll's frames, to measure scrolling on the watch; =2 first also times the firmware's
# drawing calls (tools/bench.c). It keeps the profile but not XS's instrumentation, which
# costs memory the bench does not have on the watch (add INDEX_INSTRUMENT=1 for both).
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD_DIR=${INDEX_ALLOY_BUILD_DIR:-/tmp/index-alloy}
if [ "${INDEX_PLAYTEST:-0}" = 1 ] && [ -n "${INDEX_AUTOPLAY:-}" ]; then
  echo "Choose INDEX_PLAYTEST or INDEX_AUTOPLAY, not both." >&2
  exit 2
fi

python3 "$ROOT/tools/build_assets.py"
mkdir -p "$BUILD_DIR"
rsync -a --delete --exclude build --exclude dist --exclude '.lock-waf*' --exclude '._*' \
  --exclude .DS_Store --exclude node_modules "$ROOT/" "$BUILD_DIR/"
OUTPUT=index-alloy.pbw
if [ "${INDEX_INSTRUMENT:-0}" = 1 ] || [ "${INDEX_INSTRUMENT:-0}" = xs ]; then
  sed -i '' 's/^    \.fxBuildFFI = fxBuildFFI,$/    .flags = kModdableCreationFlagLogInstrumentation, .fxBuildFFI = fxBuildFFI,/' \
    "$BUILD_DIR/src/c/mdbl.c"
  grep -q kModdableCreationFlagLogInstrumentation "$BUILD_DIR/src/c/mdbl.c" || { echo "INSTRUMENT not applied" >&2; exit 1; }
fi
if [ "${INDEX_INSTRUMENT:-0}" = 1 ] || [ "${INDEX_SCROLLBENCH:-0}" != 0 ]; then
  sed -i '' 's/^const PROFILE = false;$/const PROFILE = true;/' "$BUILD_DIR/src/embeddedjs/main.js"
  grep -q "^const PROFILE = true;" "$BUILD_DIR/src/embeddedjs/main.js" || { echo "PROFILE not applied" >&2; exit 1; }
  if [ "${INDEX_SCROLLBENCH:-0}" != 0 ]; then
    sed -i '' 's/^const SCROLL_BENCH = false;$/const SCROLL_BENCH = true;/' "$BUILD_DIR/src/embeddedjs/main.js"
    grep -q "^const SCROLL_BENCH = true;" "$BUILD_DIR/src/embeddedjs/main.js" || { echo "SCROLL_BENCH not applied" >&2; exit 1; }
  fi
  if [ "${INDEX_SCROLLBENCH:-0}" = 2 ]; then
    # The drawing micro-benchmark is C (no JavaScript memory) and only in this build.
    cp "$ROOT/tools/bench.c" "$BUILD_DIR/src/c/bench.c"
    python3 - "$BUILD_DIR/src/embeddedjs/manifest.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
manifest["ffi"]["sources"].append("./bench.c")
manifest["ffi"]["functions"]["benchDraw"] = {"arguments": ["int32_t"] * 4, "returns": "void"}
json.dump(manifest, open(sys.argv[1], "w"), indent="\t")
PY
  fi
fi
if [ "${INDEX_PLAYTEST:-0}" = 1 ]; then
  python3 - "$BUILD_DIR/src/embeddedjs/main.js" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
source = path.read_text()
marker = 'const PLAYTEST = false;'
assert source.count(marker) == 1, 'Playtest build marker missing or ambiguous'
path.write_text(source.replace(marker, 'const PLAYTEST = true;'))
PY
  OUTPUT=index-alloy-playtest.pbw
fi
if [ -n "${INDEX_AUTOPLAY:-}" ]; then
  sed -i '' "s#^const AUTOPLAY = \[\];#const AUTOPLAY = $INDEX_AUTOPLAY;#" "$BUILD_DIR/src/embeddedjs/main.js"
  grep -q "^const AUTOPLAY = \[\];" "$BUILD_DIR/src/embeddedjs/main.js" && { echo "AUTOPLAY not applied" >&2; exit 1; }
  OUTPUT=index-alloy-autoplay.pbw
fi
# Code this build does not use is removed before bundling (see tools/strip.py): the
# measuring code unless instrumented, its native half in src/c too, the dictation code
# from the playtest.
STRIP=""
[ "${INDEX_INSTRUMENT:-0}" = 1 ] || [ "${INDEX_SCROLLBENCH:-0}" != 0 ] || STRIP="$STRIP profile"
[ "${INDEX_PLAYTEST:-0}" = 1 ] && STRIP="$STRIP dictation"
if [ -n "${INDEX_AUTOREEL:-}" ]; then
  sed -i '' "s/^const AUTOREEL = 0;$/const AUTOREEL = $INDEX_AUTOREEL;/" "$BUILD_DIR/src/embeddedjs/main.js"
  grep -q "^const AUTOREEL = $INDEX_AUTOREEL;" "$BUILD_DIR/src/embeddedjs/main.js" || { echo "AUTOREEL not applied" >&2; exit 1; }
else
  STRIP="$STRIP autoreel"
fi
python3 "$ROOT/tools/strip.py" "$BUILD_DIR/src/embeddedjs" $STRIP
python3 "$ROOT/tools/strip.py" "$BUILD_DIR/src/c" $STRIP
# One module on the watch (see tools/bundle.py); the source stays modular.
python3 "$ROOT/tools/bundle.py" "$BUILD_DIR/src/embeddedjs" "$BUILD_DIR/main.bundle.js"
mv "$BUILD_DIR/main.bundle.js" "$BUILD_DIR/src/embeddedjs/main.js"
# The manifest lists that one module, and of the native functions only those it still
# names: an entry in the FFI table takes the app's heap for its glue code, a host function
# and a key, so the profile's (renderLog and the rest) go with the code that calls them.
python3 - "$BUILD_DIR/src/embeddedjs/manifest.json" "$BUILD_DIR/src/embeddedjs/main.js" <<'PY'
import json, re, sys
manifest = json.load(open(sys.argv[1]))
manifest["modules"] = {"*": ["./main"]}
named = set(re.findall(r"[A-Za-z_$][\w$]*", open(sys.argv[2]).read()))
functions = manifest["ffi"]["functions"]
manifest["ffi"]["functions"] = {name: functions[name] for name in functions if name in named}
json.dump(manifest, open(sys.argv[1], "w"), indent="\t")
PY
# The bundle's local names are shortened and its literal constants folded in (terser,
# tools/terser.json; `npm install` in tools/ fetches it). On the watch every distinct name
# is a symbol in the mod and a key in the heap, and every module constant a closure slot:
# together a fifth of the app's memory. Property names are never touched: the host reads
# them. INDEX_MANGLE=0 skips this, for readable bytecode when debugging.
if [ "${INDEX_MANGLE:-1}" != 0 ]; then
  TERSER="$ROOT/tools/node_modules/.bin/terser"
  [ -x "$TERSER" ] || { echo "terser missing: run npm install in tools/" >&2; exit 1; }
  # Index's own property names (a card's `lines`, Chat's methods) are shortened as well,
  # all but the names the host or the data could reach: tools/terser-reserved.json, made by
  # tools/reserved_names.py from the host's sources. INDEX_MANGLE=1 keeps property names.
  # Terser writes a constant's value in where it is used only if that makes the text no
  # longer than the name (plus its share of the declaration), and when it is also to mangle
  # it counts every name it will shorten as one character, so it keeps any number of more
  # than a digit or two as a variable, which every function using it captures: heap on the
  # watch, where the number would cost a few bytes of code. It therefore folds the constants
  # in a run without mangling, judging by the source's names, and shortens the names in a
  # second run. The first leaves quoted property names quoted, as the second keeps those
  # (keep_quoted).
  python3 - "$ROOT/tools/terser.json" "$ROOT/tools/terser-reserved.json" "${INDEX_MANGLE:-2}" \
    "$BUILD_DIR" <<'PY'
import json, sys
config = json.load(open(sys.argv[1]))
if sys.argv[3] == "2":
    config["mangle"]["properties"] = {"regex": "^[A-Za-z_][A-Za-z0-9_]{3,}$", "keep_quoted": True,
                                      "reserved": json.load(open(sys.argv[2]))}
json.dump({**config, "mangle": False, "compress": {**config["compress"], "properties": False},
           "format": {**config["format"], "keep_quoted_props": True}},
          open(sys.argv[4] + "/terser-compress.json", "w"))
json.dump({**config, "compress": False}, open(sys.argv[4] + "/terser-mangle.json", "w"))
PY
  for STEP in compress mangle; do
    "$TERSER" "$BUILD_DIR/src/embeddedjs/main.js" --config-file "$BUILD_DIR/terser-$STEP.json" \
      -o "$BUILD_DIR/src/embeddedjs/main.js"
  done
fi
(cd "$BUILD_DIR" && pebble build)
mkdir -p "$ROOT/dist"
cp "$BUILD_DIR/build/$(basename "$BUILD_DIR").pbw" "$ROOT/dist/$OUTPUT"
echo "dist/$OUTPUT"
