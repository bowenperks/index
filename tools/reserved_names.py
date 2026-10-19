#!/usr/bin/env python3
"""Write tools/terser-reserved.json: the property names terser must not shorten when it
mangles the bundle's properties (tools/build.sh).

A property name the Alloy host reads or writes (Poco's methods, a Button's options, a
sample's x and y) has to survive, and so must a name Index looks up from data (a widget's
name in a result, a card's body). Rather than guess, every identifier in the host's own
JavaScript (the Pebble modules of the installed SDK's Moddable toolchain) is reserved,
with the data-driven names and the FFI functions listed here. JavaScript's built-ins
terser protects on its own.

    python3 tools/reserved_names.py [SDK_MODDABLE_DIR]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODDABLE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / (
    "Library/Application Support/Pebble SDK/SDKs/4.33.1/toolchain/moddable")
HOST = [MODDABLE / "build/devices/pebble", MODDABLE / "modules/commodetto/commodettoPoco.js",
        MODDABLE / "modules/commodetto/commodettoPocoCore.js", MODDABLE / "modules/commodetto/commodettoBitmap.js",
        MODDABLE / "modules/base"]

# Names Index reaches through data: the widgets' names (results carry them as strings and
# WIDGETS / CARDS are indexed by them), and the native functions in the FFI table.
DATA = ["beeper", "reminder", "home", "today", "web", "map", "weather", "translate"]
manifest = json.loads((ROOT / "src/embeddedjs/manifest.json").read_text())
DATA += list(manifest["ffi"]["functions"])

names = set(DATA)
for place in HOST:
    # The host's C files too: a property a native getter defines (a Font's ascent) appears
    # only there. Every identifier in them is reserved, which is more than needed and safe.
    files = [p for p in place.rglob("*") if p.suffix in (".js", ".c", ".h")] if place.is_dir() else [place]
    for path in files:
        if path.name.startswith("."):
            continue
        try:
            text = path.read_text()
        except UnicodeDecodeError:
            continue
        names.update(re.findall(r"[A-Za-z_$][\w$]*", text))
        # In C a property name is an xsID_ identifier: a Dictation's `confirm` option.
        names.update(re.findall(r"xsID_(\w+)", text))
reserved = sorted(n for n in names if len(n) > 1)
(ROOT / "tools/terser-reserved.json").write_text(json.dumps(reserved, indent=0) + "\n")
print(len(reserved), "reserved names")
