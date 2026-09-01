#!/usr/bin/env bash
# Deploy: S3 worker mobile navigation.
#
# Guards written FRESH for this change. What must hold:
#   - the order actually changed, and Emergency info leads rather than closes
#   - every item has a short label that the accessible name still contains
#   - the strip stacks on phones and stays a row on desktop
#   - the edge indicator has NO hit area — that was the whole point of the
#     second iteration, and a stray <button> would silently undo it
#   - routes and panel filtering are untouched
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/s3nav_deploy.zip
NAV='components/worker/WorkerNav.tsx'
DEPLOYED=e0c465f

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# The component's comments describe the classes the guards look for, so SOURCE
# greps run over comment-stripped code.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== S3 NAV DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="components/worker/WorkerNav.tsx
scripts/deploy/s3nav_deploy.sh
scripts/workernav_deep_verify.js
scripts/workernav_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: one component plus its verification scripts." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# ORDER, LABELS AND ROUTES, read out of the array itself rather than grepped —
# a substring match would pass on an order that had drifted back.
code "$NAV" > /tmp/s3nav_code.tsx
python3 - /tmp/s3nav_code.tsx <<'PY' || exit 1
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
arr = s[s.index('const WORKER_NAV'):s.index('export function WorkerNav')]
items = re.findall(r"href:\s*'([^']+)'.*?label:\s*'([^']+)'.*?shortLabel:\s*'([^']+)'", arr, re.S)
want = ['/worker/dashboard','/worker/attendance','/worker/emergency','/worker/contacts',
        '/worker/bulletins','/worker/rams','/worker/documents','/worker/permits',
        '/worker/actions','/worker/inductions','/worker/site-information']
hrefs = [i[0] for i in items]
if hrefs != want:
    print('ERROR: nav order is not the approved order:'); print('  got:', hrefs); sys.exit(1)
if hrefs.index('/worker/emergency') != 2:
    print('ERROR: Emergency info is not third'); sys.exit(1)
bad = [(l, s2) for _, l, s2 in items if s2 not in l]
if bad:
    print('ERROR: short labels not contained in their accessible names:', bad); sys.exit(1)
print(f'      {len(items)} destinations, approved order, Emergency third.')
print('      every short label is a substring of its full label.')
PY

# The accessible name must come from the FULL label, not the short one on screen.
code "$NAV" | grep -qF 'aria-label={item.label}' \
  || { echo "ERROR: the link does not carry the full label as its accessible name. Aborting"; exit 1; }
code "$NAV" | grep -qF '<span className="md:hidden">{item.shortLabel}</span>' \
  || { echo "ERROR: the short label is not the phone-width text. Aborting"; exit 1; }
echo "      the full label is the accessible name at every width."

# STACKED ON PHONES, ROW ON DESKTOP, and the 52px target with its desktop reset.
code "$NAV" | grep -qF 'flex-col items-center' \
  || { echo "ERROR: phone pills are not stacked. Aborting"; exit 1; }
code "$NAV" | grep -qF 'md:flex-row' \
  || { echo "ERROR: desktop no longer lays the item out as a row. Aborting"; exit 1; }
code "$NAV" | grep -qF 'touch-target' \
  || { echo "ERROR: the 52px touch target is gone. Aborting"; exit 1; }
code "$NAV" | grep -qF 'md:min-h-0' \
  || { echo "ERROR: desktop does not reset the phone touch target. Aborting"; exit 1; }
echo "      stacked on phones, row on desktop, 52px target with a desktop reset."

# THE INDICATOR HAS NO HIT AREA. Measured at 360px and 430px, a button here
# covered 37% and 36% of the last fully-visible pill; it must stay a fade.
! code "$NAV" | grep -q '<button' \
  || { echo "ERROR: a control was added to the nav — it would steal taps from the strip. Aborting"; exit 1; }
FADES=$(code "$NAV" | grep -c 'pointer-events-none absolute inset-y-0')
[ "$FADES" = "2" ] \
  || { echo "ERROR: found $FADES edge indicators, expected 2. Aborting"; exit 1; }
code "$NAV" | grep -qF 'overflow.start ? ' && code "$NAV" | grep -qF 'overflow.end ? ' \
  || { echo "ERROR: the indicators are not driven by scroll position. Aborting"; exit 1; }
echo "      two indicators, driven by scroll position, neither of them a control."

# ROUTES AND PERMISSIONS UNTOUCHED.
code "$NAV" | grep -qF 'item.panels.length === 0 || item.panels.some((p) => panels[p])' \
  || { echo "ERROR: panel filtering changed. Aborting"; exit 1; }
code "$NAV" | grep -qF 'overflow-x-auto md:flex-col md:overflow-visible' \
  || { echo "ERROR: the scroll container's responsive behaviour changed. Aborting"; exit 1; }
echo "      panel filtering and the scroll container are unchanged."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards. WorkerNav is a client component, so its array"
echo "     compiles into the shared chunks, not any one page file..."
python3 - <<'PY' || exit 1
import os, re, sys
want = ['/worker/dashboard','/worker/attendance','/worker/emergency','/worker/contacts',
        '/worker/bulletins','/worker/rams','/worker/documents','/worker/permits',
        '/worker/actions','/worker/inductions','/worker/site-information']
hits = []
for root in ('.next/server', '.next/static'):
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith('.js'): continue
            p = os.path.join(dp, fn)
            try: s = open(p, encoding='utf-8', errors='ignore').read()
            except OSError: continue
            if '/worker/site-information' not in s or '/worker/emergency' not in s: continue
            # first occurrence order of the whole set, in this chunk
            seq = [h for h in re.findall(r'/worker/[a-z-]+', s)]
            first = {}
            for h in seq:
                first.setdefault(h, len(first))
            order = sorted((h for h in want if h in first), key=lambda h: first[h])
            hits.append((p, order))
if not hits:
    print('ERROR: no compiled chunk carries the nav array. Aborting'); sys.exit(1)
bad = [(p, o) for p, o in hits if o != want]
if bad:
    print('ERROR: compiled nav order is not the approved order:')
    for p, o in bad: print('  ', p, o)
    sys.exit(1)
print(f'      {len(hits)} chunk(s) carry the array, all in the approved order.')
PY
for want in 'shortLabel' 'Site info' 'Emergency info' 'pointer-events-none absolute inset-y-0'; do
  grep -rqF "$want" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: '$want' absent from the bundle. Aborting"; exit 1; }
done
echo "      short labels and both edge indicators compiled in."

echo "[5/8] Packaging zip..."; rm -f "$ZIP"; zip -rq "$ZIP" . -x '.git/*' -x '.env' -x '.next/cache/*' -x 'scripts/*'
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/8] Deploying..."; az webapp deploy -g "$RG" -n "$APP" --type zip --src-path "$ZIP" --async true -o none || true

echo "[7/8] Waiting for BUILD_ID ${NEW_BUILD}..."
LANDED=""; for i in $(seq 1 40); do sleep 15; CURB=$(kudu_buildid); echo "      [$i] prod build id now: ${CURB:-<unreadable>}"
  [ "$CURB" = "$NEW_BUILD" ] && { LANDED=yes; break; }; done
[ -n "$LANDED" ] || { echo "WARNING: build id not confirmed. NOT cutting over."; exit 2; }
echo "      new build landed on disk."

echo "[8/8] Cutting over..."; az webapp stop -g "$RG" -n "$APP" -o none; az webapp start -g "$RG" -n "$APP" -o none
CODE=""; for i in $(seq 1 20); do sleep 15; CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$HEALTH" || echo 000)
  echo "      [$i] health: HTTP ${CODE}"; [ "$CODE" = "200" ] && break; done

echo "== DEPLOY SUMMARY =="; echo "   old build: ${OLD_BUILD:-<unknown>}"; echo "   new build: ${NEW_BUILD}"; echo "   health:    HTTP ${CODE}"
[ "$CODE" = "200" ] && echo "== S3 NAV DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
