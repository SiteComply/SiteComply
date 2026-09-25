import os, re, sys
ROOT = '/home/cc-dev-1/sitecomply'
def resolve(spec):
    base = spec.replace('@/', '')
    for ext in ('.ts', '.tsx'):
        p = os.path.join(ROOT, base + ext)
        if os.path.isfile(p):
            return base + ext
    return None
VALUE_IMPORT = re.compile(r"^import\s+(?!type\b)(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+'(@/[^']+)'", re.M)
def chain_to_prisma(path, seen, trail):
    if path in seen:
        return None
    seen.add(path)
    try:
        src = open(os.path.join(ROOT, path), encoding='utf8').read()
    except OSError:
        return None
    if re.search(r"^import\s+\{[^}]*prisma[^}]*\}\s+from\s+'@/lib/prisma'", src, re.M):
        return trail + [path]
    for m in VALUE_IMPORT.finditer(src):
        nxt = resolve(m.group(1))
        if nxt:
            got = chain_to_prisma(nxt, seen, trail + [path])
            if got:
                return got
    return None
bad = []
for dirpath, _dirs, files in os.walk(ROOT):
    if any(s in dirpath for s in ('/node_modules', '/.next', '/.git')):
        continue
    for f in files:
        if not f.endswith('.tsx'):
            continue
        p = os.path.join(dirpath, f)
        head = open(p, encoding='utf8').read(400)
        if "'use client'" not in head and '"use client"' not in head:
            continue
        rel = os.path.relpath(p, ROOT)
        got = chain_to_prisma(rel, set(), [])
        if got:
            bad.append(' -> '.join(got))
for b in bad:
    print('LEAK:', b)
print(f'{len(bad)} client component(s) value-import the Prisma CLIENT')
sys.exit(1 if bad else 0)
