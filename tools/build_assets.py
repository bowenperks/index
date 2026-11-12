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
- resources/pdc/index-widget-*.pdc: the widget icons, drawn by hand at 25, 36 and 42px on
  Pebble's pixel grid (ICONS), and the dock's microphone (DOCK_MIC).
  The shapes are integer PDC paths and a PDC circle because the firmware draws those with
  the same gpath_draw_filled / graphics_draw_line / graphics_fill_circle calls the native
  app used, antialiasing included; Poco has no filled polygons of its own.
- package.json's resources.media and src/embeddedjs/assets.js, so the JavaScript resource
  ids always match the bundle order.

    python3 tools/build_assets.py
"""
from pathlib import Path
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


# The widget icons, drawn by hand at each size Index shows them, on Pebble's pixel grid as
# the iconography style guide asks (github.com/pebble-dev/iconography, STYLE-GUIDE.md):
# 25px with 2px lines (the confirm window and the map's pin), 36px in the cards' cutouts and
# 42px in the dock, the cube's size, both with 3px lines. A size is drawn for its grid, not
# scaled from another. Coordinates are Pebble's: an integer is a pixel's centre, so 2px
# lines run on x.5 (pixel edges) and 3px lines on integers (pixel centres), and every edge is
# at one of the guide's angles (check()). Closed shapes have a white focal fill. A shape is
# ('path', points, fill, open[, width]) or ('dot', centre, radius), a filled black circle:
# a scaled icon moves a circle's centre but never its radius, so only small dots are circles.
ICONS = {
    # Google Home: a house with eaves and a door.
    'home': {
        25: [('path', [(4.5, 22.5), (4.5, 12.5), (12.5, 4.5), (20.5, 12.5), (20.5, 22.5)], WHITE, False),
             ('path', [(2.5, 13.5), (12.5, 3.5), (22.5, 13.5)], 0, True),
             ('path', [(10.5, 22.5), (10.5, 16.5), (14.5, 16.5), (14.5, 22.5)], 0, True)],
        36: [('path', [(7, 33), (7, 18), (18, 7), (29, 18), (29, 33)], WHITE, False),
             ('path', [(3, 20), (18, 5), (33, 20)], 0, True),
             ('path', [(15, 33), (15, 24), (21, 24), (21, 33)], 0, True)],
        42: [('path', [(8, 39), (8, 21), (21, 8), (34, 21), (34, 39)], WHITE, False),
             ('path', [(4, 23), (21, 6), (38, 23)], 0, True),
             ('path', [(18, 39), (18, 28), (24, 28), (24, 39)], 0, True)],
    },
    # Web Answer: a globe with one meridian and the equator, its outline a pixel circle.
    'web': {
        25: [('path', [(9.5, 2.5), (15.5, 2.5), (17.5, 3.5), (21.5, 7.5), (22.5, 9.5), (22.5, 15.5), (21.5, 17.5),
                       (17.5, 21.5), (15.5, 22.5), (9.5, 22.5), (7.5, 21.5), (3.5, 17.5), (2.5, 15.5), (2.5, 9.5),
                       (3.5, 7.5), (7.5, 3.5)], WHITE, False),
             ('path', [(12.5, 2.5), (14.5, 3.5), (15.5, 5.5), (16.5, 8.5), (16.5, 16.5), (15.5, 19.5), (14.5, 21.5),
                       (12.5, 22.5), (10.5, 21.5), (9.5, 19.5), (8.5, 16.5), (8.5, 8.5), (9.5, 5.5), (10.5, 3.5)],
              0, False),
             ('path', [(2.5, 12.5), (22.5, 12.5)], 0, True)],
        36: [('path', [(14, 4), (22, 4), (26, 6), (30, 10), (32, 14), (32, 22), (30, 26), (26, 30), (22, 32), (14, 32),
                       (10, 30), (6, 26), (4, 22), (4, 14), (6, 10), (10, 6)], WHITE, False),
             ('path', [(18, 4), (21, 5), (22, 6), (23, 8), (24, 11), (24, 25), (23, 28), (22, 30), (21, 31), (18, 32),
                       (15, 31), (14, 30), (13, 28), (12, 25), (12, 11), (13, 8), (14, 6), (15, 5)], 0, False),
             ('path', [(4, 18), (32, 18)], 0, True)],
        42: [('path', [(16, 5), (26, 5), (30, 7), (35, 12), (37, 16), (37, 26), (35, 30), (30, 35), (26, 37), (16, 37),
                       (12, 35), (7, 30), (5, 26), (5, 16), (7, 12), (12, 7)], WHITE, False),
             ('path', [(21, 5), (24, 6), (26, 8), (27, 10), (28, 13), (28, 29), (27, 32), (26, 34), (24, 36), (21, 37),
                       (18, 36), (16, 34), (15, 32), (14, 29), (14, 13), (15, 10), (16, 8), (18, 6)], 0, False),
             ('path', [(5, 21), (37, 21)], 0, True)],
    },
    # Today: a clipboard with two ticked rows.
    'today': {
        25: [('path', [(4.5, 4.5), (20.5, 4.5), (20.5, 22.5), (4.5, 22.5)], WHITE, False),
             ('path', [(8.5, 2.5), (16.5, 2.5), (16.5, 6.5), (8.5, 6.5)], WHITE, False),
             ('path', [(6.5, 10.5), (8.5, 12.5), (11.5, 9.5)], 0, True),
             ('path', [(13.5, 11.5), (17.5, 11.5)], 0, True),
             ('path', [(6.5, 17.5), (8.5, 19.5), (11.5, 16.5)], 0, True),
             ('path', [(13.5, 18.5), (17.5, 18.5)], 0, True)],
        36: [('path', [(7, 7), (30, 7), (30, 33), (7, 33)], WHITE, False),
             ('path', [(12, 4), (25, 4), (25, 10), (12, 10)], WHITE, False),
             ('path', [(10, 16), (12, 18), (16, 14)], 0, True),
             ('path', [(20, 16), (26, 16)], 0, True),
             ('path', [(10, 26), (12, 28), (16, 24)], 0, True),
             ('path', [(20, 26), (26, 26)], 0, True)],
        42: [('path', [(8, 8), (35, 8), (35, 39), (8, 39)], WHITE, False),
             ('path', [(14, 5), (29, 5), (29, 12), (14, 12)], WHITE, False),
             ('path', [(12, 19), (14, 21), (19, 16)], 0, True),
             ('path', [(23, 19), (30, 19)], 0, True),
             ('path', [(12, 30), (14, 32), (19, 27)], 0, True),
             ('path', [(23, 30), (30, 30)], 0, True)],
    },
    # Translate: a speech bubble with an A behind one with lines of text.
    'translate': {
        25: [('path', [(1.5, 2.5), (15.5, 2.5), (15.5, 14.5), (6.5, 14.5), (3.5, 17.5), (3.5, 14.5), (1.5, 14.5)],
              WHITE, False),
             ('path', [(5.5, 10.5), (8.5, 4.5), (11.5, 10.5)], 0, True),
             ('path', [(6.5, 8.5), (10.5, 8.5)], 0, True),
             ('path', [(9.5, 9.5), (23.5, 9.5), (23.5, 20.5), (21.5, 20.5), (21.5, 23.5), (18.5, 20.5), (9.5, 20.5)],
              WHITE, False),
             ('path', [(12.5, 13.5), (20.5, 13.5)], 0, True),
             ('path', [(12.5, 16.5), (18.5, 16.5)], 0, True)],
        36: [('path', [(2, 4), (23, 4), (23, 21), (9, 21), (5, 25), (5, 21), (2, 21)], WHITE, False),
             ('path', [(8, 15), (12, 7), (16, 15)], 0, True),
             ('path', [(10, 11), (14, 11)], 0, True),
             ('path', [(14, 14), (34, 14), (34, 30), (31, 30), (31, 34), (27, 30), (14, 30)], WHITE, False),
             ('path', [(18, 20), (30, 20)], 0, True),
             ('path', [(18, 24), (27, 24)], 0, True)],
        42: [('path', [(2, 5), (27, 5), (27, 25), (10, 25), (6, 29), (6, 25), (2, 25)], WHITE, False),
             ('path', [(9, 18), (14, 8), (19, 18)], 0, True),
             ('path', [(12, 12), (16, 12)], 0, True),
             ('path', [(16, 16), (40, 16), (40, 35), (36, 35), (36, 40), (31, 35), (16, 35)], WHITE, False),
             ('path', [(21, 23), (35, 23)], 0, True),
             ('path', [(21, 28), (32, 28)], 0, True)],
    },
    # Beeper (a message): a speech bubble with three dots.
    'beeper': {
        25: [('path', [(1.5, 2.5), (22.5, 2.5), (22.5, 17.5), (7.5, 17.5), (2.5, 22.5), (2.5, 17.5), (1.5, 17.5)],
              WHITE, False),
             ('dot', (7, 10), 1), ('dot', (12, 10), 1), ('dot', (17, 10), 1)],
        36: [('path', [(2, 4), (34, 4), (34, 25), (12, 25), (4, 33), (4, 25), (2, 25)], WHITE, False),
             ('dot', (11, 14), 2), ('dot', (18, 14), 2), ('dot', (25, 14), 2)],
        42: [('path', [(2, 5), (40, 5), (40, 29), (15, 29), (5, 39), (5, 29), (2, 29)], WHITE, False),
             ('dot', (12, 17), 2), ('dot', (21, 17), 2), ('dot', (30, 17), 2)],
    },
    # Reminder: a calendar page with its rings and a tick.
    'reminder': {
        25: [('path', [(2.5, 2.5), (21.5, 2.5), (21.5, 22.5), (2.5, 22.5)], WHITE, False),
             ('path', [(7.5, 0.5), (7.5, 6.5)], 0, True),
             ('path', [(16.5, 0.5), (16.5, 6.5)], 0, True),
             ('path', [(8.5, 14.5), (10.5, 16.5), (15.5, 11.5)], 0, True),
             ('path', [(9.5, 6.5), (5.5, 6.5)], WHITE, True),
             ('path', [(14.5, 6.5), (18.5, 6.5)], WHITE, True)],
        36: [('path', [(4, 4), (31, 4), (31, 33), (4, 33)], WHITE, False),
             ('path', [(11, 1), (11, 10)], 0, True),
             ('path', [(24, 1), (24, 10)], 0, True),
             ('path', [(12, 21), (15, 24), (22, 17)], 0, True),
             ('path', [(14, 10), (8, 10)], WHITE, True),
             ('path', [(21, 10), (27, 10)], WHITE, True)],
        42: [('path', [(5, 5), (36, 5), (36, 39), (5, 39)], WHITE, False),
             ('path', [(13, 1), (13, 12)], 0, True),
             ('path', [(28, 1), (28, 12)], 0, True),
             ('path', [(14, 25), (17, 28), (25, 20)], 0, True),
             ('path', [(9, 12), (17, 12)], WHITE, True),
             ('path', [(24, 12), (32, 12)], WHITE, True)],
    },
    # Map: a pin with its ring, the ring an octagon so it scales with the pin.
    'pin': {
        25: [('path', [(11.5, 23.5), (4.5, 16.5), (2.5, 12.5), (2.5, 5.5), (6.5, 1.5), (16.5, 1.5), (20.5, 5.5),
                       (20.5, 12.5), (18.5, 16.5)], WHITE, False),
             ('path', [(10.5, 5.5), (12.5, 5.5), (14.5, 7.5), (14.5, 9.5), (12.5, 11.5), (10.5, 11.5), (8.5, 9.5),
                       (8.5, 7.5)], WHITE, False)],
        36: [('path', [(17, 34), (7, 24), (4, 18), (4, 8), (10, 2), (24, 2), (30, 8), (30, 18), (27, 24)], WHITE, False),
             ('path', [(15, 8), (19, 8), (22, 11), (22, 15), (19, 18), (15, 18), (12, 15), (12, 11)], WHITE, False)],
        42: [('path', [(20, 40), (8, 28), (5, 22), (5, 9), (12, 2), (28, 2), (35, 9), (35, 22), (32, 28)], WHITE, False),
             ('path', [(18, 9), (22, 9), (25, 12), (25, 16), (22, 19), (18, 19), (15, 16), (15, 12)], WHITE, False)],
    },
    # Weather (partly cloudy): a sun behind a cloud, their rays and edges 2px.
    'weather': {
        36: [('path', [(19, 6), (24, 6), (26, 8), (26, 13), (24, 15), (19, 15), (17, 13), (17, 8)], WHITE, False),
             ('path', [(25, 30), (27, 28), (27, 24), (25, 22), (18, 22), (15, 19), (10, 19), (7, 22), (4, 22), (1, 25),
                       (1, 27), (4, 30)], WHITE, False),
             ('path', [(29.5, 10.5), (31.5, 10.5)], 0, True, 2), ('path', [(11.5, 10.5), (13.5, 10.5)], 0, True, 2),
             ('path', [(21.5, 0.5), (21.5, 3.5)], 0, True, 2),
             ('path', [(7.5, 22.5), (11.5, 22.5), (13.5, 24.5)], 0, True, 2),
             ('path', [(11.5, 33.5), (27.5, 33.5)], 0, True, 2), ('path', [(23.5, 18.5), (34.5, 18.5)], 0, True, 2),
             ('path', [(29.5, 3.5), (27.5, 5.5)], 0, True, 2), ('path', [(13.5, 3.5), (15.5, 5.5)], 0, True, 2)],
        42: [('path', [(21, 7), (26, 7), (29, 10), (29, 15), (26, 18), (21, 18), (18, 15), (18, 10)], WHITE, False),
             ('path', [(28, 35), (31, 32), (31, 28), (28, 25), (20, 25), (17, 22), (11, 22), (7, 26), (4, 26), (1, 29),
                       (1, 32), (4, 35)], WHITE, False),
             ('path', [(32.5, 12.5), (35.5, 12.5)], 0, True, 2), ('path', [(11.5, 12.5), (14.5, 12.5)], 0, True, 2),
             ('path', [(23.5, 0.5), (23.5, 3.5)], 0, True, 2),
             ('path', [(7.5, 26.5), (12.5, 26.5), (15.5, 29.5)], 0, True, 2),
             ('path', [(12.5, 39.5), (30.5, 39.5)], 0, True, 2), ('path', [(26.5, 21.5), (40.5, 21.5)], 0, True, 2),
             ('path', [(32.5, 4.5), (30.5, 6.5)], 0, True, 2), ('path', [(14.5, 4.5), (16.5, 6.5)], 0, True, 2)],
    },
}
# Each size's file and line width: the confirm window's and pin's 25px, the cards' 36px
# (medium) and the dock's 42px.
SIZES = {25: ('', 2), 36: ('-medium', 3), 42: ('-dock', 3)}
# The guide's angles, as the smallest whole run of each edge (dx, dy): 0, 3:1, 2:1, 1:1,
# 1:2, 1:3 and 90 degrees.
PERMITTED = {(1, 0), (3, 1), (2, 1), (1, 1), (1, 2), (1, 3), (0, 1)}


def check(name, size, points, open_path, width):
    """Fails the build on a point off its line width's grid or an edge at another angle."""
    on_grid = (lambda v: v == round(v)) if width % 2 else (lambda v: v - math.floor(v) == 0.5)
    edges = zip(points, points[1:] + ([] if open_path else points[:1]))
    for (x0, y0), (x1, y1) in edges:
        if not (on_grid(x0) and on_grid(y0)):
            raise SystemExit(f'{name} {size}px: ({x0}, {y0}) is off the {width}px grid')
        dx, dy = round(abs(x1 - x0) * 2), round(abs(y1 - y0) * 2)
        run = math.gcd(dx, dy) or 1
        if (dx, dy) != (0, 0) and (dx // run, dy // run) not in PERMITTED:
            raise SystemExit(f'{name} {size}px: ({x0}, {y0})-({x1}, {y1}) is not at one of the guide\'s angles')


def icon(name, size):
    _, width = SIZES[size]
    commands = []
    for shape in ICONS[name][size]:
        if shape[0] == 'dot':
            (x, y), radius = shape[1], shape[2]
            commands.append(command(2, [(x, y)], fill=BLACK, radius=radius))
            continue
        points, fill, open_path = shape[1], shape[2], shape[3]
        line = shape[4] if len(shape) > 4 else width
        check(name, size, points, open_path, line)
        # Kind 3 is a precise path: coordinates in eighths of a pixel.
        commands.append(struct.pack('<5B2H', 3, 0, BLACK, line, fill, int(open_path), len(points)) +
                        b''.join(struct.pack('<2h', round(x * 8), round(y * 8)) for x, y in points))
    return image(size, size, commands)


# The dock's microphone, in its blue bubble: Pebble's microphone (above) redrawn at the
# dock's size on the pixel grid rather than scaled, which blurred its slanted grille and
# 2px outline into mush. Without its rays, as large as the 36px bubble holds it with 4
# rows clear above and below, 21 x 28: the capsule with a 2px outline on pixel edges,
# white inside, its grille a centre line and two cross lines (square 4px cells), the
# cradle, the stem and a 2px base, every 1px line through pixel centres. Coordinates are
# Pebble's (an integer is a pixel's centre).
DOCK_MIC_SIZE = (21, 28)
DOCK_MIC = [
    ([(7.5, 0.5), (12.5, 0.5), (15.5, 3.5), (15.5, 13.5), (12.5, 16.5), (7.5, 16.5),
      (4.5, 13.5), (4.5, 3.5)], 2, WHITE, False),                       # capsule
    ([(10, 2), (10, 15)], 1, 0, True),                                  # grille
    ([(6, 6), (14, 6)], 1, 0, True),
    ([(6, 11), (14, 11)], 1, 0, True),
    ([(0, 15), (6, 21), (14, 21), (20, 15)], 1, 0, True),               # cradle
    ([(10, 22), (10, 25)], 1, 0, True),                                 # stem
    ([(6, 26.5), (14, 26.5)], 2, 0, True),                              # base
]


def dock_microphone():
    commands = [struct.pack('<5B2H', 3, 0, BLACK, width, fill, int(open_path), len(points)) +
                b''.join(struct.pack('<2h', round(x * 8), round(y * 8)) for x, y in points)
                for points, width, fill, open_path in DOCK_MIC]
    return image(*DOCK_MIC_SIZE, commands)


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


# (JavaScript name, file under resources/, type). Order is the resource id order.
STATIC = [
    ('HOME_ICONS', 'pdc/index-home-icons-light.pdc', 'raw'),
    ('BUBBLE_GREETING', 'pdc/index-bubble-greeting.pdc', 'raw'),
    ('BUBBLE_TAIL', 'pdc/index-bubble-tail.pdc', 'raw'),
    ('WEATHER_DISC', 'pdc/index-weather-disc.pdc', 'raw'),
    ('PEN', 'pdc/index-pen.pdc', 'raw'),
    ('WEATHER_ICON', 'images/weather-partly-cloudy-50.png', 'bitmap'),
]
for size, (suffix, _) in SIZES.items():
    for widget, sizes in ICONS.items():
        if size in sizes:
            STATIC.append((f'{widget.upper()}_{["ICON", "MEDIUM", "DOCK"][list(SIZES).index(size)]}',
                           f'pdc/index-widget-{widget}{suffix}.pdc', 'raw'))
STATIC += [
    ('MIC_SMALL', 'pdc/index-mic-small.pdc', 'raw'),
    ('STREET_MAP', 'pdc/index-street-map.pdc', 'raw'),
    ('TYPING_BUBBLE', 'pdc/index-typing-bubble.pdc', 'raw'),
]


def build():
    (PDC / 'index-bubble-greeting.pdc').write_bytes(greeting_bubble())
    (PDC / 'index-bubble-tail.pdc').write_bytes(reply_tail())
    (PDC / 'index-weather-disc.pdc').write_bytes(weather_disc())
    (PDC / 'index-pen.pdc').write_bytes(pen())
    (PDC / 'index-mic-small.pdc').write_bytes(dock_microphone())
    (PDC / 'index-street-map.pdc').write_bytes(street_map())
    (PDC / 'index-typing-bubble.pdc').write_bytes(typing_bubble())
    for name, sizes in ICONS.items():
        for size in sizes:
            (PDC / f'index-widget-{name}{SIZES[size][0]}.pdc').write_bytes(icon(name, size))
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
