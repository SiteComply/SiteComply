#!/usr/bin/env bash
# Deploy: platform-wide status-chip nowrap hardening.
# Must be additive ONLY — a single class, nothing else.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/statuschips_deploy.zip
kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

echo "== STATUS CHIP HARDENING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
# THE core invariant: every changed line differs ONLY by the inserted class.
python3 - <<'ADDITIVE' || exit 1
import subprocess, sys
d = subprocess.run(['git','diff','-U0','HEAD~1','HEAD','--','app','components'],
                   capture_output=True, text=True).stdout
minus = [l[1:] for l in d.splitlines() if l.startswith('-') and not l.startswith('---')]
plus  = [l[1:] for l in d.splitlines() if l.startswith('+') and not l.startswith('+++')]
if len(minus) != len(plus):
    print(f"ERROR: {len(minus)} removed vs {len(plus)} added — not a 1:1 additive change"); sys.exit(1)
bad = [(a,b) for a,b in zip(minus,plus) if b.replace('whitespace-nowrap ','',1) != a]
if bad:
    print(f"ERROR: {len(bad)} line(s) changed by more than the added class:")
    for a,b in bad[:3]: print(f"   - {a.strip()[:80]}\n   + {b.strip()[:80]}")
    sys.exit(1)
print(f"      confirmed: all {len(plus)} changed lines differ ONLY by 'whitespace-nowrap'.")
ADDITIVE

# Nothing outside .tsx may change.
OUT=$(git diff --name-only HEAD~1 HEAD | grep -v '\.tsx$' || true)
[ -z "$OUT" ] && echo "      confirmed: only .tsx files changed." \
  || { echo "ERROR: non-.tsx files changed: $OUT — aborting"; exit 1; }

# Colour maps must be untouched.
for f in services/audits/auditConstants.ts services/actions/actionConstants.ts services/permits/permitConstants.ts; do
  [ -f "$f" ] || continue
  git diff --quiet HEAD~1 HEAD -- "$f" || { echo "ERROR: $f changed — aborting"; exit 1; }
done
echo "      confirmed: status colour maps unchanged."

# Toggles and numeric count badges must NOT have been swept in.
if git diff HEAD~1 HEAD -- app components | grep '^+' | grep -qE 'whitespace-nowrap.*(min-w-\[|h-6 w-11)'; then
  echo "ERROR: a toggle track or count badge was modified — aborting"; exit 1
fi
echo "      confirmed: toggles and numeric count badges untouched."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }
echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
N=$(grep -roF 'whitespace-nowrap' .next/server .next/static 2>/dev/null | wc -l)
[ "$N" -gt 50 ] && echo "      confirmed: whitespace-nowrap compiled ($N occurrences)." \
  || { echo "ERROR: only $N occurrences compiled — aborting"; exit 1; }
for c in 'bg-hivis-400/25' 'bg-safe-50' 'bg-danger-50' 'bg-brand-50'; do
  grep -rq "$c" .next/server .next/static 2>/dev/null \
    || { echo "ERROR: colour $c missing from the bundle — aborting"; exit 1; }
done
echo "      confirmed: all status colours still compiled."

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
[ "$CODE" = "200" ] && echo "== STATUS CHIP DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
