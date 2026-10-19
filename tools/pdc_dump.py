#!/usr/bin/env python3
"""Print the draw commands of PDC images and sequences (first frame), for checking art.

    python3 tools/pdc_dump.py resources/pdc/index-widget-beeper.pdc
"""
import struct
import sys


def dump(path):
    data = open(path, 'rb').read()
    magic, at = data[:4], 8
    _, _, width, height = struct.unpack('<BBhh', data[at:at + 6])
    at += 6
    if magic == b'PDCS':
        _, frames = struct.unpack('<HH', data[at:at + 4])
        at += 6   # play count, frame count, then the first frame's duration
        print(f'{path}: sequence {width}x{height}, {frames} frames (first shown)')
    else:
        print(f'{path}: image {width}x{height}')
    count = struct.unpack('<H', data[at:at + 2])[0]
    at += 2
    for _ in range(count):
        kind, hidden, stroke, stroke_width, fill, extra, points = struct.unpack('<5B2H', data[at:at + 9])
        at += 9
        coords = []
        for _ in range(points):
            x, y = struct.unpack('<2h', data[at:at + 4])
            at += 4
            coords.append((x / 8, y / 8) if kind == 3 else (x, y))
        print(f'  kind {kind} stroke {stroke:#04x} width {stroke_width} fill {fill:#04x} '
              f'extra {extra}{" hidden" if hidden else ""}: {coords}')


for name in sys.argv[1:]:
    dump(name)
