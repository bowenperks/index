#!/usr/bin/env python3
"""Remove marked blocks from the staged JavaScript and C before they are built.

A block is the lines between `// @strip NAME` and `// @endstrip`, inclusive. Every name
given on the command line is removed from all modules and C files in the directory:

    python3 tools/strip.py BUILD_DIR/src/embeddedjs profile dictation
    python3 tools/strip.py BUILD_DIR/src/c profile

Code the app carries but a build does not use still costs memory on the watch: the
bundle lives in the app's heap, and each function in it is also an object in the
JavaScript heap; the app's native code is loaded alongside that heap, in the same
memory. The measuring code (profile) is only for instrumented builds, and the
Select-driven playtest never dictates.
"""
from pathlib import Path
import re
import sys

directory, names = Path(sys.argv[1]), set(sys.argv[2:])
for path in sorted([*directory.glob("*.js"), *directory.glob("*.c")]):
    lines, kept, dropping, removed = path.read_text().split("\n"), [], None, 0
    for line in lines:
        start = re.match(r"\s*// @strip (\w+)\s*$", line)
        if dropping is None and start and start.group(1) in names:
            dropping = start.group(1)
            continue
        if dropping is not None:
            removed += 1
            if re.match(r"\s*// @endstrip\s*$", line):
                dropping = None
            continue
        kept.append(line)
    if dropping is not None:
        sys.exit(f"{path}: unterminated @strip {dropping}")
    if removed:
        path.write_text("\n".join(kept))
        print(f"stripped {removed} lines from {path.name}")
