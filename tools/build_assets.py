#!/usr/bin/env python3
"""Generate Index's derived art and its resource table.

Writes, from the committed artwork in resources/:

- the resource table entries for the thinking cube's 81 frames, bitmaps that
  tools/build_cube.py draws (resources/images/thinking/cube-NN.png; it needs shapely, so
  it is run by hand when the cube changes).
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
from xml.etree import ElementTree
import json
import math
import re
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


def scale_pdc(path, factor, stroke):
    """A PDC image scaled by `factor`, its stroke widths mapped by `stroke(width)`, for the
    cards' medium icons. Circles' radii round up a little so small dots keep their weight."""
    data = path.read_bytes()
    assert data[:4] == b'PDCI'
    _, _, width, height, count = struct.unpack_from('<BBhhH', data, 8)
    at, commands = 16, []
    for _ in range(count):
        kind, hidden, color, stroke_width, fill, extra, points = struct.unpack_from('<5B2H', data, at)
        at += 9
        coords = [struct.unpack_from('<2h', data, at + 4 * index) for index in range(points)]
        at += 4 * points
        if kind == 2:
            extra = max(1, round(extra * factor + 0.3))
        commands.append(struct.pack('<5B2H', kind, hidden, color, stroke(stroke_width) if stroke_width else 0,
                                    fill, extra, points) +
                        b''.join(struct.pack('<2h', round(x * factor), round(y * factor)) for x, y in coords))
    return image(round(width * factor), round(height * factor), commands)


# The dock's microphone, in its blue bubble: Pebble's microphone (above) redrawn at the
# dock's size on the pixel grid rather than scaled, which blurred its slanted grille and
# 2px outline into mush. The same parts, 27 x 28: the capsule with a 2px outline on pixel
# edges, white inside, its grille a centre line and two cross lines (3px cells), the
# three rays, the cradle, the stem and a 2px base, every 1px line through pixel centres.
# Coordinates are Pebble's (an integer is a pixel's centre).
DOCK_MIC_SIZE = (27, 28)
DOCK_MIC = [
    ([(10.5, 5.5), (15.5, 5.5), (17.5, 7.5), (17.5, 16.5), (15.5, 18.5), (10.5, 18.5),
      (8.5, 16.5), (8.5, 7.5)], 2, WHITE, False),                      # capsule
    ([(13, 7), (13, 17)], 1, 0, True),                                  # grille
    ([(10, 10), (16, 10)], 1, 0, True),
    ([(10, 14), (16, 14)], 1, 0, True),
    ([(13, 1), (13, 3)], 1, 0, True),                                   # rays
    ([(7, 4), (5, 2)], 1, 0, True),
    ([(19, 4), (21, 2)], 1, 0, True),
    ([(5, 17), (10, 22), (16, 22), (21, 17)], 1, 0, True),              # cradle
    ([(13, 23), (13, 25)], 1, 0, True),                                 # stem
    ([(10, 26.5), (16, 26.5)], 2, 0, True),                             # base
]


def dock_microphone():
    commands = [struct.pack('<5B2H', 3, 0, BLACK, width, fill, int(open_path), len(points)) +
                b''.join(struct.pack('<2h', round(x * 8), round(y * 8)) for x, y in points)
                for points, width, fill, open_path in DOCK_MIC]
    return image(*DOCK_MIC_SIZE, commands)


MEDIUM_SIZE = 36   # the cards' icons, in their bottom-left cutouts


def medium_icons():
    # From the 25px icons (2px strokes become 3px) and, for the weather, the 80px vector
    # partly-cloudy icon the peek unfolds (its 4px and 3px strokes become 3px and 2px).
    scale = MEDIUM_SIZE / ICON_SIZE
    for name in ('beeper', 'reminder', 'pin'):
        (PDC / f'index-widget-{name}-medium.pdc').write_bytes(
            scale_pdc(PDC / f'index-widget-{name}.pdc', scale, lambda width: round(width * scale)))
    for name, shapes in ICONS.items():
        (PDC / f'index-widget-{name}-medium.pdc').write_bytes(icon(shapes, scale, 3))
    (PDC / 'index-widget-weather-medium.pdc').write_bytes(
        scale_pdc(PDC / 'index-weather-partly-cloudy-large.pdc', MEDIUM_SIZE / LARGE_SIZE,
                  lambda width: round(width * 0.75)))


def street_map(width=176, height=94):
    # The "Where is" card's map, after the OpenFreeMap snapshot around 10 Berners St: light
    # grey blocks between white streets, with a green square. A vector image rather than
    # the bitmap, which would take ~9 KB of the app's heap while shown. Laid out on a
    # 186 x 100 grid and scaled to `width` x `height`, the map's inset place in its card.
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
    scale = lambda points: [(round(x * width / 186), round(y * height / 100)) for x, y in points]
    commands = [command(1, scale(points), fill=LIGHT) for points in blocks]
    commands.append(command(1, scale([(112, 80), (140, 80), (140, 100), (112, 100)]), fill=GREEN))
    return image(width, height, commands)


def inset(points, distance):
    """A closed polygon (clockwise, y down) moved `distance` inwards: each edge offset, the
    offset edges meeting at mitred corners."""
    lines = []
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        length = math.hypot(x1 - x0, y1 - y0)
        nx, ny = -(y1 - y0) / length, (x1 - x0) / length   # inward for clockwise
        lines.append(((x0 + nx * distance, y0 + ny * distance), (x1 - x0, y1 - y0)))
    moved = []
    for ((ax, ay), (adx, ady)), ((bx, by), (bdx, bdy)) in zip(lines[-1:] + lines[:-1], lines):
        cross = adx * bdy - ady * bdx
        t = ((bx - ax) * bdy - (by - ay) * bdx) / cross
        moved.append((ax + adx * t, ay + ady * t))
    return moved


def typing_bubble():
    # Index's typing bubble beside the thinking cube, built like the cube itself: a black
    # shape with a white one 2px inside it, so its 2px lines match the cube's. The body runs
    # from x 5 for 99px and is the cube's full height, 69px (the cube's ink spans 69 rows
    # at rest, from the top face's back corner to the front bottom corner). Its stem comes
    # from the top, as a messaging app's does: the top edge runs straight on to the stem's
    # tip, which slopes back down into the left edge, so nothing reaches above the cube.
    left, top, right, bottom, radius, weight = 5, 0, 104, 69, 8, 2
    def arc(cx, cy, start):
        return [(cx + radius * math.cos(math.radians(start + 15 * step)),
                 cy + radius * math.sin(math.radians(start + 15 * step))) for step in range(7)]
    outer = ([(0, top)] + arc(right - radius, top + radius, 270) +
             arc(right - radius, bottom - radius, 0) + arc(left + radius, bottom - radius, 90) +
             [(left, top + 11)])
    def path(points, fill):
        return (struct.pack('<5B2H', 3, 0, 0, 0, fill, 0, len(points)) +
                b''.join(struct.pack('<2h', round(x * 8), round(y * 8)) for x, y in points))
    return image(right + 1, bottom + 1, [path(outer, BLACK), path(inset(outer, weight), WHITE)])


MIC_SIZE = 80
# A result's icon unfolds where the thinking cube was, as big as the cube: the cube's ink
# at rest is 40 x 44px with its anti-aliased edge (resources/images/thinking/cube-12.png),
# 42px drawn; each icon is scaled so its larger ink dimension is CUBE_INK, its strokes
# 3px (the 25px icons' 2px, as the cards' 36px icons; the weather's 4px and 3px become 3px
# and 2px).
CUBE_INK = 42


def ink_size(data):
    """A PDC image's drawn width and height: its points (Pebble coordinates, pixel
    centres) and circles, each widened by half its stroke, plus the pixel itself."""
    _, _, width, height, count = struct.unpack_from('<BBhhH', data, 8)
    at, xs, ys = 16, [], []
    for _ in range(count):
        kind, hidden, stroke, stroke_width, fill, extra, points = struct.unpack_from('<5B2H', data, at)
        coords = [struct.unpack_from('<2h', data, at + 9 + 4 * index) for index in range(points)]
        at += 9 + 4 * points
        half = (stroke_width if stroke else 0) / 2
        scale = 8 if kind == 3 else 1
        for x, y in coords:
            x, y = x / scale, y / scale
            reach = half + (extra if kind == 2 else 0)
            xs += [x - reach, x + reach]
            ys += [y - reach, y + reach]
    return max(xs) - min(xs) + 1, max(ys) - min(ys) + 1


def dock_icon(path, stroke):
    data = path.read_bytes()
    return scale_pdc(path, CUBE_INK / max(ink_size(data)), stroke)


def microphone(size=MIC_SIZE, stroke=None, colour=BLACK, fill_colour=WHITE):
    # The voice input's microphone: Pebble's own, the one the system dictation screen shows
    # (VOICE_MICROPHONE_LARGE). resources/svg/Pebble_80x80_Microphone.svg is a copy of
    # PebbleOS's resources/normal/snowy/images/Pebble_80x80_Microphone.svg (Apache-2.0,
    # Google LLC). Its shapes are all straight (a polygon, lines and a polyline), converted
    # here as PebbleOS's svg2commands would, at its own 80px with its 4px and 3px strokes,
    # or scaled to `size` with strokes `stroke(width)` (the dock's: 25px of ink on a 24px
    # canvas, the outline and base 2px as a 25px icon's, the grille, rays and stand 1px),
    # in `colour`, its capsule filled with `fill_colour` (0: none).
    scale = size / 80
    svg = ElementTree.parse(ROOT / 'resources/svg/Pebble_80x80_Microphone.svg').getroot()
    commands = []
    for element in svg:
        tag = element.tag.split('}')[-1]
        if tag == 'line':
            points = [(float(element.get('x1')), float(element.get('y1'))),
                      (float(element.get('x2')), float(element.get('y2')))]
        elif tag in ('polygon', 'polyline'):
            values = [float(value) for value in element.get('points').replace(',', ' ').split()]
            points = list(zip(values[::2], values[1::2]))
            if tag == 'polygon' and points[0] == points[-1]:
                points.pop()
        else:
            continue
        fill = fill_colour if element.get('fill', 'none').upper() == '#FFFFFF' else 0
        width = float(element.get('stroke-width', '1'))
        width = stroke(width) if stroke else max(1, round(width * scale))
        commands.append(struct.pack('<5B2H', 3, 0, colour, width, fill, int(tag != 'polygon'), len(points)) +
                        b''.join(struct.pack('<2h', round(x * scale * 8), round(y * scale * 8))
                                 for x, y in points))
    return image(size, size, commands)


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
for widget in ('weather', 'beeper', 'reminder', 'pin') + tuple(ICONS):
    STATIC.append((f'{widget.upper()}_MEDIUM', f'pdc/index-widget-{widget}-medium.pdc', 'raw'))
for widget in ('weather', 'beeper', 'reminder', 'pin') + tuple(ICONS):
    STATIC.append((f'{widget.upper()}_DOCK', f'pdc/index-widget-{widget}-dock.pdc', 'raw'))
STATIC += [
    ('MIC', 'pdc/index-mic.pdc', 'raw'),
    ('MIC_SMALL', 'pdc/index-mic-small.pdc', 'raw'),
    ('STREET_MAP', 'pdc/index-street-map.pdc', 'raw'),
    ('TYPING_BUBBLE', 'pdc/index-typing-bubble.pdc', 'raw'),
]


def build():
    (PDC / 'index-bubble-greeting.pdc').write_bytes(greeting_bubble())
    (PDC / 'index-bubble-tail.pdc').write_bytes(reply_tail())
    (PDC / 'index-weather-disc.pdc').write_bytes(weather_disc())
    (PDC / 'index-pen.pdc').write_bytes(pen())
    (PDC / 'index-mic.pdc').write_bytes(microphone())
    (PDC / 'index-mic-small.pdc').write_bytes(dock_microphone())
    (PDC / 'index-street-map.pdc').write_bytes(street_map())
    (PDC / 'index-typing-bubble.pdc').write_bytes(typing_bubble())
    medium_icons()
    for name, shapes in ICONS.items():
        (PDC / f'index-widget-{name}.pdc').write_bytes(icon(shapes, 1, 2))
        (PDC / f'index-widget-{name}-large.pdc').write_bytes(icon(shapes, LARGE_SIZE / ICON_SIZE, 4))
    for name in ('beeper', 'reminder', 'pin') + tuple(ICONS):
        (PDC / f'index-widget-{name}-dock.pdc').write_bytes(
            dock_icon(PDC / f'index-widget-{name}.pdc', lambda width: 3))
    (PDC / 'index-widget-weather-dock.pdc').write_bytes(
        dock_icon(PDC / 'index-weather-partly-cloudy-large.pdc', lambda width: round(width * 0.75)))
    frames = sorted((ROOT / 'resources/images/thinking').glob('cube-[0-9][0-9].png'))
    assert len(frames) == 81, 'run tools/build_cube.py for the thinking cube'

    media = []
    for name, file, kind in STATIC:
        entry = {'type': kind, 'name': 'INDEX_' + name, 'file': file}
        if kind == 'bitmap':
            entry.update(memoryFormat='Smallest', spaceOptimization='memory')
        media.append(entry)
    for index in range(len(frames)):
        media.append({'type': 'bitmap', 'name': f'INDEX_THINKING_{index:02d}',
                      'file': f'images/thinking/cube-{index:02d}.png',
                      'memoryFormat': 'Smallest', 'spaceOptimization': 'memory'})
    package_path = ROOT / 'package.json'
    package = json.loads(package_path.read_text())
    package['pebble']['resources'] = {'media': media}
    package_path.write_text(json.dumps(package, indent=2) + '\n')

    # Only the ids the app's modules name: on the watch every export is memory, and the
    # home screen's art (home.js, carousel.js, unused) would otherwise keep its ids.
    used = ''.join(path.read_text() for path in (ROOT / 'src/embeddedjs').glob('[!.]*.js')
                   if path.name not in ('assets.js', 'home.js', 'carousel.js'))
    lines = ['// Generated by tools/build_assets.py from the bundle order: do not edit.',
             '// Resource ids count from 1 in package.json\'s media order; only the ids the',
             '// modules name are listed.', '']
    ids = [(name, index + 1) for index, (name, _, _) in enumerate(STATIC)]
    ids += [('THINKING_FIRST', len(STATIC) + 1), ('THINKING_FRAMES', len(frames))]
    for name, value in ids:
        if re.search(rf'\b{name}\b', used):
            lines.append(f'export const {name} = {value};')
    (ROOT / 'src/embeddedjs/assets.js').write_text('\n'.join(lines) + '\n')
    print(f'{len(media)} resources ({len(frames)} thinking frames)')


if __name__ == '__main__':
    build()
