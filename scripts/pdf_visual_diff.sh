#!/usr/bin/env bash
# Compare two directories of rendered documents, page by page, pixel by pixel.
#   ./scripts/pdf_visual_diff.sh /tmp/before /tmp/after
#
# A refactor of the document kit is only honestly "done" when this reports zero
# differing pixels — assertions cannot see a footer that stopped printing or a
# column that moved four points.
set -uo pipefail
cd "$(dirname "$0")/.."
BEFORE=${1:?before directory}
AFTER=${2:?after directory}
python3 - "$BEFORE" "$AFTER" <<'PY'
import sys, subprocess, os, glob
from PIL import Image, ImageChops

before, after = sys.argv[1], sys.argv[2]
status = 0
for pdf in sorted(glob.glob(os.path.join(before, '*.pdf'))):
    name = os.path.basename(pdf)[:-4]
    b, a = os.path.join(before, name + '.pdf'), os.path.join(after, name + '.pdf')
    if not os.path.exists(a):
        print(f'  MISSING  {name} was not rendered by the new code'); status = 1; continue
    for d, p in ((before, b), (after, a)):
        subprocess.run(['pdftoppm', '-png', '-r', '80', p, os.path.join(d, name)], check=True)
    pages_b = sorted(glob.glob(os.path.join(before, name + '-*.png')))
    pages_a = sorted(glob.glob(os.path.join(after, name + '-*.png')))
    if len(pages_b) != len(pages_a):
        print(f'  DIFFERS  {name}: {len(pages_b)} pages before, {len(pages_a)} after'); status = 1; continue
    worst = 0.0
    for pb, pa in zip(pages_b, pages_a):
        ib, ia = Image.open(pb).convert('RGB'), Image.open(pa).convert('RGB')
        if ib.size != ia.size:
            print(f'  DIFFERS  {name}: page size changed'); status = 1; break
        diff = ImageChops.difference(ib, ia)
        changed = sum(1 for px in diff.getdata() if px != (0, 0, 0))
        worst = max(worst, changed / (ib.size[0] * ib.size[1]) * 100)
    else:
        if worst == 0:
            print(f'  identical  {name} ({len(pages_a)} pages)')
        else:
            print(f'  DIFFERS    {name}: up to {worst:.3f}% of pixels changed'); status = 1
sys.exit(status)
PY
