# SiteComply — handover

Written 2026-08-05. If you are picking this project up, read this first, then
`docs/ux-refresh/STATUS.md` and `docs/RBAC.md`.

---

## 1. What it is

Digital site inductions, check-in and H&S compliance for UK construction. Three
distinct audiences share one Next.js application:

| Area | Route prefix | Who uses it | Auth |
|---|---|---|---|
| **Worker portal** | `/worker`, `/check-in` | site operatives, on phones | SMS one-time passcode |
| **Platform** | `/platform` | site managers, directors, auditors, clients | email/SMS one-time passcode |
| **Admin centre** | `/admin` | internal administration | separate admin login |

The worker journey is the product's centre of gravity: a worker scans in, completes
an induction, answers a knowledge check, signs a declaration and checks in — in
under two minutes, on a phone, possibly with gloves on and poor signal. Most design
decisions in this codebase resolve in favour of that user.

The Platform is where the evidence of all that is managed: sites, workers, audits,
findings, corrective actions, permits, documents, compliance scheduling, reporting,
and the close-out pack handed to a client at the end of a project.

---

## 2. Where it is right now

| | |
|---|---|
| **Live** | https://app.sitecomply.co.uk (`sitecomply-web.azurewebsites.net`) |
| **Production build** | `THdLZ5mSLDN-yCL_iDAzF`, health 200 |
| **`main`** | `b7d0a88`, in sync with GitHub, 406 commits |
| **Rollback tag** | `rev1-complete` → `44841c5` |
| **Delivered** | REV-1 (SC-001…SC-025), the Platform UX Refresh (phases 0–10), the readiness-review reporting fixes, and BL-001 — all approved and live |
| **In flight** | nothing. No branch is awaiting a deploy decision and no work is part-shipped |
| **Last verified** | 28 August 2026 — build id, `main`/`origin` parity and App Service configuration read from the live environment, not from notes |

Everything approved is merged into `main`, and `main` is what production is built
from. There is no staging environment.

---

## 3. Stack and shape

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind · Prisma + PostgreSQL ·
Azure. **Ten runtime dependencies.** That is deliberate and worth preserving — see §6.

```
app/          101 pages, 129 API routes
components/   131 components  (components/platform, /worker, /checkin, /ui)
services/     161 modules     — all business logic lives here, never in components
prisma/       72 models, 54 migrations
scripts/      113 operational scripts (see §5)
docs/         RBAC, reports, AI summaries, UX refresh baselines
```

The layering rule that actually holds: **components render, services decide.**
Permission checks, scoping and business rules live in `services/` and are re-checked
in API routes; a component never decides what a viewer may see, it is handed
already-authorised content.

### Authorisation, in one paragraph

Every Platform read is scoped twice: by **module permission** (`permits(role, module,
verb)`) and by **assigned sites** (a viewer only ever sees sites in `viewer.siteIds`).
SC-022 added per-site permission overrides on top of the role baseline —
`viewerCan(viewer, module, verb, siteId)` is the effective check and the one to use.
Out-of-scope records return **404, not 403**, so the existence of a record is never
confirmed to someone who should not know about it. `docs/RBAC.md` is current.

---

## 4. Running it locally

**This machine has no passwordless sudo.** Node, git and PostgreSQL were installed
without root and are reached through wrappers in `~/.local/bin`, which is already on
PATH. Non-interactive shells do not source `~/.bashrc`, so rely on those wrappers
rather than expecting shell config to apply.

```bash
~/sitecomply/scripts/local-db.sh start     # local PostgreSQL 16
npm run dev                                # dev mode — admin dev sign-in works
npm run build && npx next start -p 3002    # production mode
```

`next start` runs with `NODE_ENV=production`, which disables dev-only fallbacks and
requires `SESSION_SECRET`. Use `next dev` when you need the admin dev sign-in.

**Local migration bookkeeping is not clean-replayable.** The local database was
built with `db push`, so `prisma migrate dev` and `migrate deploy` both fail against
it. To add a migration: hand-write `prisma/migrations/<ts>_<name>/migration.sql`,
apply it with `psql -v ON_ERROR_STOP=1 -f <file>`, then
`prisma migrate resolve --applied <name>`, then `prisma generate`.

**Local sign-in codes.** The SMS provider is a console mock, so
`POST /api/worker/otp/request` returns the code in `devCode`. The Platform dev login
code is hard-coded `123456`.

---

## 5. How deployment works

There is no CI/CD pipeline. Deployment is a script that **zips the working tree** and
pushes it to Azure App Service:

```bash
scripts/sc0XX_deploy.sh          # per-feature code deploy
scripts/sc0XX_migrate.sh         # additive migration, run BEFORE the deploy
scripts/uxrefresh_deploy.sh      # the UX refresh's own guarded deploy
```

Each script follows the same shape: read the current production `BUILD_ID` → assert
the change is present and its invariants hold → build → zip → `az webapp deploy` →
wait for the `BUILD_ID` on disk to flip → stop/start → health-check.

### Things that will bite you

- **The zip is the WORKING TREE, not `HEAD`.** Uncommitted edits ship. This mattered
  less when work happened on throwaway branches; now that deploys run from `main`, a
  dirty tree ships to production. Check `git status` before deploying.
- **A deploy takes 8–10 minutes** and exceeds most command timeouts. Run it in the
  background. If a deploy is killed mid-run, **check the state before assuming it
  failed** — the zip upload and restart often completed and only the health-check
  loop was cut short.
- **`npm run build` mints a random `BUILD_ID` every run**, so a rollback never
  reproduces an old id. The recorded ids prove *cutover*, not byte-identity.
- **The B1 plan has no deployment slots.** Cutover is a stop/start, so expect ~30–60s
  of `503` and one or two cold starts afterwards. A single 503 shortly after a deploy
  is not a failure — re-poll before concluding anything.

### Verifying a client-side change actually shipped

Because the deploy builds from the working tree, the local `.next` **is** the
deployed build. Fetch the same chunk path back from production and `cmp` it:

```bash
CH=$(grep -rl "some distinctive string" .next/static/chunks/ | head -1)
curl -s -o /tmp/prod.js "https://sitecomply-web.azurewebsites.net/_next/static${CH#.next/static}"
cmp "$CH" /tmp/prod.js && echo IDENTICAL
```

---

## 6. Conventions that are load-bearing

These are not style preferences. Breaking them has caused real defects here.

**Additive migrations only, and features ship dark.** Every migration to date is
additive; new capability defaults to *off* (`scoringEnabled`, `knowledgeCheckEnabled`,
`inductionSignatureRequired`, GPS, per-site service availability). A site that has not
opted in behaves exactly as before, which is what makes deployment low-risk and
backfill unnecessary.

**No new dependencies without a strong reason.** The signature pad, photo annotator,
donut chart and date picker are all hand-written. There is no PDF library — every
"PDF" in this product is a browser print of a live page. That means **any change to
application chrome can silently corrupt a handover document**: if you touch the
shell, render the PDF and look at it.

**One definition of each idea.** Shared primitives (`Panel`, `TableSurface`,
`RecordHeader`, `WorkSurface`, `SectionWorkspace`, `navUi`) exist because the same
concept was previously typed out three times and drifted. If you find yourself
copying markup, extract it.

**Deploy guards, and negative-test them.** Each deploy script asserts the invariants
that a change could silently break. A guard you have not seen fail is not a guard —
break the thing deliberately, watch the guard fire, then restore. Several guards in
this repo exist because a bug shipped that they would have caught.

**Assert on structure, never on prose.** Guards run against source with comments
stripped. Three separate times, an assertion matched the comment explaining it rather
than the code — including once where a deleted function call still "passed" because
the comment named it.

**The screen is not evidence.** Verify the stored artefact. A canvas that looks
correct can still encode a blank JPEG; an evidence route can look wired while the
metadata is never recorded. Check the database or the stored blob after the click.

---

## 7. What has been delivered

### REV-1 — SC-001 … SC-025 (complete, approved)

Smart Check card verification · daily bulletins · worker dashboard · post-check-in
experience · AI knowledge checks · induction validity and re-induction · GPS check-in
validation · site information · digital permits to work · attendance and timesheets ·
digital induction acceptance with signature · induction question cleanups · audit
templates · **customisable audit scoring (SC-014)** · mandatory action assignment ·
assignment notifications · **photo annotation (SC-017)** · toolbox-talk removal ·
site setup wizard and Construction Phase Plan · **compliance scheduler (SC-020,
4 phases)** · site-specific service configuration · contractor permission management ·
worker invitation and site access · **project close-out pack (SC-024)** · project
completion and archive.

Per-item implementation notes live in the commit messages, which are unusually
detailed and are the best record of *why* each thing is shaped as it is.

### Platform UX Refresh — phases 0–10 (complete, approved)

A presentation-only refresh: layout, hierarchy, density, navigation. Frozen
throughout: functionality, permissions, business logic, report figures, colours,
branding, and the worker portal. **No migration was ever run**, which is what kept
rollback code-only.

Measured outcome: card wrappers **112 → 85** on in-scope pages (494 → 451 including
nested components), permission gates **157 → 158** — *up* by one, because one existing
gate gained a second usage. Nothing was lost. `docs/ux-refresh/STATUS.md` has the
per-phase record; `baseline-phase*.md` are the diffable structural snapshots that
proved no gate went missing.

### Follow-ups since (all live)

- **SC-002** — acknowledging a bulletin now refreshes the page state; the card
  disappeared but the read state and unread badge did not.
- **SC-017** — annotated photos: the annotation link was *never being recorded*
  (both evidence routes imported the parser and never called it); superseded
  originals are now kept out of viewing and reporting; photos can be annotated while
  writing a finding; the export is taken from the visible canvas and a blank export
  is refused rather than stored.
- **SC-020** — a single month/year date picker on the Compliance Calendar, and
  deleting an audit now returns its compliance activity to *Scheduled* instead of
  leaving it stuck as in-progress on the calendar and counted as completed work.
- **SC-014** — "Configure scoring" moved into the audit header; it used to sit
  inside a panel that only rendered for audits created from a template, so audits
  created from scratch had no route to it at all.
- **BL-001 — authorised manual check-out** (28 Aug 2026). A check-in could only be
  closed by the worker who opened it, so a forgotten one stayed open forever and the
  on-site count — the site's **fire roll** — stayed overstated, with project closure
  hard-blocked behind it. Director, Site Manager, Project Manager and Principal
  Contractor can now close an open check-in with a mandatory reason, recorded as a
  permanently and visibly manual event. `checkedInAt` is never touched,
  `checkedOutAt` is never backdated, and time on site is not reported for a manual
  close. **Behaviour, RBAC, audit trail and UI: `docs/ATTENDANCE-OVERRIDE.md`.
  Day-to-day operation: `docs/ATTENDANCE-OPERATIONS.md`.**

### Readiness-review reporting fixes (all live)

The REV-1 production readiness review (against `a893bfe`) raised a set of severity-coded
findings. The ones that affected what a figure *means* were fixed and deployed:

- **Export accuracy — compliance activities and check-ins** (`6dea10f`, live 27 Aug 2026).
  `getComplianceActivityRows` took at most 2000 rows and the page derived its total from
  the *length* of that capped set, so above 2000 it reported 2000 as the total — while
  telling the user to "export CSV for all". The check-ins export hand-rolled its own
  query and ignored the status and site filters the screen was showing. Both now count
  properly and the export carries the active filters; the activities export refuses
  above `ACTIVITY_EXPORT_MAX_ROWS` with a 413 rather than silently truncating.
- **Unscored audits no longer read as Fail; no-data sites no longer read as 0%**
  (`81cd595`, live 28 Aug 2026). Two instances of the same null-versus-zero mistake:
  an audit that was never scored was classified as a failure, and a site with no
  compliance data in the period was reported as 0% compliant. Percentages now return
  `null` for an empty denominator in both Organisation Overview and the Scorecard, and
  exports carry blanks rather than zeros. **A production backfill was run** for the
  audit result field and applied to one audit.
- **Annotated document pairs no longer double-count** (`7cedb3b`, live 28 Aug 2026).
  The register, audit picker and Worker Portal already collapsed an annotated pair into
  one document; seven other reads did not, so the same upload was counted twice in
  recent activity, the close-out pack count and rows, the close-out ZIP, the closure
  checklist and expiry notifications. All now use the existing `supersededDocumentIds`
  helper, and exclude in the query rather than after it so a filtered pair cannot
  quietly shorten a capped feed or pack.

Deliberately **not** taken, by decision: the remaining Medium and Low findings —
Organisation Overview mixing range-scoped and all-time figures, ISO dates in report
headers, and duplicate worker-dashboard link labels. None changes a figure's meaning.

---

## 8. Open items

**Nothing is awaiting a deploy decision.**

*Closed 28 Aug 2026:* this section previously listed
`feature/sc014-scoring-empty-states` (`a88f259`) as an undeployed branch carrying a
genuine correctness point — the Score Preview rendering a green "80% · Pass" for an
audit with **zero questions**. That defect is **fixed and live**, and has been since
5 Aug 2026: the same change reached `main` as `f691034` and the five later SC-014
workspace commits were built on top of it. `git cherry` reports the branch commit as
already having an equivalent in `main`. The branch is a stale duplicate against a
much older revision of `components/platform/AuditScoringConfig.tsx` (1103 lines
against `main`'s 1361) — **merging it now would revert the SC-014 workspace work.**
Delete or archive the branch; do not merge it.

**Unmerged branches — all safely on `origin`**

*Corrected 28 Aug 2026: the entry below previously called two of these commits "the
most at-risk work in the repository". They have since been pushed; nothing on this
machine exists only here.*

- `feature/archived-badge-style` — 3 commits not in `main`, all present on `origin`
  (local and remote both at `4701580`). Its manual check-out commit (`9c6fbbd`) is
  **superseded**: BL-001 shipped on 28 Aug 2026, rewritten against the approved RBAC
  matrix rather than rebased (see BL-001 for why the branch was not the starting
  point). The other two — branded error pages (`4701580`) and a GitHub Actions CI
  pipeline (`1e0173c`) — are still unmerged but no longer at risk. The CI pipeline
  remains the only test automation that exists anywhere in the project.
- `feature/remove-dashboard-placeholder` — 1 commit not in `main`, present on `origin`.

**Operational, not engineering**

- **Twelve stale check-ins remain open in production**, and Test Site D is still
  blocked from closure by two of them. The capability to clear them shipped with
  BL-001; the work of confirming each worker is genuinely off site and recording why
  has not been done. Procedure, and what makes an acceptable reason, are in
  `docs/ATTENDANCE-OPERATIONS.md`. Deliberately not bulk-closable.

- **Monitoring is blocked on a subscription-level permission, not on engineering.**
  The `microsoft.insights` resource provider is **not registered** on the
  subscription, and registering it is a subscription-scope action — this machine
  holds Contributor on `rgSiteComply` only. Application Insights and every metric
  alert live in that namespace, so both fail identically. One command, run by
  someone with Contributor or Owner **on the subscription**, unblocks it:
  `az provider register --namespace microsoft.insights --wait`. The prerequisite
  Log Analytics workspace `sitecomply-logs` already exists and costs nothing idle.
  Until then production has **no alerting of any kind** — verified 28 Aug 2026:
  zero metric alerts, zero action groups, zero activity-log alerts, and
  `healthCheckPath` still `null`. The first signal of an outage would be a user
  complaint.

**Deferred by decision (not defects)**

1. A control to clear a work-surface selection — today you edit the URL.
2. `WorkerAccessManager` (723 lines) untouched; folding its per-row actions into the
   roster rail would finish the Workers workspace.
3. Phase 3's config components stretch their fields to the full 1600px.
4. Two residual mobile horizontal scrolls (documents, knowledge-check), with no
   element escaping its container — twelve screens scrolled sideways before Phase 8.
5. Grouping the Reports catalogue would require reordering it — a content decision.
6. Historical annotated photo pairs predate the link fix and are deliberately **not**
   reconciled; matching them after the fact would be guesswork about audit evidence.
7. The Documents Register keeps its original/annotated behaviour by decision.

**Known and unaddressed**

- ~~The SMS `devCode` is returned by the OTP endpoint and production still uses the
  mock provider.~~ **Resolved.** The `devCode` field was deleted (the only mention
  left in the codebase is a comment in `services/auth/otpService.ts` recording that
  no such field exists), and the `SMS_PROVIDER` app setting has been removed from
  production. Verified 28 August 2026. *Corrected here because the entry described
  a live credential leak that no longer exists.*
- **No security headers at all** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy and Permissions-Policy were all verified absent against the live
  site. Unchanged as of 28 Aug 2026.
- There is **no test runner** — no Jest, no Vitest, nothing in `npm scripts`.
  Verification is done by purpose-built scripts (`scripts/sc0XX_verify.ts`,
  `uxrefresh_nav_check.ts`, `sc017followup_check.ts`, `sc020followup_check.ts`) and by
  a Playwright harness kept *outside* the repo. A newcomer should expect to write
  their own harness or adopt the CI branch above.

---

## 9. Infrastructure

Resource group `rgSiteComply`, mostly `uksouth`:

| Resource | Purpose |
|---|---|
| `sitecomply-web` + `sitecomply-plan` (B1) | the application |
| `sitecomply-pg` | PostgreSQL flexible server |
| `scdocsuk` | private blob storage — documents, evidence photos, signatures, close-out ZIPs |
| `sitecomply-scheduler` + `scschedfn` | Azure Functions timer, hourly at :05, calling `POST /api/system/compliance/tick` |
| `sc-uk-acs` | Azure Communication Services (SMS) |
| `SiteComplyOpenAI(UK)` | Azure OpenAI — knowledge checks, report and pack narratives |
| `app.sitecomply.co.uk` | managed certificate |
| `sitecomply-logs` | Log Analytics workspace (uksouth, 30-day retention) — **created as the App Insights prerequisite; nothing writes to it yet** |

### Production posture — verified 28 August 2026

Read from the live environment, not from notes.

| Setting | State |
|---|---|
| `alwaysOn` | **`true`** — raised from `false` on 28 Aug 2026 |
| `httpsOnly` | `true`, with `minTlsVersion 1.2` and `ftpsState FtpsOnly` |
| Postgres backup retention | **35 days** — raised from 7 on 28 Aug 2026 (the maximum) |
| Postgres geo-redundancy | `Disabled` |
| Postgres high availability | `Disabled` (Burstable tier) |
| `healthCheckPath` | `null` |
| Metric alerts / action groups | **none** |

**What changed, and what did not.** The infrastructure safety net was raised on
28 Aug 2026: Always On enabled and backup retention taken from 7 days to 35, both
without downtime, plus the Log Analytics workspace. Monitoring was **not** completed
— it is blocked on a subscription-scope permission, see §8. Geo-redundancy cannot be
changed on an existing flexible server: it is fixed at creation, so enabling it means
restoring into a new server with a planned cutover, not a settings change.

*A note on one retired risk.* `httpsOnly` was at one point recorded as unset. It was
never unset — the value was read from `az webapp config show`, which does not carry
the property and returns `null` for it. The real value lives on `az webapp show`, and
behaviour confirms it: `http://app.sitecomply.co.uk/api/health` 301s to HTTPS. The
transport posture was correct all along. **Do not re-raise it.**

*And another.* The `SMS_PROVIDER` app setting has been **removed** from the App
Service. Provider selection now comes from the database row alone, which closes the
latent failure where resetting that row would have silently switched real worker OTP
delivery back to the mock. No `SMS_*` or `TWILIO_*` key remains in app settings.

The compliance scheduler is deliberately thin: an external clock calling a
secret-guarded HTTP endpoint. It holds no business logic and no schedule knowledge.
**Lazy generation was kept as a fallback** — a scheduler that silently stopped would
otherwise leave the calendar looking calm while inspections went unraised. Both paths
are idempotent.

---

## 10. If you change one thing, know this

- **Read the commit messages.** They explain *why*, including the options rejected.
  They are the densest documentation in the project.
- **Run the verification scripts for whatever you touch** before and after.
- **Check `git status` before deploying**, because the working tree is what ships.
- **Deploy one thing at a time.** Every production issue found here was diagnosed by
  having exactly one variable in flight.
- **Report what actually happened.** Several defects in this codebase survived because
  something looked right — an unused import that implied a wired feature, a canvas
  that displayed correctly and saved blank, a green "Pass" on an audit with nothing to
  score. Where you cannot verify something, say so.
