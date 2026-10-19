#!/usr/bin/env python3
"""Generate Index's derived art and its resource table.

Writes, from the committed artwork in resources/:

- resources/pdc/thinking/frame-NN.pdc: the thinking cube's 81 frames as one-frame
  sequences. The native app streams the 60 KB sequence one frame at a time; Alloy loads a
  sequence whole, so the frames are split and each is loaded only while it is on screen.
- resources/pdc/index-bubble-greeting.pdc: the home screen's greeting panel, a fixed
  184 x 75 bubble with its tail (Index's original gpath outline and interior).
- resources/pdc/index-bubble-tail.pdc: the tail of Index's reply bubbles.
- resources/pdc/index-weather-disc.pdc: the weather card's 70px Chrome Yellow disc.
- resources/pdc/index-pen.pdc: a 1px line that resets the stroke width (see pen()).
  The shapes are integer PDC paths and a PDC circle because the firmware draws those with
  the same gpath_draw_filled / graphics_draw_line / graphics_fill_circle calls the native
  app used, antialiasing included; Poco has no filled polygons of its own.
- package.json's resources.media and src/embeddedjs/assets.js, so the JavaScript resource
  ids always match the bundle order.

    python3 tools/build_assets.py
"""
from pathlib import Path
import json
import struct

ROOT = Path(__file__).resolve().parents[1]
PDC = ROOT / 'resources/pdc'

# GColor8 bytes: 0b11rrggbb.
WHITE, BLACK, DARK_GRAY, CHROME_YELLOW = 0xFF, 0xC0, 0xD5, 0xF8


def command(kind, points, stroke=0, width=0, fill=0, open_path=False, radius=0):
    """One PDC draw command; kind 1 is an integer path, 2 a circle."""
    extra = radius if kind == 2 else int(open_path)
    return struct.pack('<5B2H', kind, 0, stroke, width, fill, extra, len(points)) + b''.join(
        struct.pack('<2h', x, y) for x, y in points)


def image(width, height, commands):
    payload = struct.pack('<BBhhH', 1, 0, width, height, len(commands)) + b''.join(commands)
    return b'PDCI' + struct.pack('<I', len(payload)) + payload


def greeting_bubble():
    # index_home.c draw_bubble: the bubble's frame is (left, top, 184, 75); the image's
    # origin is (left - 5, top) so the tail's tip at left - 5 is its first column.
    left, top = 5, 0
    right, bottom = left + 184 - 1, top + 75 - 1
    outer = [(left + 4, top), (right - 4, top), (right - 1, top + 1), (right, top + 4),
             (right, bottom - 4), (right - 1, bottom - 1), (right - 4, bottom),
             (left + 6, bottom), (left - 5, bottom + 2), (left, bottom - 5), (left, top + 4),
             (left + 1, top + 1)]
    inner = [(left + 4, top + 1), (right - 4, top + 1), (right - 2, top + 2),
             (right - 1, top + 4), (right - 1, bottom - 4), (right - 2, bottom - 2),
             (right - 4, bottom - 1), (left + 6, bottom - 1), (left - 2, bottom),
             (left + 1, bottom - 5), (left + 1, top + 4), (left + 2, top + 2)]
    return image(right + 1, bottom + 3, [
        command(1, outer, fill=DARK_GRAY),
        command(1, inner, fill=WHITE),
        command(1, [(left + 4, top), (right - 4, top)], stroke=BLACK, width=1, open_path=True),
    ])


def reply_tail():
    # index_chat.c draw_bubble_frame: {edge, bottom - 9}, {edge - 5, bottom + 3},
    # {edge + 9, bottom - 1}, filled with the page colour and stroked along its two open
    # sides. Drawn at (edge - 5, bottom - 9); the stroke is recoloured per reveal shade.
    return image(15, 13, [command(1, [(5, 0), (0, 12), (14, 8)], stroke=DARK_GRAY, width=1,
                                  fill=WHITE, open_path=True)])


def pen():
    # A 1px line, drawn off screen to set the graphics context's stroke width back to 1:
    # Poco's frameRoundRect strokes at the context's current width, which drawing a PDC
    # leaves at its last command's width.
    return image(2, 1, [command(1, [(0, 0), (1, 0)], stroke=BLACK, width=1, open_path=True)])


def weather_disc():
    return image(71, 71, [command(2, [(35, 35)], fill=CHROME_YELLOW, radius=35)])


# The new widget icons, drawn on the existing icons' 25px grid in their style: black
# 2px outlines with white fill (4px on the 80px versions the peek unfolds). Each shape is
# (kind, points, fill, open) with 'path' points in pixels, or ('circle', centre, radius).
ICON_SIZE, LARGE_SIZE = 25, 80
ICONS = {
    # Google Home: a house with eaves and a door.
    'home': [
        ('path', [(5, 22), (5, 12), (12.5, 4.5), (20, 12), (20, 22)], WHITE, False),
        ('path', [(2.5, 13.5), (12.5, 3.5), (22.5, 13.5)], 0, True),
        ('path', [(10.5, 22), (10.5, 16), (14.5, 16), (14.5, 22)], 0, True),
    ],
    # Web Answer: a globe with one meridian and the equator.
    'web': [
        ('circle', (12, 12), 10),
        ('path', [(12 + 4.5 * x, 12 + 10 * y) for x, y in (
            (0, -1), (0.56, -0.92), (0.87, -0.71), (1, -0.38), (1, 0.38), (0.87, 0.71),
            (0.56, 0.92), (0, 1), (-0.56, 0.92), (-0.87, 0.71), (-1, 0.38), (-1, -0.38),
            (-0.87, -0.71), (-0.56, -0.92))], 0, False),
        ('path', [(2, 12), (22, 12)], 0, True),
    ],
    # Today: a clipboard with three ticked rows.
    'today': [
        ('path', [(4, 4), (21, 4), (21, 23), (4, 23)], WHITE, False),
        ('path', [(9, 2), (16, 2), (16, 6), (9, 6)], WHITE, False),
        ('path', [(7, 10.5), (8.5, 12), (10.5, 9.5)], 0, True),
        ('path', [(13, 11), (18, 11)], 0, True),
        ('path', [(7, 17.5), (8.5, 19), (10.5, 16.5)], 0, True),
        ('path', [(13, 18), (18, 18)], 0, True),
    ],
    # Translate: a speech bubble with an A behind one with lines of text.
    'translate': [
        ('path', [(1, 2), (15, 2), (15, 14), (6, 14), (3, 17), (3, 14), (1, 14)], WHITE, False),
        ('path', [(4.5, 11.5), (8, 4.5), (11.5, 11.5)], 0, True),
        ('path', [(5.75, 9), (10.25, 9)], 0, True),
        ('path', [(10, 10), (24, 10), (24, 21), (22, 21), (22, 24), (19, 21), (10, 21)], WHITE, False),
        ('path', [(13, 14), (21, 14)], 0, True),
        ('path', [(13, 17.5), (19, 17.5)], 0, True),
    ],
}


def icon(shapes, scale, stroke_width):
    commands = []
    for shape in shapes:
        if shape[0] == 'circle':
            (x, y), radius = shape[1], shape[2]
            commands.append(command(2, [(round(x * scale), round(y * scale))], stroke=BLACK,
                                    width=stroke_width, fill=WHITE, radius=round(radius * scale)))
            continue
        _, points, fill, open_path = shape
        # Kind 3 is a precise path: coordinates in eighths of a pixel.
        commands.append(struct.pack('<5B2H', 3, 0, BLACK, stroke_width, fill, int(open_path), len(points)) +
                        b''.join(struct.pack('<2h', round(x * scale * 8), round(y * scale * 8))
                                 for x, y in points))
    size = round(ICON_SIZE * scale)
    return image(size, size, commands)


def street_map():
    # The "Where is" card's map, after the OpenFreeMap snapshot around 10 Berners St: light
    # grey blocks between white streets, with a green square. A vector image rather than
    # the 186 x 100 bitmap, which would take ~9 KB of the app's heap while shown.
    LIGHT, GREEN = 0xEA, 0xEE   # light grey, mint green
    blocks = [
        # Above Eastcastle St (y 26-36).
        [(0, 0), (40, 0), (38, 26), (0, 26)], [(48, 0), (96, 0), (96, 26), (46, 26)],
        [(106, 0), (186, 0), (186, 26), (106, 26)],
        # Between Eastcastle St and the lane (y 66-74), either side of Berners St (x 96-106).
        [(0, 36), (36, 36), (34, 66), (0, 66)], [(44, 36), (96, 36), (96, 66), (42, 66)],
        [(106, 36), (148, 36), (148, 66), (106, 66)], [(156, 36), (186, 36), (186, 66), (156, 66)],
        # Below the lane.
        [(0, 74), (33, 74), (31, 100), (0, 100)], [(41, 74), (96, 74), (96, 100), (39, 100)],
        [(106, 74), (186, 74), (186, 100), (106, 100)],
    ]
    commands = [command(1, points, fill=LIGHT) for points in blocks]
    commands.append(command(1, [(112, 80), (140, 80), (140, 100), (112, 100)], fill=GREEN))
    return image(186, 100, commands)


def microphone():
    # The voice input's microphone, centred in the 20px thinking ring: a solid capsule in
    # its U-shaped holder on a short stand, black on the page.
    capsule = [(8 + 3.5 * x, y) for x, y in (
        (0, 1), (0.7, 1.3), (1, 2.5), (1, 11.5), (0.7, 12.7), (0, 13), (-0.7, 12.7), (-1, 11.5),
        (-1, 2.5), (-0.7, 1.3))]
    holder = [(1.5, 9), (2, 12), (3.5, 14.5), (5.5, 16), (8, 16.5), (10.5, 16), (12.5, 14.5),
              (14, 12), (14.5, 9)]
    path = lambda points, fill, open_path: (struct.pack('<5B2H', 3, 0, BLACK, 2, fill, int(open_path), len(points)) +
                                            b''.join(struct.pack('<2h', round(x * 8), round(y * 8)) for x, y in points))
    return image(16, 23, [path(capsule, BLACK, False), path(holder, 0, True),
                          path([(8, 16.5), (8, 21)], 0, True), path([(4.5, 21.5), (11.5, 21.5)], 0, True)])


def thinking_frames():
    data = (PDC / 'index-thinking-light.pdc').read_bytes()
    assert data[:4] == b'PDCS'
    _, _, width, height, _, count = struct.unpack_from('<BBhhHH', data, 8)
    offset, frames = 18, []
    for _ in range(count):
        _, commands = struct.unpack_from('<HH', data, offset)
        start = offset + 4
        offset = start
        for _ in range(commands):
            points, = struct.unpack_from('<H', data, offset + 7)
            offset += 9 + 4 * points
        # A one-frame sequence (PDCS), not an image: Alloy keeps every PDC image it has
        # loaded cached by resource id, so 81 frame images would all stay in memory;
        # sequences are released by the garbage collector.
        payload = struct.pack('<BBhhHH', 1, 0, width, height, 1, 1) + struct.pack('<HH', 1, commands) + data[start:offset]
        frames.append(b'PDCS' + struct.pack('<I', len(payload)) + payload)
    assert offset == len(data)
    return frames


# (JavaScript name, file under resources/, type). Order is the resource id order.
STATIC = [
    ('HOME_ICONS', 'pdc/index-home-icons-light.pdc', 'raw'),
    ('BUBBLE_GREETING', 'pdc/index-bubble-greeting.pdc', 'raw'),
    ('BUBBLE_TAIL', 'pdc/index-bubble-tail.pdc', 'raw'),
    ('WEATHER_DISC', 'pdc/index-weather-disc.pdc', 'raw'),
    ('PEN', 'pdc/index-pen.pdc', 'raw'),
    ('WEATHER_ICON', 'images/weather-partly-cloudy-50.png', 'bitmap'),
    ('WEATHER_ICON_TINY', 'images/weather-partly-cloudy-25.png', 'bitmap'),
    ('WEATHER_LARGE', 'pdc/index-weather-partly-cloudy-large.pdc', 'raw'),
]
for widget in ('alarm', 'beeper', 'timer', 'reminder', 'note', 'tool', 'pin') + tuple(ICONS):
    STATIC += [(f'{widget.upper()}_ICON', f'pdc/index-widget-{widget}.pdc', 'raw'),
               (f'{widget.upper()}_LARGE', f'pdc/index-widget-{widget}-large.pdc', 'raw')]
STATIC += [
    ('MIC', 'pdc/index-mic.pdc', 'raw'),
    ('STREET_MAP', 'pdc/index-street-map.pdc', 'raw'),
]


def build():
    (PDC / 'index-bubble-greeting.pdc').write_bytes(greeting_bubble())
    (PDC / 'index-bubble-tail.pdc').write_bytes(reply_tail())
    (PDC / 'index-weather-disc.pdc').write_bytes(weather_disc())
    (PDC / 'index-pen.pdc').write_bytes(pen())
    (PDC / 'index-mic.pdc').write_bytes(microphone())
    (PDC / 'index-street-map.pdc').write_bytes(street_map())
    for name, shapes in ICONS.items():
        (PDC / f'index-widget-{name}.pdc').write_bytes(icon(shapes, 1, 2))
        (PDC / f'index-widget-{name}-large.pdc').write_bytes(icon(shapes, LARGE_SIZE / ICON_SIZE, 4))
    frames = thinking_frames()
    (PDC / 'thinking').mkdir(exist_ok=True)
    for index, frame in enumerate(frames):
        (PDC / f'thinking/frame-{index:02d}.pdc').write_bytes(frame)

    media = []
    for name, file, kind in STATIC:
        entry = {'type': kind, 'name': 'INDEX_' + name, 'file': file}
        if kind == 'bitmap':
            entry.update(memoryFormat='Smallest', spaceOptimization='memory')
        media.append(entry)
    for index in range(len(frames)):
        media.append({'type': 'raw', 'name': f'INDEX_THINKING_{index:02d}',
                      'file': f'pdc/thinking/frame-{index:02d}.pdc'})
    package_path = ROOT / 'package.json'
    package = json.loads(package_path.read_text())
    package['pebble']['resources'] = {'media': media}
    package_path.write_text(json.dumps(package, indent=2) + '\n')

    lines = ['// Generated by tools/build_assets.py from the bundle order: do not edit.',
             '// Resource ids count from 1 in package.json\'s media order.', '']
    for index, (name, _, _) in enumerate(STATIC):
        lines.append(f'export const {name} = {index + 1};')
    lines.append(f'export const THINKING_FIRST = {len(STATIC) + 1};')
    lines.append(f'export const THINKING_FRAMES = {len(frames)};')
    (ROOT / 'src/embeddedjs/assets.js').write_text('\n'.join(lines) + '\n')
    print(f'{len(media)} resources ({len(frames)} thinking frames)')


if __name__ == '__main__':
    build()
