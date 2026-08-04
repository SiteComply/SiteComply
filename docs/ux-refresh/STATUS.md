# Platform UX Refresh — status

**Complete. All ten phases delivered, deployed and approved in production.**
Last deploy: Phase 10, `de2ae9b`, BUILD_ID `WneGsp7jepw0Gk8KDw_Wv`, 2026-08-04.

Branch `feature/ux-refresh`, based on tag `rev1-complete` (`44841c5`). Not merged to
`main` — no merge or PR was requested.

## What it was

A presentation-only refresh of the Platform experience, taken on immediately after
REV-1 closed. **In scope:** layout, visual hierarchy, information density, spacing,
grouping, navigation, presentation. **Frozen:** functionality, workflows, permissions,
business logic, calculations, report figures and exports, security, database structure,
colours, branding, and the worker portal / check-in / Admin Centre.

**No migration was ever run**, by design — that is what keeps rollback code-only.

## Measured outcome

| | at `rev1-complete` | now |
|---|---|---|
| Card wrappers on in-scope pages | 112 | **85** |
| Including nested components | 494 | **451** |
| Permission gate expressions | 157 | **158** |

The gate count went **up** by one, and only because a single existing gate gained a
second usage. Nothing was lost. That inventory exists because the top functional risk
in a layout refactor is losing a gate while moving JSX between containers — it fails
silently, and would show a contractor a manager's controls. Screenshots cannot catch
it; a diffable inventory can. See `baseline-phase0.md` … `baseline-phase10.md`.

Two figures worth keeping for context: the Worker Experience tab went from 3,895px to
1,080px (72% shorter), and content width on a 1920 display went from 888px to 1600px
with dead space either side falling from 400px to 40px.

## Phases

| Phase | Commit | BUILD_ID | What changed |
|---|---|---|---|
| 0 | `ee9cf4e` | — | Rollback point, frozen-files gate, structural baseline |
| 1 | `90ba5de` `a36f442` | `LeWYinwMIhxeH5ZEFunQK` | Application frame: rail instead of a floating card, width cap moved off the portal, shared `PageHeader`, nav clustered |
| 2 | `0fa7c27` | `YYio--Ekelu-MKW5oIwpn` | Shared primitives extracted from the benchmark screens: `Panel`, `TableSurface`, `RecordHeader` |
| 3 | `73cc428` | `j1gr6ZpiQv18eTjpRmi4Q` | Worker Experience becomes one workspace (`SectionWorkspace`) |
| 4 | `26d634b` | `QgxdleAao662Q2XulESt8` | Site Details reads as one project workspace; two presentation defects fixed |
| 5 | `7dce8cb` | `Aemsj-gnwZwTj_n9coepm` | The `WorkSurface` master–detail pattern; last row-card register becomes a table |
| 5b | `59806e7` `940bd2f` | `JKBCo5PYPvZNa7miFYZlX` | Compliance becomes one outstanding-work surface |
| 5c | `9e5337f` | `-kthP6exH_uAFVA4I5PFH` | Workers becomes one project roster |
| 6 | `34ab782` | `lAk5A6KozCu21fF_VkKbj` | Report composition and AI narrative density |
| 7 | `6b8bf8b` | `YrwGQOER-GS1k38AXLoT6` | Settings libraries, CPP reading measure, **application chrome no longer prints** |
| 8 | `034e468` | `H_t9PlI8Ss3MNL4S8JyUQ` | Settings workspace, mobile header fix, consistency sweep |
| 9 | `c6a9f9f` | `5yiKpUQnxn5WpbisuTs51` | Navigation grouping: rules, spacing and labels on every navigator |
| 9a | `c1e6715` | `AE09EU9Q1cVy3EVE8eyKx` | The calendar nav entry is "Calendar", not "Compliance" |
| **10** | `de2ae9b` | `WneGsp7jepw0Gk8KDw_Wv` | **The work-surface rail follows the selection** |

### Phase 10 — the work-surface rail follows the selection

Site → Compliance and Site → Workers held a 22rem detail column open on every visit,
selected or not. The default state of both screens was a table squeezed into three
quarters of the measure beside a card containing one sentence. Master–detail earns its
second column when there *is* a detail; before that it is a reservation.

- Nothing selected → one column, the table takes the whole measure.
- Something selected → the rail appears, **wider than before** (22rem → 24rem), its
  border tinted to match the highlighted row so the pair reads as one thing.

Measured at 1920: the default table goes **1165px → 1534px (+32%)** and the empty rail
card disappears. Changed in `WorkSurface` itself, so the Check-ins register gains the
same default from the same definition rather than drifting.

`resolveSelected` still refuses to pre-select the first row. That is what makes the
full-width default honest rather than a trick, and it remains the Phase 5 safety
property: a guessed or stale `?item=` shows the plain list and confirms nothing.

## Invariants, and how they are held

- **`scripts/uxrefresh_gate.sh`** — the mechanical proof of "presentation only". Fails
  on any change to design tokens, `services/`, `app/api/`, `prisma/`, `lib/prisma.ts`,
  `middleware.ts`, migrations, dependencies, or the worker and admin UI. Run it before
  every commit and every deploy.
- **`scripts/uxrefresh_deploy.sh`** — per-phase guards, `[3]` through `[5l]`. Each
  asserts something a layout refactor breaks silently: gates still present, panels
  still rendered, merged lists still not merging permissions, the AI disclaimer still
  outside any disclosure, chrome still `print:hidden`, no navigator holding a rail
  column open. Every assertion has been negative-tested.
- **`scripts/uxrefresh_nav_check.ts`** — 35 checks over the real permission matrix:
  all 8 roles, all 64 Worker Experience visibility combinations, all 17 setup steps.
  Run with `npx tsx --tsconfig scripts/tsconfig.navcheck.json scripts/uxrefresh_nav_check.ts`.
- **Accessibility and print** were verified per phase across 36 screens: one `h1`, skip
  link, no heading jumps, no nameless controls, no console errors — and every "PDF" in
  this product is a browser print of a live page, so print output was re-rendered as an
  actual PDF whenever the shell changed.

## Rollback

`scripts/uxrefresh_rollback.sh --drill | --confirm`, documented in `ROLLBACK.md`.
Code-only, roughly 10–12 minutes: the B1 plan has no deployment slots, and there is no
migration to reverse. The script builds from a **separate clean worktree at the tag**,
because the deploy scripts zip the working tree — rolling back from a refresh checkout
would otherwise ship the refresh.

`npm run build` mints a random BUILD_ID every run, so a rollback never reproduces an
old id. The ids above prove *cutover*, not byte-identity.

## Deferred — not defects, not scheduled

1. **A control to clear a work-surface selection.** Today you clear it by editing the
   URL. Reviewed and deliberately deferred at Phase 10: it would be new functionality,
   not presentation. Treat as a future usability enhancement.
2. **`WorkerAccessManager`** (723 lines) is untouched; folding its per-row actions into
   the roster rail would finish the Workers workspace.
3. **Phase 3's config components** stretch their fields to the full 1600px.
4. **Two residual mobile horizontal scrolls** (documents, knowledge-check), with no
   element escaping its container. Twelve screens scrolled sideways before Phase 8; two
   do now.
5. **Grouping the Reports catalogue** would require reordering it, since its registry
   order does not fall into contiguous themes — a content decision, not a spacing one.
