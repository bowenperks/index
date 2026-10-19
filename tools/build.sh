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
# heap) to the build's log, readable with `pebble logs` while a log listener is connected.
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
  --exclude .DS_Store "$ROOT/" "$BUILD_DIR/"
OUTPUT=index-alloy.pbw
if [ "${INDEX_INSTRUMENT:-0}" = 1 ]; then
  sed -i '' 's/^    \.fxBuildFFI = fxBuildFFI,$/    .flags = kModdableCreationFlagLogInstrumentation, .fxBuildFFI = fxBuildFFI,/' \
    "$BUILD_DIR/src/c/mdbl.c"
  grep -q kModdableCreationFlagLogInstrumentation "$BUILD_DIR/src/c/mdbl.c" || { echo "INSTRUMENT not applied" >&2; exit 1; }
  sed -i '' 's/^const PROFILE = false;$/const PROFILE = true;/' "$BUILD_DIR/src/embeddedjs/main.js"
  grep -q "^const PROFILE = true;" "$BUILD_DIR/src/embeddedjs/main.js" || { echo "PROFILE not applied" >&2; exit 1; }
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
# measuring code unless instrumented, the dictation code from the playtest.
STRIP=""
[ "${INDEX_INSTRUMENT:-0}" = 1 ] || STRIP="$STRIP profile"
[ "${INDEX_PLAYTEST:-0}" = 1 ] && STRIP="$STRIP dictation"
python3 "$ROOT/tools/strip.py" "$BUILD_DIR/src/embeddedjs" $STRIP
# One module on the watch (see tools/bundle.py); the source stays modular.
python3 "$ROOT/tools/bundle.py" "$BUILD_DIR/src/embeddedjs" "$BUILD_DIR/main.bundle.js"
mv "$BUILD_DIR/main.bundle.js" "$BUILD_DIR/src/embeddedjs/main.js"
python3 - "$BUILD_DIR/src/embeddedjs/manifest.json" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
manifest["modules"] = {"*": ["./main"]}
json.dump(manifest, open(sys.argv[1], "w"), indent="\t")
PY
(cd "$BUILD_DIR" && pebble build)
mkdir -p "$ROOT/dist"
cp "$BUILD_DIR/build/$(basename "$BUILD_DIR").pbw" "$ROOT/dist/$OUTPUT"
echo "dist/$OUTPUT"
