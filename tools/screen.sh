#!/bin/sh
# Drive an Index emulator through its QEMU monitor (tools/emulator.py's base port + 3).
#
#   sh tools/screen.sh PORT shot OUT.png     save the screen as a PNG
#   sh tools/screen.sh PORT key KEY          press a button: up, down, right (Select), left (Back)
#   sh tools/screen.sh PORT burst PREFIX N S take N shots S seconds apart: PREFIX-1.png ...
set -eu
PORT=$1
ACTION=$2
case "$ACTION" in
  shot)
    OUT=$3
    printf 'screendump %s.ppm\n' "$OUT" | nc -w 2 localhost "$PORT" > /dev/null
    sips -s format png "$OUT.ppm" --out "$OUT" > /dev/null
    rm -f "$OUT.ppm"
    ;;
  key)
    printf 'sendkey %s\n' "$3" | nc -w 1 localhost "$PORT" > /dev/null
    ;;
  burst)
    index=1
    while [ "$index" -le "$4" ]; do
      sleep "$5"
      sh "$0" "$PORT" shot "$3-$index.png"
      index=$((index + 1))
    done
    ;;
  *)
    echo "usage: screen.sh PORT shot OUT.png | key KEY" >&2
    exit 2
    ;;
esac
