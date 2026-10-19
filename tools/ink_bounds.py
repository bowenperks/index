#!/usr/bin/env python3
"""Print the bounds of the dark ink inside a region of a screenshot, for checking that drawn
shapes line up.

    python tools/ink_bounds.py SHOT.png X0 Y0 X1 Y1

QEMU screendumps vary in brightness, so "dark" is relative to the region's own range.
Needs Pillow (the pebble-tool Python has it).
"""
import sys
from PIL import Image

path = sys.argv[1]
x0, y0, x1, y1 = (int(value) for value in sys.argv[2:6])
image = Image.open(path).convert('L')
values = [image.getpixel((x, y)) for y in range(y0, y1) for x in range(x0, x1)]
threshold = min(values) + (max(values) - min(values)) // 3
ink = [(x, y) for y in range(y0, y1) for x in range(x0, x1) if image.getpixel((x, y)) <= threshold]
xs, ys = [x for x, _ in ink], [y for _, y in ink]
print(f'x {min(xs)}..{max(xs)}, y {min(ys)}..{max(ys)} ({max(ys) - min(ys) + 1}px tall)')
