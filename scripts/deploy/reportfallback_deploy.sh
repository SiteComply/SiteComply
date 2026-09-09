#!/usr/bin/env bash
# Deploy: reports carry the experience they were filed from and the account that
# filed them there.
#
# The security-critical property this must not break: identity still comes from
# the session cookie ONLY. The body now names a portal, and the guards below
# prove that value is used to CHOOSE a cookie and never as identity itself.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
cd /home/cc-dev-1/sitecomply
RG=rgSiteComply; APP=sitecomply-web
SCM="https://${APP}.scm.azurewebsites.net"; HEALTH="https://${APP}.azurewebsites.net/api/health"
ZIP=/tmp/reportfallback_deploy.zip
DEPLOYED=8f44a7a
SVC='services/reports/reportService.ts'
RT='app/api/reports/route.ts'
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

echo "== REPORT ATTRIBUTION FALLBACK DEPLOY =="
echo "on commit: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"
echo "[1/7] Current prod build id:"; OLD_BUILD=$(kudu_buildid); echo "      OLD_BUILD=${OLD_BUILD:-<unknown>}"
[ -n "${OLD_BUILD:-}" ] || die "could not read the deployed build id"

echo "[2/7] SOURCE guards..."
EXPECTED="app/api/reports/route.ts
scripts/deploy/reportfallback_deploy.sh
scripts/reportattribution_verify.ts
services/reports/reportService.ts"
CH=$(git diff --name-only "$DEPLOYED" HEAD | sort)
[ "$CH" = "$(printf '%s' "$EXPECTED" | sort)" ] \
  && echo "      confirmed: the service, the route, the two client files." \
  || { echo "ERROR: unexpected file set:"; diff <(echo "$CH") <(printf '%s' "$EXPECTED" | sort); exit 1; }

# --- Identity STILL comes only from the cookie.
for fn in platformReporter adminReporter workerReporter; do
  code "$SVC" | grep -q "async function $fn" || die "$fn is missing"
done
code "$SVC" | grep -q 'getPlatformSession()' || die "the platform reporter no longer reads its session"
code "$SVC" | grep -q 'getAdminSession()'    || die "the admin reporter no longer reads its session"
code "$SVC" | grep -q 'getWorkerSession()'   || die "the worker reporter no longer reads its session"
# The body must never supply a name, role, org or email.
for field in 'name: body' 'role: body' 'org: body' 'email: body' 'reporterName: body' 'ref: body'; do
  code "$RT" | grep -qF "$field" && die "the route takes reporter identity from the body ($field)"
done
code "$SVC" | grep -qE 'reporterName|name:' || die "the reporter shape is gone"
echo "      identity still comes from the session cookie alone."

# --- The portal selects a cookie, and an absent session is refused.
code "$SVC" | grep -q 'if (requested === IssueReportPortal.WORKER) return workerReporter();' \
  || die "the requested portal does not select the worker session"
code "$SVC" | grep -q 'if (requested === IssueReportPortal.PLATFORM) return platformReporter();' \
  || die "the requested portal does not select the platform session"
code "$SVC" | grep -q 'if (requested === IssueReportPortal.ADMIN) return adminReporter();' \
  || die "the requested portal does not select the admin session"
# Each per-portal resolver must bail when its session is missing — that is what
# makes a spoofed portal a 401 rather than a free identity.
[ "$(code "$SVC" | grep -c 'if (!platform) return null;\|if (!admin) return null;\|if (!worker) return null;')" = "3" ] \
  || die "a per-portal resolver does not refuse a missing session"
echo "      a portal you hold no session for resolves to nothing."

# --- The rate-limit key is per portal.
code "$SVC" | grep -q 'return `${portal.toLowerCase()}:${id}`;' || die "reporterRef is not portal-prefixed"
code "$SVC" | grep -q 'where: { reporterRef, createdAt: { gte: since } }' || die "the rate limit no longer counts on reporterRef"
echo "      the rate limit counts per portal identity."

# --- The client is UNCHANGED by this deploy; it already sends its portal.
git diff --quiet "$DEPLOYED" HEAD -- components/ui/ReportIssueDialog.tsx || die "the dialog changed; this deploy is server-side only"
git diff --quiet "$DEPLOYED" HEAD -- components/ui/ReportIssueButton.tsx || die "the button changed; this deploy is server-side only"
code components/ui/ReportIssueDialog.tsx | grep -q '\.\.\.context, portal }' || die "the dialog stopped sending portal"
echo "      the client is untouched and still sends its portal."

# --- THE FIX: a client that sends no portal must infer from the page path.
code "$SVC" | grep -q 'function portalFromPath' || die "the page-path fallback is missing"
code "$SVC" | grep -q "path.startsWith('/worker')" || die "worker paths are not recognised"
code "$SVC" | grep -q "path.startsWith('/admin')" || die "admin paths are not recognised"
code "$SVC" | grep -q "path.startsWith('/platform')" || die "platform paths are not recognised"
code "$SVC" | grep -q "pagePath.split('?')\[0\]" || die "a query string would defeat the inference"
code app/api/reports/route.ts | grep -q 'resolveReporter(requestedPortal, bodyPagePath)' \
  || die "the route does not pass the page path"
# An explicit portal must stay authoritative, or spoof-refusal is lost.
code "$SVC" | grep -q 'if (requested) return byPortal;' || die "an explicit portal is no longer authoritative"
echo "      a client sending no portal is resolved from its page path."

# --- Nothing else moved.
for f in prisma/schema.prisma services/reports/reportDelivery.ts services/reports/reportMailer.ts components/ui/Dialog.tsx; do
  git diff --quiet "$DEPLOYED" HEAD -- "$f" || die "$f changed; this deploy is attribution only"
done
echo "      the schema, delivery and the dialog shell are untouched."

echo "[3/7] Generating Prisma client..."; npx prisma generate >/dev/null 2>&1 || die "prisma generate failed"
echo "[4/7] Building..."; npm run build 2>&1 | tail -3
NEW_BUILD=$(cat .next/BUILD_ID); echo "      NEW_BUILD=$NEW_BUILD"
[ "$NEW_BUILD" != "$OLD_BUILD" ] || die "the build id did not change"

echo "[4b] ARTIFACT guards..."
grep -rq '"PLATFORM"' .next/static/chunks/ || die "the portal literal is not in the client bundle"
grep -rq 'platform:\|worker:' .next/server/app/api/reports/route.js .next/server/chunks/ 2>/dev/null \
  || grep -rq 'toLowerCase()' .next/server/ || die "the prefixing is not in the server build"
echo "      the client sends a portal and the server prefixes the key."

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
echo "== ATTRIBUTION DEPLOY COMPLETE =="
