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


def comment_spans(src):
    """(start, end) for every // and /* */ comment, outside string literals.

    scan_jsx pairs any '>' with the next '<', so a comment sitting between two
    unrelated angle brackets lands inside a bogus "JSX text" region. The
    punctuation test used to reject those by accident; once real prose stopped
    being rejected, the tool started rewriting comment text. Comments are out of
    scope for this migration, so exclude them explicitly rather than by luck.
    """
    out, i, n, state, start = [], 0, len(src), None, 0
    while i < n:
        c = src[i]
        if state is None:
            if src.startswith('//', i):
                state, start = '//', i
            elif src.startswith('/*', i):
                state, start = '/*', i
            elif c in '"\'`':
                state = c
        elif state == '//':
            if c == '\n':
                out.append((start, i))
                state = None
        elif state == '/*':
            if src.startswith('*/', i):
                out.append((start, i + 2))
                state = None
                i += 1
        else:
            if c == '\\':
                i += 1
            elif c == state:
                state = None
        i += 1
    if state in ('//', '/*'):
        out.append((start, n))
    return out


def outside(a, b, spans):
    """[a,b) with every span removed, as the surviving sub-ranges."""
    out, cur = [], a
    for sa, sb in sorted(spans):
        if sb <= cur or sa >= b:
            continue
        if sa > cur:
            out.append((cur, min(sa, b)))
        cur = max(cur, sb)
        if cur >= b:
            break
    if cur < b:
        out.append((cur, b))
    return [(x, y) for x, y in out if y > x]


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
    # A template literal's ${...} holes are not evidence of code. Judging the
    # WHOLE string meant every interpolated message was skipped — including an
    # AI prompt and a report subtitle that reached production still saying
    # "Workers". Test the prose around the holes instead.
    t = re.sub(r'\$\{[^{}]*\}', '', t).strip()
    if not t:
        return True
    # Prose has spaces. `worker:${workerId}` is a row key that appears in ?item=
    # URLs; renaming it would break every bookmarked selection link.
    if ' ' not in t:
        return True
    # Testing the WHOLE string for `[;={}()]` was the wrong tool and produced a
    # silent miss every time UI copy used ordinary punctuation: a parenthetical
    # aside "(including the knowledge check)", an HTML entity's semicolon
    # "the worker&rsquo;s", and a plain prose semicolon "…information; workers
    # must answer…" were all classified as code and skipped. Whether a string
    # is prose is now decided per OCCURRENCE, in `renameable()` — the only
    # question that actually matters is whether THIS "worker" is an identifier.
    if re.search(r'[;={}()]', t) and not re.search(r'[a-z]{2}\s+[a-z]{2}', t):
        return True
    if ' ' not in t and re.fullmatch(r'[A-Za-z0-9_.\[\]$-]+', t):
        return True
    if re.fullmatch(r'[a-z0-9-]+(/[a-z0-9\[\]._-]+)+', t):
        return True
    return False


def carved(s):
    return any(c in s for c in CARVE_OUT)


# "a worker" becomes "a operative" without this. Applied after substitution so it
# only ever fixes articles this tool itself created.
ARTICLE = [
    (re.compile(r'\ba (Operatives?)\b'), r'an \1'),
    (re.compile(r'\bA (Operatives?)\b'), r'An \1'),
    (re.compile(r'\ba (operatives?)\b'), r'an \1'),
    (re.compile(r'\bA (operatives?)\b'), r'An \1'),
]


# `{worker.company}` is a JSX expression and `${worker.company}` is a template
# hole — both are CODE sitting inside a run of prose, and renaming either breaks
# the page. Substitution ran over the whole run and rewrote `{worker.company}`
# to `{operative.company}`. Mask the holes, substitute the prose between them,
# then put the holes back byte-for-byte.
HOLE = re.compile(r'\$?\{[^{}]*\}')

# Everything that makes a given "worker" an IDENTIFIER rather than a word.
# Decided from the characters either side of the match, because that is what
# actually distinguishes `submission.worker` from "the worker's induction".
BEFORE_CODE = re.compile(r"""
      [.\w$/'"`-]$          # submission.worker, workerId, /worker/, 'worker-access'
    | \b(?:const|let|var|function|class|interface|type|import|from|new|await)\s+$
""", re.X)
AFTER_CODE = re.compile(r"""
    ^(?:
      \.[A-Za-z_$]           # worker.id — but NOT "the worker." ending a sentence,
                             # which this rule first read as property access
    | [:(\[/\w$'"`-]         # worker:, worker(, /worker/, worker-access
    | \s*=                    # worker = ...
    )
""", re.X)


def renameable(text, start, end):
    """Is the [start,end) occurrence of 'worker' a WORD, or an identifier?"""
    before = text[max(0, start - 24):start]
    after = text[end:end + 3]
    if BEFORE_CODE.search(before):
        return False
    if AFTER_CODE.match(after):
        return False
    return True


def sub_prose(s):
    holes = []

    def stash(m):
        holes.append(m.group(0))
        return f'\x00{len(holes) - 1}\x00'

    s = HOLE.sub(stash, s)
    for rx, rep in SUBS:
        s = rx.sub(
            lambda m: rep if renameable(m.string, m.start(), m.end()) else m.group(0),
            s,
        )
    for rx, rep in ARTICLE:
        s = rx.sub(rep, s)
    return re.sub(r'\x00(\d+)\x00', lambda m: holes[int(m.group(1))], s)


def convert(text, jsx=True):
    """
    `jsx` must be False for plain .ts. scan_jsx pairs any '>' with the next '<',
    which in TypeScript matches arrow functions and generics — and a bogus region
    spanning a real string literal advanced the cursor straight past it. That
    silently skipped every AI prompt in closeOutNarrative.ts while reporting
    success, which is the one failure this whole tool exists to avoid.
    """
    strs = scan_strings(text)
    comments = comment_spans(text)
    straddle = []
    regions = [('str', a + 1, b) for a, b in strs]
    if jsx:
        for a, b in scan_jsx(text, strs):
            # A JSX region must never straddle a string literal — a bogus region
            # spanning one advances the cursor straight past the string. But
            # DROPPING it loses any prose in it, and `{' '}` (React's trailing
            # space) sits mid-paragraph in ordinary copy, so whole paragraphs
            # went unscanned while the tool reported success. Clipping the region
            # to the gaps is NOT the fix either: scan_jsx pairs any '>' with the
            # next '<', so the gaps include real code, and clipping renamed
            # `const worker = submission.worker`. Report instead — a human reads
            # the handful this finds; nothing is changed on a guess.
            if any(not (b <= sa or a >= sb) for sa, sb in strs):
                if re.search(r'\b[Ww]orkers?\b', text[a:b]):
                    straddle.append(text[a:b])
                continue
            # Comments are precisely delimited, so clipping them out is exact —
            # unlike the '>'…'<' guess, which is why straddled STRINGS are only
            # reported above rather than clipped.
            for ca, cb in outside(a, b, comments):
                regions.append(('jsx', ca, cb))
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
    return ''.join(out), edits, review, straddle


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--files', nargs='+', required=True)
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    total = 0
    for path in a.files:
        src = open(path, encoding='utf-8').read()
        new, edits, review, straddle = convert(src, jsx=path.endswith('.tsx'))
        if straddle:
            print(f'\n  {path} — NOT SCANNED (text interrupted by a string, e.g. {{\' \'}}):')
            for frag in straddle:
                one = ' '.join(frag.split())
                print(f'      ! {one[:150]}')
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
