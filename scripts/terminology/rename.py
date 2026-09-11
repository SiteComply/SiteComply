#!/usr/bin/env python3
"""
Worker → Operative, in USER-FACING TEXT ONLY.

The risk in this change is not the words; it is touching anything else.
`workerId`, `getWorkerByMobile`, `/worker/dashboard`, `sc_worker`, the Prisma
models and every enum value must survive untouched. So this tool edits only
inside string literals and genuine JSX text, and refuses anything that looks
like code.

WHY A SCANNER AND NOT A REGEX. A stateless pattern treats an apostrophe inside a
comment or a double-quoted string as a string opener, swallows everything to the
next quote, and silently skips the real strings in between. The first version did
exactly that and hid an aria-label — the failure mode that makes an incomplete
rename look finished.

CARVE-OUTS are matched on content, so they hold wherever the string moves:
  * "20+ workers at once"          CDM 2015 Reg 6 notification threshold
  * "Trainee / Experienced Worker" CSCS card name, as printed on the card
  * "Skilled Worker"               CSCS card name

Bare "Worker"/"Workers" strings are REPORTED, never auto-replaced: they are
indistinguishable from an object key or an enum lookup.

  rename.py --files a.tsx b.tsx           # dry run
  rename.py --files a.tsx b.tsx --apply
"""
import argparse, re, sys

CARVE_OUT = (
    '20+ workers at once',
    'Trainee / Experienced Worker',
    'Skilled Worker',
)

SUBS = [
    (re.compile(r'\bWorkers\b'), 'Operatives'),
    (re.compile(r'\bworkers\b'), 'operatives'),
    (re.compile(r'\bWorker\b'),  'Operative'),
    (re.compile(r'\bworker\b'),  'operative'),
]


def scan_strings(src):
    """(start_quote_index, end_quote_index) for every real string literal."""
    spans, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '/':
            j = src.find('\n', i)
            i = n if j < 0 else j
        elif c == '/' and nxt == '*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif c in '\'"`':
            q, j = c, i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            if j < n:
                spans.append((i, j))
                i = j + 1
            else:
                i += 1
        else:
            i += 1
    return spans


def scan_jsx(src, str_spans):
    """Text between > and < lying outside any string."""
    def inside(pos):
        return any(a <= pos <= b for a, b in str_spans)
    out, i = [], 0
    while True:
        gt = src.find('>', i)
        if gt < 0:
            break
        lt = src.find('<', gt + 1)
        if lt < 0:
            break
        if not inside(gt) and not inside(lt):
            out.append((gt + 1, lt))
        i = gt + 1
    return out


def is_code_like(s):
    t = s.strip()
    if not t:
        return True
    if t.startswith(('/', '@/', './', '../')):
        return True
    if re.search(r'[;={}()]', t):
        return True
    if ' ' not in t and re.fullmatch(r'[A-Za-z0-9_.\[\]$-]+', t):
        return True
    if re.fullmatch(r'[a-z0-9-]+(/[a-z0-9\[\]._-]+)+', t):
        return True
    return False


def carved(s):
    return any(c in s for c in CARVE_OUT)


def sub_prose(s):
    for rx, rep in SUBS:
        s = rx.sub(rep, s)
    return s


def convert(text):
    strs = scan_strings(text)
    regions = [('str', a + 1, b) for a, b in strs]
    regions += [('jsx', a, b) for a, b in scan_jsx(text, strs)]
    regions.sort(key=lambda r: r[1])

    edits, review, out, cursor = [], [], [], 0
    for _, a, b in regions:
        if a < cursor or b < a:
            continue
        inner = text[a:b]
        out.append(text[cursor:a])
        if carved(inner):
            out.append(inner)
        elif is_code_like(inner):
            t = inner.strip()
            if re.fullmatch(r'[Ww]orkers?', t):
                review.append(t)
            out.append(inner)
        else:
            new_inner = sub_prose(inner)
            if new_inner != inner:
                edits.append((inner.strip(), new_inner.strip()))
            out.append(new_inner)
        cursor = b
    out.append(text[cursor:])
    return ''.join(out), edits, review


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', nargs='+', required=True)
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    total = 0
    for path in a.files:
        src = open(path, encoding='utf-8').read()
        new, edits, review = convert(src)
        if review:
            print(f'\n  {path} — NEEDS A DECISION (bare word, not auto-replaced):')
            for r in sorted(set(review)):
                print(f'      ? {r!r} — replace by hand if it is a label, leave if it is a key')
        if not edits:
            continue
        total += len(edits)
        print(f'\n  {path}  ({len(edits)} edit{"" if len(edits) == 1 else "s"})')
        for old, nw in edits:
            print(f'      - {old[:96]}')
            print(f'      + {nw[:96]}')
        if a.apply:
            open(path, 'w', encoding='utf-8').write(new)
    print(f'\n  {total} edit(s) {"APPLIED" if a.apply else "proposed (dry run)"}')
    return 0


sys.exit(main())
