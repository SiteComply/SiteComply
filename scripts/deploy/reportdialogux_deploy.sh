#!/usr/bin/env bash
# Deploy: the report dialog loses its context panel and gains clearer guidance.
#
# Content and layout only. The guards exist mostly to prove what did NOT change:
# the context is still captured and still sent, and only its disclosure is gone.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/reportdialogux_deploy.zip
DEPLOYED=ef09ad2
DLG='components/ui/ReportIssueDialog.tsx'
die() { echo "ERROR: $1. Aborting"; exit 1; }
kudu_buildid() { local tok; tok=$(az account get-access-token --query accessToken -o tsv 2>/dev/null) || return 1
  curl -s --max-time 20 -H "Authorization: Bearer $tok" "${SCM}/api/vfs/site/wwwroot/.next/BUILD_ID" 2>/dev/null | tr -d '[:space:]'; }
code() { python3 - "$1" <<'DOCPY'
import re, sys
s = open(sys.argv[1], encoding='utf-8').read()
s = re.sub(r'\{\s*/\*.*?\*/\s*\}', '', s, flags=re.S)
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'(?m)^\s*//.*$', '', s)
sys.stdout.write(s)
DOCPY
}

echo "== REPORT DIALOG UX DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/7] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/7] SOURCE guards..."
EXPECTED="components/ui/ReportIssueDialog.tsx
scripts/deploy/reportdialogux_deploy.sh"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the dialog and this script. Nothing else." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- The panel is gone, root and branch.
code "$DLG" | grep -q 'Sent automatically with your report' && die "the context panel text is still there"
code "$DLG" | grep -q 'setShowContext' && die "the showContext state survived"
code "$DLG" | grep -q 'contextLine' && die "the contextLine memo survived"
echo "      the panel, its state and its memo are all gone."

# --- The guidance is there, and is NOT duplicated as a placeholder.
code "$DLG" | grep -q 'Please provide as much detail as possible about the bug, feedback or suggestion.' \
  || die "the guidance line is missing"
[ "$(code "$DLG" | grep -c 'as much detail as possible')" = "1" ] \
  || die "the guidance appears more than once — the placeholder duplicate is back"
code "$DLG" | grep -q 'placeholder=' && die "a placeholder was reintroduced"
code "$DLG" | grep -q 'aria-describedby="report-help report-count"' \
  || die "the guidance is not announced before the counter"
code "$DLG" | grep -q 'id="report-help"' || die "the guidance has no id to be described by"
echo "      one guidance line, announced, with no placeholder duplicate."

# --- BEHAVIOUR UNCHANGED: the context is still captured and still sent.
code "$DLG" | grep -q '\.\.\.context, portal }' || die "the context is no longer sent with the report"
code "$DLG" | grep -q 'context: ReportContext | null;' || die "the dialog no longer accepts context"
code "$DLG" | grep -q "fetch('/api/reports'" || die "the submit path changed"
code "$DLG" | grep -q 'DESCRIPTION_MIN' || die "the minimum-length rule was lost"
grep -q 'buildId: currentBuildId()' services/reports/reportService.ts || die "the server stopped storing context"
echo "      context is still captured and still sent; only its disclosure is gone."

# --- Nothing else moved.
for f in components/ui/Dialog.tsx components/ui/ReportIssueButton.tsx app/api/reports/route.ts \
         services/reports/reportService.ts prisma/schema.prisma; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" || die "$f changed; this deploy is the dialog only"
done
echo "      the shell, the button, the route, the service and the schema are untouched."

echo "[3/7] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/7] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq 'as much detail as possible' .next/static/chunks/ || die "the guidance is not in the client bundle"
grep -rq 'Sent automatically with your report' .next/static/chunks/ && die "the old panel text is still in the bundle"
grep -rq 'Tell us what you expected' .next/static/chunks/ && die "the old placeholder is still in the bundle"
echo "      the new copy is in the bundle and both old strings are gone."

echo "[5/7] Packaging zip..."
rm -f "$ZIP"; zip -qr "$ZIP" .next public package.json package-lock.json node_modules prisma next.config.js -x "node_modules/.cache/*" || die "zip failed"
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/7] Deploying (async — a synchronous wait 504s on this app)..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async true || die "deploy failed"

echo "[7/7] Waiting for BUILD_ID $NEW_BUILD..."
for i in $(seq 1 40); do
  CUR=$(kudu_buildid); echo "      [$i] prod build id now: ${CUR:-<none>}"
  [ "$CUR" = "$NEW_BUILD" ] && { echo "      new build landed."; break; }; sleep 15
done
[ "$(kudu_buildid)" = "$NEW_BUILD" ] || die "the new build never landed"
for i in $(seq 1 30); do H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "      [$i] health: HTTP $H"; [ "$H" = "200" ] && break; sleep 10; done

echo "== DEPLOY SUMMARY =="
echo "   old build: $OLD_BUILD"
echo "   new build: $NEW_BUILD"
echo "   health:    HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH")"
echo "== DIALOG UX DEPLOY COMPLETE =="
