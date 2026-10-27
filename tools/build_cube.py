#!/usr/bin/env python3
"""Index's thinking cube, drawn the way PebbleOS draws its own icons.

The motion is the Blender cube's (26 cubies projected per frame by the C app's
tools; a compact copy is tools/cube-geometry.json): a face-on square that tilts into
a three-quarter view, then four layer turns. Each frame is drawn here as Pebble's
icons are (resources/normal/base/images/Pebble_*.svg in PebbleOS): a white body with
a black outline, its grid in black strokes, round joins and caps, every point on a
pixel centre (svg2commands' Pebble coordinates), at the size Index shows it, so
nothing is scaled on the watch.

  - Hidden surfaces are removed exactly: each visible face keeps only what no nearer
    face covers (the faces' depth planes decide, in their overlap).
  - The outer stickers are cells of a grid; the cubies' inner faces, which a turn
    exposes, are plain white areas (coplanar ones merged, so they carry no grid).
  - Every line is drawn once, straight from end to end: boundaries are noded, joined
    into maximal straight runs, and only their ends are snapped to pixels, so a grid
    line never wobbles where it crosses another.

The frames ship as bitmaps of exactly that drawing: each is drawn at 8x with exact
strokes and averaged down, every pixel then moved to the nearest of Pebble's 64 colours.
As vector commands the firmware strokes these 2px lines nearer 4px, filling the
stickers in; and the cube is only ever drawn on the dock's blue, so its edges are
blended with that blue and everything else left transparent.

    python3 tools/build_cube.py                     (needs shapely and Pillow)
    python3 tools/build_cube.py --preview DIR       (also a contact sheet, 4x)
    python3 tools/build_cube.py --pdc FILE          (also the vector sequence)
    python3 tools/build_cube.py --import RAW_DIR    (refresh tools/cube-geometry.json
                                                    from index/artifacts/raw/thinking)

Writes resources/images/thinking/cube-NN.png, one bitmap resource per frame
(tools/build_assets.py lists them).
"""
import argparse
import json
import math
import struct
from pathlib import Path

from shapely import LineString, Point, Polygon, set_precision, union_all
from shapely.ops import linemerge

ROOT = Path(__file__).resolve().parents[1]
GEOMETRY = ROOT / 'tools/cube-geometry.json'
FRAMES = ROOT / 'resources/images/thinking'
DOCK_BLUE = (0, 170, 255)      # VIVID_CERULEAN, the dock the cube is drawn on

# Output pixels per Blender unit at the three-quarter view: the turning cube (58.3
# units at its tallest) fits the 49px dock with its outline and 2px to spare, and
# rests 41px tall. The face-on square is 1/0.87 of that scale (the reveal shrinks the
# cube by 13% as it tilts, as the C app's cube does).
SCALE = 0.737
REVEAL_SHRINK = 0.13
CANVAS = 50                    # square, the source's centre (40, 40) at its middle
# Stroke widths, px: uniform 2px, the official 25px icons' weight. (A 1px grid, the
# official 50px icons' lighter inner lines at this size, anti-aliases into dashes on the
# display's four shades.)
OUTLINE = 2
GRID = 2
WHITE, BLACK = 0xFF, 0xC0      # GColor8: the light theme (the dock is blue)
AREA_EPSILON = 0.02            # px^2: faces seen edge on, and slivers, are dropped
STRAIGHT = math.radians(1.5)   # segments this close in direction form one line


def load(path):
    data = json.loads(path.read_text())
    return data['frames']


def import_raw(raw_dir):
    """The C app's per-frame JSON (Blender projections) as one compact file."""
    meta = json.loads((raw_dir / 'render.json').read_text())
    groups = [('reveal', meta['reveal_steps'])] + [
        (group, meta['turn_steps']) for group in ('right_up', 'top_left', 'right_down', 'top_right')]
    frames = []
    for group, steps in groups:
        for step in range(steps + 1):
            faces = json.loads((raw_dir / f'{group}-{step:02d}.json').read_text())
            frames.append({'group': group, 'step': step, 'steps': steps,
                           'faces': [{'points': [[round(v, 3) for v in point] for point in face['points']],
                                      'panel': face['panel']} for face in faces]})
    GEOMETRY.write_text(json.dumps({'source': meta.get('source'), 'size': meta['size'],
                                    'frames': frames}, separators=(',', ':')))
    print(f'{len(frames)} frames -> {GEOMETRY}')


def smoothstep(value):
    return value * value * (3 - 2 * value)


def depth_plane(points):
    """depth = a x + b y + c through the face's points (least squares over all four)."""
    n = len(points)
    sx = sum(p[0] for p in points); sy = sum(p[1] for p in points); sz = sum(p[2] for p in points)
    sxx = sum(p[0] * p[0] for p in points); syy = sum(p[1] * p[1] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    sxz = sum(p[0] * p[2] for p in points); syz = sum(p[1] * p[2] for p in points)
    matrix = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
    vector = [sxz, syz, sz]
    determinant = det3(matrix)
    if abs(determinant) < 1e-9:
        return None
    solution = []
    for column in range(3):
        replaced = [row[:] for row in matrix]
        for row in range(3):
            replaced[row][column] = vector[row]
        solution.append(det3(replaced) / determinant)
    return tuple(solution)


def det3(m):
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
            m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
            m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def faces_of(frame):
    """The frame's faces in canvas pixels (graphics coordinates: pixel i spans i..i+1)."""
    if frame['group'] == 'reveal':
        reveal = smoothstep(frame['step'] / frame['steps'])
    else:
        reveal = 1
    scale = SCALE / (1 - REVEAL_SHRINK) * (1 - REVEAL_SHRINK * reveal)
    centre = CANVAS / 2
    faces = []
    for face in frame['faces']:
        points = [(centre + (x - 40) * scale, centre + (y - 40) * scale, z) for x, y, z in face['points']]
        polygon = Polygon([p[:2] for p in points])
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.area < AREA_EPSILON:
            continue
        plane = depth_plane(points)
        if plane is None:
            continue
        faces.append({'polygon': set_precision(polygon, 0.001), 'plane': plane, 'panel': face['panel']})
    return faces, reveal


def depth(plane, point):
    return plane[0] * point.x + plane[1] * point.y + plane[2]


def visible_regions(faces):
    """Each face less whatever nearer faces cover (smaller depth is nearer)."""
    regions = []
    for face in faces:
        visible = face['polygon']
        for other in faces:
            if other is face or visible.is_empty or not visible.intersects(other['polygon']):
                continue
            overlap = face['polygon'].intersection(other['polygon'])
            if overlap.area < 1e-4:
                continue
            probe = overlap.representative_point()
            if depth(other['plane'], probe) < depth(face['plane'], probe) - 1e-6:
                visible = visible.difference(other['polygon'])
        if not visible.is_empty and visible.area >= AREA_EPSILON:
            regions.append((set_precision(visible, 0.001), face))
    return regions


def plane_key(plane):
    return tuple(round(value, 2) for value in plane)


def line_parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'LineString':
        return [geometry]
    if geometry.geom_type == 'LinearRing':
        return [LineString(geometry.coords)]
    return [part for child in getattr(geometry, 'geoms', []) for part in line_parts(child)]


def polygons(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [part for child in getattr(geometry, 'geoms', []) for part in polygons(child)]


def straight_runs(lines):
    """Noded segments joined into maximal straight runs (each segment once)."""
    segments = []
    for line in lines:
        coords = list(line.coords)
        segments.extend(zip(coords, coords[1:]))
    key = lambda p: (round(p[0], 3), round(p[1], 3))
    at = {}
    for index, (a, b) in enumerate(segments):
        at.setdefault(key(a), []).append(index)
        at.setdefault(key(b), []).append(index)
    used = [False] * len(segments)

    def direction(a, b):
        return math.atan2(b[1] - a[1], b[0] - a[0])

    def extend(points, forward):
        # Grow the run from its end (or start) through straight continuations.
        while True:
            end, before = (points[-1], points[-2]) if forward else (points[0], points[1])
            heading = direction(before, end)
            best = None
            for index in at.get(key(end), []):
                if used[index]:
                    continue
                a, b = segments[index]
                other = b if key(a) == key(end) else a
                turn = abs((direction(end, other) - heading + math.pi) % (2 * math.pi) - math.pi)
                if turn <= STRAIGHT:
                    best = (index, other)
                    break
            if best is None:
                return
            used[best[0]] = True
            if forward:
                points.append(best[1])
            else:
                points.insert(0, best[1])

    runs = []
    for index, (a, b) in enumerate(segments):
        if used[index]:
            continue
        used[index] = True
        points = [a, b]
        extend(points, True)
        extend(points, False)
        runs.append((points[0], points[-1]))
    return runs


def pebble(point):
    """svg2commands' Pebble coordinates: the pixel whose centre is nearest."""
    return (math.floor(point[0] - 0.5 + 0.5), math.floor(point[1] - 0.5 + 0.5))


def collinear(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) == (b[1] - a[1]) * (c[0] - a[0])


def ring_points(ring, nodes):
    """The silhouette's corners, plus the nodes on it where lines meet it, snapped."""
    line = LineString(ring.coords)
    on = [(line.project(Point(p)), p) for p in nodes if line.distance(Point(p)) < 1e-3]
    on += [(line.project(Point(p)), p) for p in list(ring.coords)[:-1]]
    on.sort()
    points = []
    for _, p in on:
        q = pebble(p)
        if not points or points[-1] != q:
            points.append(q)
    while len(points) > 1 and points[0] == points[-1]:
        points.pop()
    # Corners only: drop points on a straight stretch.
    changed = True
    while changed and len(points) > 3:
        changed = False
        for i in range(len(points)):
            a, b, c = points[i - 1], points[i], points[(i + 1) % len(points)]
            if collinear(a, b, c):
                del points[i]
                changed = True
                break
    return points


def draw_frame(frame):
    faces, reveal = faces_of(frame)
    silhouette = union_all([face['polygon'] for face in faces])
    commands = []
    lines = []
    if reveal > 0:
        regions = visible_regions(faces)
        # Stickers keep their own cells; inner faces merge by plane (no grid on them).
        groups = [region for region, face in regions if face['panel']]
        inner = {}
        for region, face in regions:
            if not face['panel']:
                inner.setdefault(plane_key(face['plane']), []).append(region)
        groups += [union_all(parts) for parts in inner.values()]
        for group in groups:
            for polygon in polygons(group):
                lines.append(polygon.exterior)
                lines.extend(polygon.interiors)
    outline = silhouette.boundary
    noded = union_all([set_precision(LineString(line.coords), 0.001) for line in lines] +
                      [set_precision(outline, 0.001)])
    parts = line_parts(noded)
    nodes = {p for part in parts for p in (part.coords[0], part.coords[-1])}
    for body in polygons(silhouette):
        points = ring_points(body.exterior, nodes)
        if len(points) >= 3:
            commands.append({'points': points, 'closed': True})
    interior = [part for part in parts if outline.distance(part.interpolate(0.5, normalized=True)) > 1e-3]
    seen = set()
    for a, b in straight_runs(interior):
        a, b = pebble(a), pebble(b)
        if a == b or (a, b) in seen or (b, a) in seen:
            continue
        seen.add((a, b))
        commands.append({'points': [a, b], 'closed': False})
    return commands


def pdc_command(command):
    points = command['points']
    if command['closed']:
        header = struct.pack('<5B2H', 1, 0, BLACK, OUTLINE, WHITE, 0, len(points))
    else:
        header = struct.pack('<5B2H', 1, 0, BLACK, GRID, 0, 1, len(points))
    return header + b''.join(struct.pack('<2h', x, y) for x, y in points)


def write_sequence(frames, path):
    body = b''
    for commands in frames:
        body += struct.pack('<HH', 1, len(commands)) + b''.join(pdc_command(c) for c in commands)
    payload = struct.pack('<BBhhHH', 1, 0, CANVAS, CANVAS, 1, len(frames)) + body
    path.write_bytes(b'PDCS' + struct.pack('<I', len(payload)) + payload)


def preview(commands, zoom=8):
    """The frame drawn at `zoom` times with exact strokes and round joins, on the dock's
    blue, and averaged down."""
    from PIL import Image, ImageDraw
    big = Image.new('RGB', (CANVAS * zoom, CANVAS * zoom), DOCK_BLUE)
    draw = ImageDraw.Draw(big)

    def at(p):
        return ((p[0] + 0.5) * zoom, (p[1] + 0.5) * zoom)

    def stroke(points, width, closed):
        pts = [at(p) for p in points] + ([at(points[0])] if closed else [])
        draw.line(pts, fill=(0, 0, 0), width=width * zoom, joint='curve')
        radius = width * zoom / 2
        for x, y in pts:
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(0, 0, 0))

    for command in commands:
        if command['closed']:
            draw.polygon([at(p) for p in command['points']], fill=(255, 255, 255))
            stroke(command['points'], OUTLINE, True)
        else:
            stroke(command['points'], GRID, False)
    return big.resize((CANVAS, CANVAS), Image.Resampling.BOX)


def pebble_colour(rgb):
    """The nearest of the 64 colours: each channel to 0, 85, 170 or 255."""
    return tuple(min(255, (value + 42) // 85 * 85) for value in rgb)


def frame_bitmap(commands):
    """The shipped frame: the preview in Pebble's colours, the dock's blue transparent."""
    from PIL import Image
    image = preview(commands)
    bitmap = Image.new('RGBA', image.size, (0, 0, 0, 0))
    source, target = image.load(), bitmap.load()
    for y in range(image.height):
        for x in range(image.width):
            colour = pebble_colour(source[x, y])
            if colour != DOCK_BLUE:
                target[x, y] = colour + (255,)
    return bitmap


def main():
    global OUTLINE, GRID
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--import', dest='raw', type=Path)
    parser.add_argument('--preview', type=Path)
    parser.add_argument('--outline', type=int, default=OUTLINE)
    parser.add_argument('--grid', type=int, default=GRID)
    parser.add_argument('--pdc', type=Path)
    arguments = parser.parse_args()
    if arguments.raw:
        import_raw(arguments.raw)
        return
    OUTLINE, GRID = arguments.outline, arguments.grid
    frames = [draw_frame(frame) for frame in load(GEOMETRY)]
    FRAMES.mkdir(parents=True, exist_ok=True)
    for old in FRAMES.glob('cube-*.png'):
        old.unlink()
    bitmaps = [frame_bitmap(frame) for frame in frames]
    for index, bitmap in enumerate(bitmaps):
        bitmap.save(FRAMES / f'cube-{index:02d}.png', optimize=True)
    colours = {pixel for bitmap in bitmaps for pixel in bitmap.get_flattened_data() if pixel[3]}
    print(f'{len(frames)} frames -> {FRAMES}, {len(colours)} colours')
    if arguments.pdc:
        write_sequence(frames, arguments.pdc)
    if arguments.preview:
        from PIL import Image
        arguments.preview.mkdir(parents=True, exist_ok=True)
        shown = []
        for bitmap in bitmaps:
            image = Image.new('RGB', bitmap.size, DOCK_BLUE)
            image.paste(bitmap, (0, 0), bitmap)
            shown.append(image)
        picks = [0, 3, 6, 9, 12, 17, 21, 25, 34, 38, 46, 55, 63, 72]
        sheet = Image.new('RGB', (len(picks) * (CANVAS * 4 + 4), CANVAS * 4), (40, 40, 40))
        for column, index in enumerate(picks):
            sheet.paste(shown[index].resize((CANVAS * 4, CANVAS * 4), Image.Resampling.NEAREST),
                        (column * (CANVAS * 4 + 4), 0))
        sheet.save(arguments.preview / 'sheet.png')


if __name__ == '__main__':
    main()
