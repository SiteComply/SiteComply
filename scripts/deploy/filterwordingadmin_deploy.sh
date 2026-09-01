#!/usr/bin/env bash
# Deploy: Admin Check-ins adopts the same "All" default.
#
# A wording-only change, so the guards are mostly about what must NOT have moved:
# every option value stays empty, and the two unlabelled selects keep their noun.
# The risk in a "harmless" text change is that it quietly takes a value with it.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/filterwordingadmin_deploy.zip
DEPLOYED=5490190
LABELLED="app/admin/(dashboard)/submissions/page.tsx"
UNLABELLED="components/platform/SiteFilterSelect.tsx
components/platform/ComplianceCalendarShell.tsx"

kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }

# Doc comments in these files quote the option text they describe, so a raw grep
# for the old wording matches the prose explaining it. Source greps run over
# comment-stripped code, as every other deploy script here does.
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== ADMIN FILTER WORDING DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/8] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"

echo "[2/8] SOURCE guards..."
EXPECTED="app/admin/(dashboard)/submissions/page.tsx
scripts/deploy/filterwordingadmin_deploy.sh
scripts/filterwording_admin_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: only Admin Check-ins plus scripts changed." \
  || { echo "ERROR: unexpected file set:"; echo "$CH"; exit 1; }

# NOTHING BUT OPTION TEXT MOVED. Every changed line must be an <option value="">.
# Every changed line must be either an <option value=""> or a comment. Comments
# are allowed because two doc comments quote the option text and had to follow
# it; nothing else may move. This guard already caught those two edits once,
# which is the point — widening it is a decision, not a slip.
BAD=$(git diff "$DEPLOYED" HEAD -- $LABELLED $UNLABELLED | grep -E '^[+-][^+-]' \
      | grep -vE '<option value="">' \
      | grep -vcE '^[+-][[:space:]]*(\*|//|/\*)' || true)
[ "$BAD" = "0" ] \
  && echo "      every changed line is an <option value=\"\"> or a comment — no logic touched." \
  || { echo "ERROR: $BAD changed line(s) are neither option text nor comments. Aborting"; exit 1; }

# The eight labelled defaults read exactly "All".
N=$(for f in $LABELLED; do code "$f"; done | grep -c '<option value="">All</option>')
[ "$N" = "2" ] && echo "      both Admin Check-ins defaults read \"All\"." \
  || { echo "ERROR: found $N \"All\" defaults, expected 2. Aborting"; exit 1; }

# Both must still carry a VISIBLE label — that is the whole justification for
# shortening them. This page supplies it through <Field label="…">.
for lab in 'Field label="Site"' 'Field label="Compliance"'; do
  code "$LABELLED" | grep -qF "$lab" \
    || { echo "ERROR: $lab missing — the shortened default would be unexplained. Aborting"; exit 1; }
done
echo "      both keep their visible field label."

# The old wording must be gone from those four files...
for old in 'All sites' 'Any'; do
  for f in $LABELLED; do
    code "$f" | grep -qF "$old" \
      && { echo "ERROR: '$old' still present in $f. Aborting"; exit 1; }
  done
done
echo "      no labelled default still repeats its field label."

# ...and the two unlabelled ones must KEEP the noun, in sentence case.
for f in $UNLABELLED; do
  code "$f" | grep -qF '<option value="">All sites</option>' \
    || { echo "ERROR: $f does not read 'All sites'. Aborting"; exit 1; }
  code "$f" | grep -qF 'All Sites' \
    && { echo "ERROR: $f still has title-case 'All Sites' in its markup. Aborting"; exit 1; }
  code "$f" | grep -qF '<option value="">All</option>' \
    && { echo "ERROR: $f was shortened — it has no visible label. Aborting"; exit 1; }
done
echo "      both unlabelled selects keep the noun, in sentence case."

echo "[3/8] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || { echo "ERROR: prisma generate failed"; exit 1; }

echo "[4/8] Building..."; rm -rf .next; npm run build 2>&1 | tail -3
[ -f .next/BUILD_ID ] || { echo "ERROR: no BUILD_ID"; exit 1; }
NEW_BUILD=$(tr -d '[:space:]' < .next/BUILD_ID); echo "      NEW_BUILD=${NEW_BUILD}"

echo "[4b] ARTIFACT guards..."
grep -rqF '"All sites"' .next/server 2>/dev/null \
  && echo "      'All sites' compiled in (the unlabelled selects)." \
  || { echo "ERROR: 'All sites' absent from the bundle. Aborting"; exit 1; }
for gone in 'All categories' 'All priorities' 'All my sites' 'All Sites'; do
  grep -rqF "$gone" .next/server 2>/dev/null \
    && { echo "ERROR: '$gone' still compiled into the bundle. Aborting"; exit 1; }
done
echo "      no retired wording left in the bundle."

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
[ "$CODE" = "200" ] && echo "== ADMIN FILTER WORDING DEPLOY COMPLETE ==" || { echo "== HEALTH NOT 200 =="; exit 3; }
