#!/bin/sh
# Print each JavaScript module's compiled (XS bytecode) size, largest first.
#
# On the watch the whole mod archive is loaded into the app's 122 KB heap, so bytecode
# size is RAM: use this to see where it goes.
#
#   sh tools/xsb_sizes.sh [PROJECT_DIR]
set -eu
ROOT=${1:-$(cd "$(dirname "$0")/.." && pwd)}
XSC="$HOME/Library/Application Support/Pebble SDK/SDKs/4.33.1/toolchain/moddable-tools/xsc"
OUT=$(mktemp -d)
for source in "$ROOT"/src/embeddedjs/*.js; do
  name=$(basename "$source" .js)
  "$XSC" "$source" -e -o "$OUT" -r "$name" > /dev/null
done
ls -l "$OUT" | awk 'NR > 1 { print $5, $9; total += $5 } END { print total, "total" }' | sort -rn
rm -rf "$OUT"
