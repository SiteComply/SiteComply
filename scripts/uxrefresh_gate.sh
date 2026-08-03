#!/usr/bin/env bash
#
# Platform UX Refresh — FROZEN-FILES GATE.
#
# The brief says: change layout, hierarchy, density, spacing, grouping,
# navigation and presentation — and change NOTHING else. This script is the
# mechanical proof of the second half. It diffs the working tree against the
# `rev1-complete` baseline and FAILS if the refresh has reached anywhere it was
# never supposed to reach.
#
# Run it before every UX Refresh commit and before every UX Refresh deploy.
#
# Usage:
#   scripts/uxrefresh_gate.sh            # gate the working tree vs the tag
#   scripts/uxrefresh_gate.sh <ref>      # gate some other ref vs the tag
#
set -uo pipefail
cd /home/cc-dev-1/sitecomply || exit 1

TAG=rev1-complete
TARGET="${1:-}"          # empty = working tree
FAIL=0

git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null \
  || { echo "ERROR: baseline tag ${TAG} missing — cannot gate."; exit 1; }

# `git diff <tag>` with no second ref compares against the WORKING TREE, which
# is what we want by default: uncommitted layout edits are still edits.
changed() { git diff --name-only "$TAG" $TARGET -- "$@"; }

echo "== UX REFRESH GATE =="
echo "   baseline: ${TAG}"
echo "   target  : ${TARGET:-<working tree>}"
echo

# ---------------------------------------------------------------------------
# 1. Colours and branding. Every colour in this product is a CSS variable token
#    in these two files (including the CVD-validated --chart-1..6 palette). If
#    neither file changes, "colours and branding unchanged" is not a promise —
#    it is a fact about the diff.
# ---------------------------------------------------------------------------
echo "[1] Colour + branding tokens frozen"
TOKENS=$(changed app/globals.css tailwind.config.js tailwind.config.ts)
if [ -n "$TOKENS" ]; then
  echo "    FAIL — design tokens modified:"; echo "$TOKENS" | sed 's/^/          /'; FAIL=1
else
  echo "    pass — app/globals.css and tailwind.config.* untouched"
fi

# ---------------------------------------------------------------------------
# 2. Functionality, permissions, business logic, calculations, security.
#    All of it lives behind these paths. A presentation refresh has no business
#    in any of them.
# ---------------------------------------------------------------------------
echo "[2] Logic, permissions and data layer frozen"
LOGIC=$(changed services/ app/api/ prisma/ lib/prisma.ts middleware.ts)
if [ -n "$LOGIC" ]; then
  echo "    FAIL — logic/permission/data files modified:"; echo "$LOGIC" | sed 's/^/          /'; FAIL=1
else
  echo "    pass — services/, app/api/, prisma/, lib/prisma.ts, middleware.ts untouched"
fi

# ---------------------------------------------------------------------------
# 3. No database migration. This is the single property that makes the whole
#    refresh cheaply reversible — rollback is code-only because there is no data
#    state to reverse. Guard it explicitly, not just via prisma/ above.
# ---------------------------------------------------------------------------
echo "[3] No new migrations"
MIGR=$(changed prisma/migrations/)
BASE_MIGR=$(git ls-tree -r --name-only "$TAG" prisma/migrations/ | wc -l)
NOW_MIGR=$(ls -1 prisma/migrations/*/migration.sql 2>/dev/null | wc -l)
if [ -n "$MIGR" ]; then
  echo "    FAIL — migration files touched:"; echo "$MIGR" | sed 's/^/          /'; FAIL=1
else
  echo "    pass — migration set unchanged (${NOW_MIGR} migration.sql on disk)"
fi

# ---------------------------------------------------------------------------
# 4. No new dependencies. A layout refresh that needs a new runtime package is
#    a refresh that has stopped being a layout refresh.
# ---------------------------------------------------------------------------
echo "[4] Dependencies frozen"
DEPS=$(changed package.json package-lock.json)
if [ -n "$DEPS" ]; then
  echo "    FAIL — dependency manifest modified:"; echo "$DEPS" | sed 's/^/          /'; FAIL=1
else
  echo "    pass — package.json and package-lock.json untouched"
fi

# ---------------------------------------------------------------------------
# 5. Out-of-scope surfaces. The brief keeps the Worker login, Worker portal and
#    Check-In experience as they are; the Admin Centre was never in scope.
# ---------------------------------------------------------------------------
echo "[5] Worker + Admin experiences frozen"
OOS=$(changed app/worker/ app/check-in/ components/worker/ components/checkin/ app/admin/ components/admin/)
if [ -n "$OOS" ]; then
  echo "    FAIL — out-of-scope UI modified:"; echo "$OOS" | sed 's/^/          /'; FAIL=1
else
  echo "    pass — worker portal, check-in and admin UI untouched"
fi

# ---------------------------------------------------------------------------
# 6. WARNINGS — allowed, but never by accident.
#    These files are in scope for the refresh yet carry consequences beyond the
#    screen they are edited on, so a human should confirm each one deliberately.
# ---------------------------------------------------------------------------
echo "[6] High-consequence surfaces (warn, not fail)"
WARNED=0

# Rendered internally, printed, served on the PUBLIC share link, and inlined
# into the archived close-out ZIP. One edit, four audiences — one of them
# external, and one of them already sitting on someone's memory stick.
SHARED_DOC=$(changed components/platform/CloseOutPackDocument.tsx app/pack/)
if [ -n "$SHARED_DOC" ]; then
  echo "    WARN — public/archived close-out surface touched — verify all FOUR renderings"
  echo "$SHARED_DOC" | sed 's/^/          /'; WARNED=1
fi

# There is no global print stylesheet: print behaviour is Tailwind print:
# utilities scattered across these files. Every "PDF" in this product is a
# browser print of a live page, and two of them are handover documents.
PRINTERS=$(changed \
  'app/platform/dashboard/sites/[id]/cpp/page.tsx' \
  'app/platform/dashboard/sites/[id]/close-out/[packId]/page.tsx' \
  app/worker/inductions/ app/pack/ \
  components/permits/PermitActions.tsx \
  components/platform/CloseOutPackDocument.tsx \
  components/platform/EvidenceGallery.tsx \
  components/worker/PrintButton.tsx)
if [ -n "$PRINTERS" ]; then
  echo "    WARN — print-bearing file touched — print-preview before deploy"
  echo "$PRINTERS" | sed 's/^/          /'; WARNED=1
fi

# The AI narrative label and its "descriptive only" disclaimer are a deliberate
# SC-024 P3 commitment, shown on screen, in print AND in the ZIP. Condensing the
# prose is in scope; hiding the label behind a click is not.
AI=$(changed components/platform/AiNarrativeBlock.tsx components/platform/AiSummaryPanel.tsx)
if [ -n "$AI" ]; then
  echo "    WARN — AI narrative UI touched — badge + disclaimer must stay always-visible"
  echo "$AI" | sed 's/^/          /'; WARNED=1
fi

# The shell mounts NotificationPoller (the 60s live badge) and the skip link.
SHELL=$(changed components/platform/PlatformShell.tsx)
if [ -n "$SHELL" ]; then
  echo "    WARN — PlatformShell touched — confirm NotificationPoller still mounted + skip link intact"
  WARNED=1
fi

[ "$WARNED" = "0" ] && echo "    pass — no high-consequence surfaces touched"

# ---------------------------------------------------------------------------
# 7. What DID change — the refresh's actual footprint, for the record.
# ---------------------------------------------------------------------------
echo
echo "[7] Refresh footprint"
COUNT=$(git diff --name-only "$TAG" $TARGET | wc -l)
if [ "$COUNT" = "0" ]; then
  echo "    (no changes vs ${TAG})"
else
  git diff --stat "$TAG" $TARGET | tail -20 | sed 's/^/    /'
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "== GATE PASSED — the diff is presentation-only =="
  exit 0
else
  echo "== GATE FAILED — the refresh has reached out of scope =="
  exit 1
fi
