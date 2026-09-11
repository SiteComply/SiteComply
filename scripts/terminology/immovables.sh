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
# Compare identifier COUNTS between the removed and added sides. Flagging any
# line that merely MENTIONS an identifier is wrong: changing the string
# 'Unknown worker' on a line that also reads workerName.get(...) is exactly the
# edit this migration is for, and an earlier version failed the deploy over it.
python3 - "$BASE" <<'PY' || fail=1
import re, subprocess, sys
base = sys.argv[1]
d = subprocess.run(['git','diff','-U0',base,'--','app','components','services','lib','prisma'],
                   capture_output=True, text=True).stdout.splitlines()
minus = '\n'.join(l[1:] for l in d if l.startswith('-') and not l.startswith('---'))
plus  = '\n'.join(l[1:] for l in d if l.startswith('+') and not l.startswith('+++'))
IDENT = r'\b(workerId|workerName|workerIds|getWorkerByMobile|requireWorkerContext|WorkerShell|WorkerNav|WorkerAccessManager|WorkerAssignmentActions|WorkerSiteAssignment|WorkerAssignmentStatus|WorkerSiteRole|workerSiteAssignment|sc_worker)\b'
a, b = len(re.findall(IDENT, minus)), len(re.findall(IDENT, plus))
if a != b:
    print(f"  FAIL  identifier count changed across the diff ({a} removed vs {b} added)")
    sys.exit(1)
print(f"  ok    no code identifiers changed ({a} mentions, unchanged both sides)")
PY
check "schema untouched"              'prisma/schema\.prisma'
check "CSCS card names preserved"     'Skilled Worker|Experienced Worker'
check "CDM threshold preserved"       '20\+ workers at once'
git diff --name-only "$BASE" -- prisma/schema.prisma | grep -q . && { echo "  FAIL  schema file in the changed set"; fail=1; } || echo "  ok    schema file not in the changed set"
[ "$fail" -eq 0 ] && echo "  — all immovables intact" || echo "  — IMMOVABLES VIOLATED"
exit $fail
