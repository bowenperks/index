#!/usr/bin/env python3
"""Print the draw commands of PDC images and sequences (first frame), for checking art.

    python3 tools/pdc_dump.py resources/pdc/index-widget-beeper.pdc
    python3 tools/pdc_dump.py --bbox resources/pdc/thinking/*.pdc

--bbox prints only the union of the files' point bounds (stroke widths not included),
for placing art by its ink rather than its canvas.
"""
import struct
import sys


def commands(path):
    data = open(path, 'rb').read()
    magic, at = data[:4], 8
    _, _, width, height = struct.unpack('<BBhh', data[at:at + 6])
    at += 6
    if magic == b'PDCS':
        _, frames = struct.unpack('<HH', data[at:at + 4])
        at += 6   # play count, frame count, then the first frame's duration
        header = f'{path}: sequence {width}x{height}, {frames} frames (first shown)'
    else:
        header = f'{path}: image {width}x{height}'
    count = struct.unpack('<H', data[at:at + 2])[0]
    at += 2
    found = []
    for _ in range(count):
        kind, hidden, stroke, stroke_width, fill, extra, points = struct.unpack('<5B2H', data[at:at + 9])
        at += 9
        coords = []
        for _ in range(points):
            x, y = struct.unpack('<2h', data[at:at + 4])
            at += 4
            coords.append((x / 8, y / 8) if kind == 3 else (x, y))
        found.append((kind, hidden, stroke, stroke_width, fill, extra, coords))
    return header, (width, height), found


if sys.argv[1] == '--bbox':
    xs, ys = [], []
    for name in sys.argv[2:]:
        _, size, found = commands(name)
        for *_, coords in found:
            xs += [x for x, _ in coords]
            ys += [y for _, y in coords]
    print(f'canvas {size[0]}x{size[1]}: x {min(xs)}..{max(xs)}, y {min(ys)}..{max(ys)}')
else:
    for name in sys.argv[1:]:
        header, _, found = commands(name)
        print(header)
        for kind, hidden, stroke, stroke_width, fill, extra, coords in found:
            print(f'  kind {kind} stroke {stroke:#04x} width {stroke_width} fill {fill:#04x} '
                  f'extra {extra}{" hidden" if hidden else ""}: {coords}')
