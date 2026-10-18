#!/usr/bin/env python3
"""Bundle Index's JavaScript modules into one module for the watch.

The source stays split into readable ES modules (src/embeddedjs/*.js). On the watch, XS
links every module of a mod at launch, and that linking briefly needs far more memory
than the app itself: with eleven modules the slot heap peaked near 55 KB while loading
and settled at 37 KB, and XS never returns heap to the app. That peak left too little of
the app's 122 KB for the native side (vector art, the dictation session). Bundling turns
each module into a function scope inside one module, which loads in a fraction of that.

    python3 tools/bundle.py SOURCE_DIR OUTPUT.js

Supported module syntax (all Index uses): `import X from "m"`, `import {a, b as c} from
"m"`, `import * as n from "m"`, `export const|let|function|class`, `export default class`.
Imports of modules outside SOURCE_DIR (the Alloy host's) are kept, deduplicated, at the top.
"""
from pathlib import Path
import re
import sys

IMPORT = re.compile(r'^import\s+([^;]+?)\s+from\s+"([^"]+)";[ \t]*$', re.M | re.S)
EXPORT = re.compile(r'^export\s+(default\s+)?(const|let|function|class)\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_LIST = re.compile(r'^export\s+const\s+(.+?);\s*$', re.M)


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


def bindings(clause, specifier, local):
    """The `const` statement(s) that stand in for one import clause."""
    target = '$' + re.sub(r'\W', '_', specifier)
    if not local:
        return None
    lines = []
    clause = clause.strip()
    if clause.startswith('* as '):
        return [f'const {clause[5:].strip()} = {target};']
    default, _, named = clause.partition('{')
    default = default.strip().rstrip(',').strip()
    if default:
        lines.append(f'const {default} = {target}.default;')
    if named:
        names = []
        for part in named.rstrip('}').split(','):
            part = part.strip()
            if not part:
                continue
            original, _, alias = part.partition(' as ')
            names.append(f'{original.strip()}: {alias.strip()}' if alias else original.strip())
        lines.append('const {' + ', '.join(names) + '} = ' + target + ';')
    return lines


def bundle(source, entry='main'):
    host_imports = []
    parts = []
    for name in module_order(source, entry):
        text = (source / (name + '.js')).read_text()
        def replace(match):
            clause, specifier = match.groups()
            if (source / (specifier + '.js')).exists():
                return '\n'.join(bindings(' '.join(clause.split()), specifier, True))
            statement = f'import {' '.join(clause.split())} from "{specifier}";'
            if statement not in host_imports:
                host_imports.append(statement)
            return ''
        text = IMPORT.sub(replace, text)
        exports = []
        for default, _, exported in EXPORT.findall(text):
            exports.append(f'default: {exported}' if default else exported)
        # `export const A = 1, B = 2;` declares several names.
        for declaration in EXPORT_LIST.findall(text):
            for item in re.findall(r'(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=', declaration):
                if item not in exports:
                    exports.append(item)
        text = re.sub(r'^export\s+(default\s+)?', '', text, flags=re.M)
        if name == entry:
            parts.append(text)
        else:
            parts.append(f'const ${name} = (() => {{\n{text}\nreturn {{{", ".join(exports)}}};\n}})();\n')
    return '\n'.join(host_imports) + '\n\n' + '\n'.join(parts)


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(bundle(Path(sys.argv[1])))
