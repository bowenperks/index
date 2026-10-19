#!/usr/bin/env python3
"""Show a rendered icon at several pixel sizes side by side (each enlarged 4x with hard
pixels), for judging how art holds up when shrunk for the watch.

    python tools/preview_sizes.py ICON.png OUT.png 80 36 26

Needs Pillow (the pebble-tool Python has it).
"""
import sys
from PIL import Image

source = Image.open(sys.argv[1]).convert('RGBA')
white = Image.new('RGBA', source.size, (255, 255, 255, 255))
source = Image.alpha_composite(white, source).convert('L')
sizes = [int(size) for size in sys.argv[3:]]
tiles = [source.resize((size, size), Image.LANCZOS).resize((size * 4, size * 4), Image.NEAREST)
         for size in sizes]
sheet = Image.new('L', (sum(tile.width for tile in tiles) + 16 * (len(tiles) - 1),
                        max(tile.height for tile in tiles)), 200)
left = 0
for tile in tiles:
    sheet.paste(tile, (left, 0))
    left += tile.width + 16
sheet.save(sys.argv[2])
