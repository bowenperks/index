#!/usr/bin/env python3
"""Tile emulator screenshots side by side into one image, at 2x, for reviewing a sequence.

    python tools/contact_sheet.py OUT.png SHOT.png [SHOT.png ...]

Needs Pillow (the pebble-tool Python has it).
"""
import sys
from PIL import Image

out, paths = sys.argv[1], sys.argv[2:]
shots = [Image.open(path).convert('RGB') for path in paths]
width, height = shots[0].size
gap = 8
sheet = Image.new('RGB', (len(shots) * (width + gap) - gap, height), (200, 200, 200))
for index, shot in enumerate(shots):
    sheet.paste(shot, (index * (width + gap), 0))
sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
sheet.save(out)
