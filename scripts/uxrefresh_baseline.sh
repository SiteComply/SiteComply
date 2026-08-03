#!/usr/bin/env bash
#
# Platform UX Refresh — STRUCTURAL BASELINE capture.
#
# Records, for every in-scope Platform screen, the measurable properties the
# refresh is meant to change (card/panel density, explanatory prose, layout
# width, scroll surface) AND the properties it must NOT change (permission
# gates, accessibility affordances, print utilities).
#
# WHY THIS EXISTS ALONGSIDE SCREENSHOTS: a screenshot shows you that something
# looks different. It cannot tell you that a permission gate went missing when a
# panel moved between grid containers — which is the single most damaging way a
# layout refactor can silently break this product. This baseline is diffable, so
# Phase 8 can prove gate-for-gate that nothing was lost.
#
# Usage:
#   scripts/uxrefresh_baseline.sh > docs/ux-refresh/baseline-<phase>.md
#
set -uo pipefail
cd /home/cc-dev-1/sitecomply || exit 1

# In-scope Platform screens, per the approved brief. Deliberately EXCLUDES the
# worker portal, check-in and admin centre (out of scope), and notes the three
# benchmark screens so their numbers are read as targets, not as offenders.
PAGES=(
  "app/platform/dashboard/page.tsx|Dashboard (not a priority)"
  "app/platform/dashboard/sites/page.tsx|Sites register"
  "app/platform/dashboard/sites/[id]/page.tsx|Site → Overview"
  "app/platform/dashboard/sites/[id]/experience/page.tsx|Site → Worker Experience  ** BIGGEST ISSUE **"
  "app/platform/dashboard/sites/[id]/compliance/page.tsx|Site → Compliance"
  "app/platform/dashboard/sites/[id]/workers/page.tsx|Site → Workers"
  "app/platform/dashboard/sites/[id]/documents/page.tsx|Site → Documents"
  "app/platform/dashboard/sites/[id]/access/page.tsx|Site → Access"
  "app/platform/dashboard/sites/[id]/setup/page.tsx|Project Setup wizard"
  "app/platform/dashboard/sites/[id]/cpp/page.tsx|CPP draft"
  "app/platform/dashboard/sites/[id]/close-out/page.tsx|Close-Out Packs (list)"
  "app/platform/dashboard/sites/[id]/close-out/[packId]/page.tsx|Close-Out Pack (document)"
  "app/platform/dashboard/compliance-calendar/page.tsx|Compliance Calendar"
  "app/platform/dashboard/compliance-calendar/schedules/page.tsx|Compliance schedules"
  "app/platform/dashboard/actions/page.tsx|Actions register"
  "app/platform/dashboard/actions/[id]/page.tsx|Action detail"
  "app/platform/dashboard/actions/new/page.tsx|New Action  ** BENCHMARK **"
  "app/platform/dashboard/audits/page.tsx|Audits register"
  "app/platform/dashboard/audits/[id]/page.tsx|Audit detail"
  "app/platform/dashboard/audits/[id]/scoring/page.tsx|Audit Scoring  ** BENCHMARK **"
  "app/platform/dashboard/audits/templates/page.tsx|Audit templates"
  "app/platform/dashboard/permits/page.tsx|Permits register"
  "app/platform/dashboard/permits/[id]/page.tsx|Permit detail"
  "app/platform/dashboard/documents/page.tsx|Documents register"
  "app/platform/dashboard/submissions/page.tsx|Check-ins register"
  "app/platform/dashboard/workers/[id]/page.tsx|Worker detail"
  "app/platform/dashboard/notifications/page.tsx|Notifications"
  "app/platform/dashboard/reports/page.tsx|Reports hub"
  "app/platform/dashboard/reports/org-overview/page.tsx|Report → Org overview"
  "app/platform/dashboard/reports/compliance-activities/page.tsx|Report → Compliance activities"
  "app/platform/dashboard/reports/scorecard/page.tsx|Report → Scorecard"
  "app/platform/dashboard/settings/page.tsx|Settings hub"
  "app/platform/dashboard/settings/config-templates/page.tsx|Settings → Config templates"
  "app/platform/dashboard/settings/permission-templates/page.tsx|Settings → Permission templates"
)

# Count a pattern in a file, always returning a single number.
# NB `grep -c` already prints 0 on no match and exits 1 — a `|| echo 0` fallback
# appends a SECOND zero and poisons the arithmetic. Swallow the exit code only.
c() { local n; n=$(grep -cE "$1" "$2" 2>/dev/null); echo "${n:-0}"; }

# Resolve the local components/ files a page imports, so nested card density is
# counted too. A page with 8 panels that each contain 6 cards is a 50-card
# screen, and only the transitive count says so.
deps() {
  grep -oE "from '@/components/[A-Za-z0-9/_-]+'" "$1" 2>/dev/null \
    | sed "s|from '@/|/home/cc-dev-1/sitecomply/|; s|'$||" \
    | while read -r p; do [ -f "${p}.tsx" ] && echo "${p}.tsx"; done
}

echo "# Platform UX Refresh — structural baseline"
echo
echo "- Baseline tag: \`rev1-complete\` (\`$(git rev-list -n1 --abbrev-commit rev1-complete)\`)"
echo "- Captured at: commit \`$(git rev-parse --short HEAD)\` on branch \`$(git rev-parse --abbrev-ref HEAD)\`"
echo "- Production BUILD_ID at capture: \`Oz4SPgNN-L-ZD8yrfQNk7\`"
echo
echo "Column meanings — **Cards** counts card/panel wrappers on the page itself;"
echo "**+Nested** adds those inside the components it imports (the number a user"
echo "actually sees). **Prose** counts explanatory paragraphs. **Gates** counts"
echo "permission expressions — *this number must never fall without a stated reason*."
echo
echo '| Screen | Lines | Cards | +Nested | Prose | Saves | Gates | a11y | print: |'
echo '|---|---:|---:|---:|---:|---:|---:|---:|---:|'

TOT_CARDS=0; TOT_NESTED=0; TOT_GATES=0

for entry in "${PAGES[@]}"; do
  f="${entry%%|*}"; label="${entry##*|}"
  [ -f "$f" ] || { echo "| $label | _missing_ | | | | | | | |"; continue; }

  lines=$(wc -l < "$f" | tr -d ' ')
  cards=$(c 'rounded-(xl|2xl|lg) border|<Section ' "$f")
  prose=$(c 'text-ink-subtle">|text-ink-muted">' "$f")
  saves=$(c '>Save|Saving…|Save changes' "$f")
  gates=$(c 'permits\(|viewerCan\(|assertModuleView|canEdit|canView|canManage|canGenerate|canClose|canReopen' "$f")
  a11y=$(c 'aria-|touch-target|sr-only' "$f")
  prnt=$(c 'print:' "$f")

  nested=$cards
  while read -r d; do
    [ -n "$d" ] || continue
    nested=$(( nested + $(c 'rounded-(xl|2xl|lg) border|<Section ' "$d") ))
  done < <(deps "$f")

  TOT_CARDS=$((TOT_CARDS+cards)); TOT_NESTED=$((TOT_NESTED+nested)); TOT_GATES=$((TOT_GATES+gates))
  echo "| $label | $lines | $cards | **$nested** | $prose | $saves | $gates | $a11y | $prnt |"
done

echo
echo "**Totals across in-scope screens — cards $TOT_CARDS, incl. nested $TOT_NESTED, permission gates $TOT_GATES.**"

# ---------------------------------------------------------------------------
# Permission-gate inventory. The refresh must not drop one. Captured verbatim so
# a later diff shows exactly which expression disappeared and from where.
# ---------------------------------------------------------------------------
echo
echo "## Permission-gate inventory"
echo
echo 'Every permission expression on every in-scope screen, verbatim. Phase 8 diffs'
echo 'this. A gate that vanishes must be explained, not explained away.'
echo
for entry in "${PAGES[@]}"; do
  f="${entry%%|*}"; label="${entry##*|}"
  [ -f "$f" ] || continue
  hits=$(grep -nE 'permits\(|viewerCan\(|assertModuleView|canEditSite|canManageContractorAccess|canGenerateCloseOutPack|canCloseProject|canReopenProject' "$f" \
         | sed 's/^[[:space:]]*//' | head -30)
  [ -n "$hits" ] || continue
  echo "### $label"
  echo '```'
  echo "$hits"
  echo '```'
done

# ---------------------------------------------------------------------------
# The shared layout primitives every screen inherits from. These are what
# Phase 1 and Phase 2 actually change; recorded so the "before" is unambiguous.
# ---------------------------------------------------------------------------
echo
echo "## Shared layout primitives at baseline"
echo
echo 'These are what Phases 1 and 2 actually change. Recorded so the "before" is'
echo 'unambiguous — every in-scope screen inherits its width and panel style here.'
echo

# Precomputed rather than inlined: complex nested quoting inside an echo is how
# a reporting script silently emits nothing.
SHELL_W=$(grep -oE 'max-w-[0-9a-z]+' components/platform/PlatformShell.tsx | head -1)
SHELL_ASIDE=$(grep -oE 'md:w-[0-9]+' components/platform/PlatformShell.tsx | head -1)
SHELL_NAVCARD=$(c 'rounded-xl border border-line bg-surface p-2 shadow-card' components/platform/PlatformShell.tsx)
SHELL_POLLER=$(c 'NotificationPoller' components/platform/PlatformShell.tsx)
SECTION_STYLE=$(grep -oE 'rounded-xl border border-line bg-surface p-5 shadow-card' components/platform/siteDetailUi.tsx | head -1)
NAV_ITEMS=$(grep -cE "href: '/platform" components/platform/PlatformNav.tsx)
NAV_GROUPS=$(c 'group:|section:|heading:' components/platform/PlatformNav.tsx)
BM_SCORING=$(grep -oE 'grid gap-4 lg:grid-cols-3' components/platform/AuditScoringConfig.tsx | head -1)
BM_CLOSEOUT=$(grep -oE 'grid gap-4 lg:grid-cols-\[1fr_380px\]' components/platform/CloseOutPackWizard.tsx | head -1)
BM_ACTION=$(grep -oE 'max-w-2xl space-y-5' components/platform/ActionForm.tsx | head -1)

echo '```'
echo "PlatformShell width cap    : ${SHELL_W:-<none>}      <- ~900px of content after the sidebar"
echo "PlatformShell sidebar      : ${SHELL_ASIDE:-<none>}"
echo "  sidebar rendered as card : ${SHELL_NAVCARD}          <- nav competing with content"
echo "  NotificationPoller mounts: ${SHELL_POLLER}          <- must stay >0 after Phase 1"
echo "Section panel style        : ${SECTION_STYLE:-<none>}"
echo "Nav items (flat)           : ${NAV_ITEMS}"
echo "Nav grouping constructs    : ${NAV_GROUPS}          <- 0 = ungrouped, addressed in Phase 1"
echo
echo "BENCHMARKS (leave alone — these are the target composition):"
echo "  Audit Scoring            : ${BM_SCORING:-<none>}"
echo "  Close-Out Pack generator : ${BM_CLOSEOUT:-<none>}"
echo "  New Action form          : ${BM_ACTION:-<none>}"
echo '```'
