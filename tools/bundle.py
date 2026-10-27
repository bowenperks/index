#!/usr/bin/env python3
"""Bundle Index's JavaScript modules into one module for the watch.

The source stays split into readable ES modules (src/embeddedjs/*.js). On the watch, XS
links every module of a mod at launch, and that linking briefly needs far more memory
than the app itself: with eleven modules the slot heap peaked near 55 KB while loading
and settled at 37 KB, and XS never returns heap to the app. That peak left too little of
the app's 122 KB for the native side (vector art, the dictation session). Bundling turns
each module into a function scope inside one module, which loads in a fraction of that.

Each module's exports come out as an array, and importers take them by position: an
export passed by name would be a property key, and on the watch every distinct name is a
symbol in the mod and a key in the heap (see tools/build.sh, which then shortens the
bundle's local names with terser).

Exports that are numbers are not passed at all: each importer gets the number itself, as
a constant terser folds into its code the way it folds the module's own (an export taken
from the array is a variable every function using it has to capture, which on the watch
is heap, and the array's element is more). A number is an integer literal, or integer
arithmetic (+, - and *) on those and the module's numeric constants declared before it
(fractions, exponents and -0 are left to run time).

Index runs on Emery alone (package.json's targetPlatforms), so some of what Poco answers
at run time is known here, and is written in the same way: the screen's size
(`render.width`, `render.height`) and the colours made from numbers
(`render.makeColor(0, 170, 255)`), where `render` is theme.js's Poco. Were another
platform added, they would be left to run time.

    python3 tools/bundle.py SOURCE_DIR OUTPUT.js

Supported module syntax (all Index uses): `import X from "m"`, `import {a, b as c} from
"m"`, `import * as n from "m"` (used as `n.name`), `export const|let|function|class`,
`export default class`. Imports of modules outside SOURCE_DIR (the Alloy host's) are kept,
deduplicated, at the top.
"""
import ast
import json
from pathlib import Path
import re
import sys

IMPORT = re.compile(r'^import\s+([^;]+?)\s+from\s+"([^"]+)";[ \t]*$', re.M | re.S)
EXPORT = re.compile(r'^export\s+(default\s+)?(const|let|function|class)\s+([A-Za-z_$][\w$]*)', re.M)
# A `const` statement at the top of a module (the source is indented below it), ending
# with its line; it may declare several names.
CONST = re.compile(r'^(export\s+)?const\s+(.+?);[ \t]*(?://[^\n]*)?$', re.M | re.S)
NAME = r'[A-Za-z_$][\w$]*'

# Emery's screen (PBL_DISPLAY_WIDTH and _HEIGHT in the SDK's pebble_sdk_platform.py), the
# size Poco takes from the frame buffer.
EMERY_SCREEN = {'width': 200, 'height': 228}


def emery_color(red, green, blue):
    """render.makeColor on Pebble: the firmware's Poco makes a colour with GColorFromRGB
    (PocoMakeColor in commodettoPocoBlit.h), an 8-bit GColor of two bits per channel,
    each the top two of the component's eight, under an opaque alpha (0b11)."""
    return 0b11 << 6 | (red >> 6) << 4 | (green >> 6) << 2 | blue >> 6


def emery_only():
    """Whether the app is built for Emery alone (package.json beside tools/)."""
    package = Path(__file__).resolve().parent.parent / 'package.json'
    return json.loads(package.read_text())['pebble']['targetPlatforms'] == ['emery']


def fold_emery(text):
    """The module with Poco's answers on Emery written in, if its `render` is theme.js's
    Poco: made here (theme.js) or imported from there under that name."""
    imported = any(specifier == 'theme' and re.search(r'[{,]\s*render\s*[,}]', clause)
                   for clause, specifier in IMPORT.findall(text))
    if not imported and not re.search(r'^export const render = new Poco\(', text, re.M):
        return text
    text = re.sub(r'\brender\.(width|height)\b(?!\s*(?:\(|=[^=]))',
                  lambda match: str(EMERY_SCREEN[match.group(1)]), text)
    channel = r'\s*(\d{1,3})\s*'

    def color(match):
        components = [int(value) for value in match.groups()]
        if max(components) > 255:
            return match.group(0)
        return str(emery_color(*components))
    return re.sub(r'\brender\.makeColor\(' + ','.join([channel] * 3) + r'\)', color, text)


def split_top(text):
    """A declaration list's items: `text` split at the commas outside brackets, strings
    and comments, the comments left out."""
    items, item, depth, index = [], [], 0, 0
    while index < len(text):
        char = text[index]
        if text.startswith(('//', '/*'), index):
            close = '\n' if text[index + 1] == '/' else '*/'
            end = text.find(close, index + 2)
            index = len(text) if end < 0 else end + len(close)
            continue
        if char in '"\'`':
            end = index + 1
            while end < len(text) and text[end] != char:
                end += 2 if text[end] == '\\' else 1
            item.append(text[index:end + 1])
            index = end + 1
            continue
        if char in '([{':
            depth += 1
        elif char in ')]}':
            depth -= 1
        elif char == ',' and not depth:
            items.append(''.join(item))
            item = []
            index += 1
            continue
        item.append(char)
        index += 1
    items.append(''.join(item))
    return items


def evaluate(expression, constants):
    """The integer `expression` comes to, or None if it is not arithmetic (+, -, *) on
    integer literals and `constants`. It is worked out as Python, whose integers agree with
    JavaScript's numbers while those are exact (to 2^53) and not a negative zero."""
    def value(node):
        if isinstance(node, ast.Constant) and type(node.value) is int:
            result = node.value
        elif isinstance(node, ast.Name):
            result = constants.get(node.id)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            result = value(node.operand)
            if result is not None and isinstance(node.op, ast.USub):
                result = -result if result else None
        elif isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult)):
            left, right = value(node.left), value(node.right)
            if left is None or right is None:
                return None
            if isinstance(node.op, ast.Mult):
                result = left * right if left * right or min(left, right) >= 0 else None
            else:
                result = left + right if isinstance(node.op, ast.Add) else left - right
        else:
            return None
        return result if result is not None and abs(result) <= 2 ** 53 else None
    # Python reads JavaScript's integer literals alike, but for a leading zero (octal), and
    # its operators, but for ++ and --, which in JavaScript count.
    if not re.fullmatch(r'[\s\w+\-*()]*', expression) or re.search(r'(?<!\w)0\d|\+\+|--', expression):
        return None
    try:
        return value(ast.parse(expression, mode='eval').body)
    except SyntaxError:
        return None


def module_constants(text):
    """The module's numeric constants, declared at its top: name -> value."""
    constants = {}
    for _, declaration in CONST.findall(text):
        for item in split_top(declaration):
            match = re.fullmatch(r'\s*(' + NAME + r')\s*=(.*)', item, re.S)
            if match:
                result = evaluate(match.group(2).strip(), constants)
                if result is not None:
                    constants[match.group(1)] = result
    return constants


def module_order(source, entry):
    order, seen = [], set()

    def visit(name):
        if name in seen:
            return
        seen.add(name)
        text = (source / (name + '.js')).read_text()
        for _, specifier in IMPORT.findall(text):
            if (source / (specifier + '.js')).exists():
                visit(specifier)
        order.append(name)

    visit(entry)
    return order


def module_exports(text):
    """The module's exports in order: (exported name, local name)."""
    exports = []
    for default, _, exported in EXPORT.findall(text):
        exports.append(('default' if default else exported, exported))
    # `export const A = 1, B = 2;` declares several names.
    for export, declaration in CONST.findall(text):
        if not export:
            continue
        for item in split_top(declaration):
            match = re.match(r'\s*(' + NAME + r')\s*=', item)
            if match and (match.group(1), match.group(1)) not in exports:
                exports.append((match.group(1), match.group(1)))
    return exports


def bindings(clause, specifier, index, numbers):
    """The `const` statement that stands in for one import clause, and, for a namespace
    import, the local name to rewrite member accesses of. An export that is a number is
    given as the number."""
    target = '$' + re.sub(r'\W', '_', specifier)
    clause = clause.strip()
    if clause.startswith('* as '):
        return f'const {clause[5:].strip()} = {target};', clause[5:].strip()
    names = []
    default, _, named = clause.partition('{')
    default = default.strip().rstrip(',').strip()
    if default:
        names.append(f'{default} = {target}[{index["default"]}]')
    if named:
        for part in named.rstrip('}').split(','):
            part = part.strip()
            if not part:
                continue
            original, _, alias = part.partition(' as ')
            original, alias = original.strip(), alias.strip() or original.strip()
            if original in numbers:
                names.append(f'{alias} = {numbers[original]}')
            else:
                names.append(f'{alias} = {target}[{index[original]}]')
    return 'const ' + ', '.join(names) + ';', None


def bundle(source, entry='main'):
    host_imports = []
    parts = []
    indexes, numbers = {}, {}
    emery = emery_only()
    for name in module_order(source, entry):
        text = (source / (name + '.js')).read_text()
        if emery:
            text = fold_emery(text)
        namespaces = []

        def replace(match):
            clause, specifier = match.groups()
            clause = ' '.join(clause.split())
            if (source / (specifier + '.js')).exists():
                statement, namespace = bindings(clause, specifier, indexes[specifier],
                                                numbers[specifier])
                if namespace:
                    namespaces.append((namespace, specifier))
                return statement
            statement = f'import {clause} from "{specifier}";'
            if statement not in host_imports:
                host_imports.append(statement)
            return ''
        text = IMPORT.sub(replace, text)
        for namespace, specifier in namespaces:
            index, number = indexes[specifier], numbers[specifier]

            def member(match):
                if match.group(1) in number:
                    # In brackets, so that a negative number stays one operand.
                    return f'({number[match.group(1)]})'
                if match.group(1) not in index:
                    sys.exit(f'{name}.js: {namespace}.{match.group(1)} is not exported by {specifier}')
                return f'{namespace}[{index[match.group(1)]}]'
            text = re.sub(r'\b' + re.escape(namespace) + r'\.([A-Za-z_$][\w$]*)', member, text)
        constants = module_constants(text)
        exports = module_exports(text)
        numbers[name] = {exported: constants[local] for exported, local in exports if local in constants}
        exports = [export for export in exports if export[0] not in numbers[name]]
        indexes[name] = {exported: position for position, (exported, _) in enumerate(exports)}
        text = re.sub(r'^export\s+(default\s+)?', '', text, flags=re.M)
        if name == entry:
            parts.append(text)
        else:
            locals_ = ', '.join(local for _, local in exports)
            parts.append(f'const ${name} = (() => {{\n{text}\nreturn [{locals_}];\n}})();\n')
    return '\n'.join(host_imports) + '\n\n' + '\n'.join(parts)


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(bundle(Path(sys.argv[1])))
