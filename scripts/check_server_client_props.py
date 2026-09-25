"""No Server Component may pass a FUNCTION prop to a 'use client' component.

Next.js cannot serialise a function across that boundary. It throws at RENDER time -
not at build time, and not at type-check time - so a page can compile, build, deploy
and then fail on every request. That is exactly what happened to the Library index:
`detailHref={(id) => ...}` type-checked, built, shipped, and threw before rendering
anything, and the deploy gate's smoke test only saw the 307 at the login redirect.

Note on the regex: `=>` contains a `>`, so a naive `[^<>]*` attribute scan stops
dead at the first arrow and finds nothing. The arrows are masked out first. The
first version of this script missed the very bug it was written for.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = ('/node_modules', '/.next', '/.git')


def tsx_files():
    for dirpath, _dirs, files in os.walk(ROOT):
        if any(s in dirpath for s in SKIP):
            continue
        for f in files:
            if f.endswith('.tsx'):
                yield os.path.join(dirpath, f)


def is_client(src: str) -> bool:
    return "'use client'" in src[:300] or '"use client"' in src[:300]


client_components = set()
for p in tsx_files():
    if is_client(open(p, encoding='utf8').read()):
        client_components.add(os.path.splitext(os.path.basename(p))[0])

ARROW = '\x00ARROW\x00'
findings = []
for p in tsx_files():
    src = open(p, encoding='utf8').read()
    if is_client(src):
        continue  # client → client is fine; the boundary is what matters
    masked = src.replace('=>', ARROW)
    for m in re.finditer(r'<([A-Z]\w+)\b([^<>]*?)/?>', masked, re.S):
        tag, attrs = m.group(1), m.group(2)
        if tag not in client_components:
            continue
        # The arrow must be the FIRST thing in the expression: `p={(x) => …}` is a
        # function, `p={xs.map((x) => …)}` is an array. An earlier version allowed
        # anything before the arrow and reported nineteen false positives, almost all
        # of them `.map()` calls.
        for a in re.finditer(
            rf'(\w+)=\{{\s*(?:async\s+)?(?:\([^()]*\)|\w+)\s*{re.escape(ARROW)}', attrs
        ):
            findings.append(
                f'{os.path.relpath(p, ROOT)}: <{tag} {a.group(1)}={{(…) => …}}> '
                '— a function cannot cross into a client component'
            )

for f in sorted(set(findings)):
    print('FUNCTION PROP:', f)
print(f'{len(set(findings))} function prop(s) crossing the server/client boundary')
sys.exit(1 if findings else 0)
