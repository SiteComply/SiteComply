#!/usr/bin/env bash
# Deploy: keyboard focus stays in the Feedback textarea while typing.
#
# One component. The guards exist to prove the fix is actually the fix — that no
# effect can be re-run by a caller's callback identity ever again — and that
# nothing else moved with it.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/dialogfocus_deploy.zip
DEPLOYED=69eb24f
DLG='components/ui/Dialog.tsx'
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

echo "== FEEDBACK DIALOG FOCUS FIX =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/7] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/7] SOURCE guards..."
EXPECTED="components/ui/Dialog.tsx
scripts/deploy/dialogfocus_deploy.sh
scripts/dialogfocus_verify.js"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: one component and its test." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# THE fix. No effect may depend on a callback or on `busy` — those are what
# re-ran on every keystroke.
DEPS=$(code "$DLG" | grep -o '}, \[[^]]*\]);' | sort -u)
echo "$DEPS" | grep -q 'onClose' && die "an effect still depends on onClose — the bug is back"
echo "$DEPS" | grep -q 'busy\]' && die "an effect still depends on busy"
[ "$(echo "$DEPS" | wc -l)" = "2" ] || die "expected 2 distinct dependency arrays, got: $DEPS"
echo "$DEPS" | grep -qx '}, \[open\]);' || die "the open-keyed effects are missing"
echo "$DEPS" | grep -qx '}, \[open, titleId\]);' || die "the content-change effect is missing"
echo "      no effect can be re-run by a callback identity; deps are [open] and [open, titleId]."

# The callbacks must still be REACHABLE, or Escape silently stops working —
# an absence guard alone would pass on a dialog that had lost them entirely.
code "$DLG" | grep -q 'latest.current = { busy, onClose };' || die "the ref is never updated"
code "$DLG" | grep -q 'latest.current.onClose()' || die "Escape no longer calls onClose"
code "$DLG" | grep -q '!latest.current.busy' || die "Escape no longer respects busy"
echo "      Escape still reads the CURRENT onClose and busy through the ref."

# Initial focus must prefer a text field over the close button.
code "$DLG" | grep -q 'textarea:not(\[disabled\])' || die "initial focus no longer prefers a text field"
code "$DLG" | grep -q '(field ?? focusable ?? card)?.focus()' || die "the focus fallback chain is gone"
echo "      initial focus prefers the message field, with the old behaviour as fallback."

# The trap and the focus return must both survive.
code "$DLG" | grep -q "e.key !== 'Tab'" || die "the Tab trap is gone"
code "$DLG" | grep -q 'returnTo.current?.focus?.()' || die "focus return is gone"
echo "      the Tab trap and focus return are intact."

# Nothing else moved.
for f in components/ui/ReportIssueDialog.tsx components/ui/ReportIssueButton.tsx \
         services/reports/reportDelivery.ts services/reports/reportMailer.ts \
         app/api/reports/route.ts prisma/schema.prisma; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" || die "$f changed; this deploy is the dialog only"
done
echo "      the report dialog, the button, delivery and the schema are untouched."

echo "[3/7] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"

echo "[4/7] Building..."
npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guard..."
# The selector survives minification as a string literal, so it proves the new
# focus rule is in the shipped client bundle rather than only in source.
grep -rq 'textarea:not(\[disabled\])' .next/static/chunks/ \
  || die "the new focus rule is not in the client bundle"
echo "      the new focus rule compiled into the client bundle."

echo "[5/7] Packaging zip..."
rm -f "$ZIP"; zip -qr "$ZIP" .next public package.json package-lock.json node_modules prisma next.config.js \
  -x "node_modules/.cache/*" || die "zip failed"
echo "      $(du -h "$ZIP" | cut -f1) -> $ZIP"

echo "[6/7] Deploying (async — a synchronous wait 504s on this app)..."
az webapp deploy -g "$RG" -n "$APP" --src-path "$ZIP" --type zip --async true || die "deploy failed"

echo "[7/7] Waiting for BUILD_ID $NEW_BUILD..."
for i in $(seq 1 40); do
  CUR=$(kudu_buildid); echo "      [$i] prod build id now: ${CUR:-<none>}"
  [ "$CUR" = "$NEW_BUILD" ] && { echo "      new build landed."; break; }
  sleep 15
done
[ "$(kudu_buildid)" = "$NEW_BUILD" ] || die "the new build never landed"
for i in $(seq 1 30); do
  H=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH"); echo "      [$i] health: HTTP $H"
  [ "$H" = "200" ] && break; sleep 10
done

echo "== DEPLOY SUMMARY =="
echo "   old build: $OLD_BUILD"
echo "   new build: $NEW_BUILD"
echo "   health:    HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH")"
echo "== FOCUS FIX DEPLOY COMPLETE =="
