#!/usr/bin/env python3
"""Crop a region of a screenshot and enlarge it with hard pixels, with a faint grid line
every 10px, for judging alignment by eye.

    python tools/zoom.py SHOT.png OUT.png X0 Y0 X1 Y1 [SCALE]

Needs Pillow (the pebble-tool Python has it).
"""
import sys
from PIL import Image, ImageDraw

path, out = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = (int(value) for value in sys.argv[3:7])
scale = int(sys.argv[7]) if len(sys.argv) > 7 else 4
crop = Image.open(path).convert('RGB').crop((x0, y0, x1, y1))
big = crop.resize((crop.width * scale, crop.height * scale), Image.NEAREST)
draw = ImageDraw.Draw(big)
for y in range(y0 - y0 % 10 + 10, y1, 10):
    draw.line([(0, (y - y0) * scale), (big.width, (y - y0) * scale)], fill=(255, 0, 0), width=1)
big.save(out)
