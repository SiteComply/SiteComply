#!/usr/bin/env bash
# Nothing structural may move during the terminology change.
#
# Excludes diff HEADERS (--- a/… +++ b/…), which name the file and therefore
# contain "worker" for any file under components/worker — an earlier version of
# this check counted those as route edits and cried wolf.
set -uo pipefail
cd /home/cc-dev-1/sitecomply
BASE="${1:-HEAD}"
fail=0
# PRODUCT CODE ONLY. The terminology tooling legitimately contains these words
# as data — its carve-out list, its check patterns, its docstring — and an
# earlier version of this guard flagged its own source as a route change.
body() {
  git diff -U0 "$BASE" -- app components services lib prisma \
    | grep -E '^[-+]' | grep -vE '^(\+\+\+|---)'
}

check() {
  local label="$1" pattern="$2"
  local n; n=$(body | grep -cE "$pattern" || true)
  if [ "$n" -gt 0 ]; then
    echo "  FAIL  $label — $n line(s):"
    body | grep -E "$pattern" | head -5 | sed 's/^/        /'
    fail=1
  else
    echo "  ok    $label"
  fi
}

check "no route paths changed"        '/(api/)?worker/|/check-in'
check "no cookie names changed"       'sc_worker'
check "no Prisma identifiers changed" '\b(WorkerSiteAssignment|WorkerAssignmentStatus|WorkerSiteRole|IssueReportPortal)\b'
check "no code identifiers changed"   '\b(workerId|workerName|getWorkerByMobile|requireWorkerContext|WorkerShell|WorkerNav|WorkerAccessManager|WorkerAssignmentActions)\b'
check "schema untouched"              'prisma/schema\.prisma'
check "CSCS card names preserved"     'Skilled Worker|Experienced Worker'
check "CDM threshold preserved"       '20\+ workers at once'
git diff --name-only "$BASE" -- prisma/schema.prisma | grep -q . && { echo "  FAIL  schema file in the changed set"; fail=1; } || echo "  ok    schema file not in the changed set"
[ "$fail" -eq 0 ] && echo "  — all immovables intact" || echo "  — IMMOVABLES VIOLATED"
exit $fail
