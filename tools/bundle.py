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

    python3 tools/bundle.py SOURCE_DIR OUTPUT.js

Supported module syntax (all Index uses): `import X from "m"`, `import {a, b as c} from
"m"`, `import * as n from "m"` (used as `n.name`), `export const|let|function|class`,
`export default class`. Imports of modules outside SOURCE_DIR (the Alloy host's) are kept,
deduplicated, at the top.
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


def module_exports(text):
    """The module's exports in order: (exported name, local name)."""
    exports = []
    for default, _, exported in EXPORT.findall(text):
        exports.append(('default' if default else exported, exported))
    # `export const A = 1, B = 2;` declares several names.
    for declaration in EXPORT_LIST.findall(text):
        for item in re.findall(r'(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=', declaration):
            if (item, item) not in exports:
                exports.append((item, item))
    return exports


def bindings(clause, specifier, index):
    """The `const` statement that stands in for one import clause, and, for a namespace
    import, the local name to rewrite member accesses of."""
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
            names.append(f'{alias} = {target}[{index[original]}]')
    return 'const ' + ', '.join(names) + ';', None


def bundle(source, entry='main'):
    host_imports = []
    parts = []
    indexes = {}
    for name in module_order(source, entry):
        text = (source / (name + '.js')).read_text()
        namespaces = []

        def replace(match):
            clause, specifier = match.groups()
            clause = ' '.join(clause.split())
            if (source / (specifier + '.js')).exists():
                statement, namespace = bindings(clause, specifier, indexes[specifier])
                if namespace:
                    namespaces.append((namespace, specifier))
                return statement
            statement = f'import {clause} from "{specifier}";'
            if statement not in host_imports:
                host_imports.append(statement)
            return ''
        text = IMPORT.sub(replace, text)
        for namespace, specifier in namespaces:
            index = indexes[specifier]

            def member(match):
                if match.group(1) not in index:
                    sys.exit(f'{name}.js: {namespace}.{match.group(1)} is not exported by {specifier}')
                return f'{namespace}[{index[match.group(1)]}]'
            text = re.sub(r'\b' + re.escape(namespace) + r'\.([A-Za-z_$][\w$]*)', member, text)
        exports = module_exports(text)
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
