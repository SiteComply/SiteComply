# Authorised manual check-out — as built

Live in production since **28 August 2026** (build `E1UIu7vjXpQ6TnNo9HGrS`).
Delivers BL-001. This file describes what the system **does**; `docs/BACKLOG.md`
BL-001 records what was decided and why.

---

## 1. Why it exists

A check-in could only ever be closed by the worker who opened it. There is no
sweep and no expiry, so one left open stayed open forever — and the on-site count
is what a site uses as its **fire roll**. A permanently overstated roll is a
safety defect, and it also hard-blocks project closure, because closure refuses
while anyone is checked in.

Measured in production on 28 August 2026, before delivery: **13 open check-ins,
12 older than seven days, 6 older than thirty, the oldest 36 days, and two
projects that could not be completed with "workers still checked in" as their
only blocker.**

## 2. What it does

An authorised platform user can close an open check-in, with a mandatory reason.
The record is then permanently marked as a manual close and attributed.

What it deliberately does **not** do:

| | |
|---|---|
| `checkedInAt` | **never written.** The original record stands. |
| `checkedOutAt` | **never backdated.** It records when the manager acted. A guessed departure time would read as fact. |
| Time on site | **not reported** for a manual close. The gap between the timestamps is not a shift — publishing it would put a fabricated duration, sometimes weeks, into attendance reporting. |
| The manual flag | **cannot be cleared.** There is no tidy-up path. |

## 3. Who can do it

`CHECKOUT_OVERRIDE_ROLES` in `services/platformUsers/platformPermissions.ts`:

**Director · Site Manager · Project Manager · Principal Contractor**

Not permitted: Client, Auditor, Engineer, H&S Consultant (403).

Director was added on 28 August 2026. The exclusion had been justified by
separation of duties, but that reasoning belongs to **audit sign-off** — it stops
the executive layer approving its own audit. An override approves nothing; it
corrects a record a worker failed to close. Since closure is hard-blocked while
anyone is checked in, excluding the role that closes projects left it unable to
clear the thing blocking it. Recorded in `docs/RBAC.md` §6 note 1 **before** any
code was written.

Check-in immutability is unchanged and now stated precisely: **no role edits the
content of a check-in.** An override closes an open record and annotates it.

## 4. Audit trail

Five columns on `Submission` (migration
`20260828120000_add_submission_manual_checkout`):

| Column | Purpose |
|---|---|
| `checkedOutManual` | the flag every surface keys off |
| `checkedOutByUserId` | actor's `PlatformUser` id — **no foreign key** |
| `checkedOutByName` | denormalised actor name |
| `checkedOutByRole` | the role held **at the time** |
| `checkedOutReason` | mandatory, capped at 500 characters |

The actor is held without a foreign key, with name and role denormalised
alongside, so the trail survives deletion of the user who performed it. **GDPR
worker erasure does not touch it** — that path updates only the `Worker` row, and
the actor recorded here is a platform user, not the worker.

**Because Directors are included, separation of duties no longer constrains this
capability. The audit trail is the control.** That makes three things
non-negotiable rather than merely good design: the reason cannot be skippable,
the flag cannot be clearable, and both must appear everywhere the check-out does.

### Where a manual close is visible

Check-ins detail rail · Worker Details check-in history · Check-ins CSV export ·
Attendance report and its CSV export · project close-out pack.

Both exports carry three columns: `Manual check-out`, `Checked out by`,
`Check-out reason`. Wording comes from `services/submissions/manualCheckOut.ts` so
no surface invents its own.

### It cannot be reversed, hidden, or made to look genuine

Verified by enumerating every write to `Submission`. There are three: the worker's
own `checkOut` (matches `checkedOutAt: null`, so it cannot touch a closed record),
`overrideCheckOut` (only ever writes `checkedOutManual: true`), and whole-site
deletion. Nothing writes `checkedOutManual: false` or nulls the audit fields.
Project reopen touches only `jobSite` and `workerSiteAssignment`. The only
submission endpoints are export (GET) and checkout (POST) — there is no edit path.

## 5. UI treatment

The control lives on the **Check-ins detail rail**, beside the record it acts on,
with the age of the check-in shown next to it ("Open since … · N days") so the
decision is made with that in view. It renders only for a permitted role; the API
re-checks, because a hidden button is not an access control.

- **One label in both states — "Manually check out worker".** The button pressed
  is the button confirmed. No trailing ellipsis: the label states the action
  rather than hinting that more follows. The busy state reads "Checking out…",
  which is progress, not the action.
- **The platform `danger` variant on both controls** — `bg-danger-600 text-white`,
  **4.83:1** against white (WCAG AA for normal text; 6.47:1 on hover at
  danger-700). The existing variant is used unmodified rather than a new colour
  invented. This is an administrative override and should not look like an
  ordinary action.
- **An inline disclosure, not a modal.** `ConfirmDialog` takes only a `message`
  string and cannot host a field. The pattern followed is project reopen's inline
  reason panel — which also avoids the `fixed inset-0` overlay trap that made
  "Invite Worker" silently do nothing inside a clipping ancestor.
- The confirm stays **disabled until the reason is non-empty**.

**Project closure readiness links to the fix but does not host it.** The
"Workers still checked in" blocker now carries "Review the N open check-ins →".
The action stays out of that list on purpose: the count is a fire roll, and
clearing it should mean looking at who is on it.

## 6. API

`POST /api/platform/submissions/[id]/checkout` · body `{ reason }`

| Status | Meaning |
|---|---|
| 401 | not signed in |
| 403 | role not in `CHECKOUT_OVERRIDE_ROLES` |
| 400 | reason missing or blank |
| 404 | not found in the viewer's sites |
| 409 | already checked out, **or** the project is completed (read-only) |
| 200 | done |

Scope and open-state are enforced **inside** the write — a single `updateMany`
carrying `id`, `jobSiteId IN (...)` and `checkedOutAt: null`. Two managers acting
at the same instant cannot both succeed; the second matches zero rows. Why zero
rows matched is worked out afterwards, only to choose the message.

### The trap: completed projects and Directors

Completed projects are read-only (SC-025), enforced by a guard in `lib/prisma.ts`
that inspects the `where` of **every** write and throws `ProjectClosedError` if any
site id in it belongs to a completed project. **It reacts to a completed id being
present in the predicate, not to whether it would match.**

Any write scoped as `jobSiteId: { in: viewer.siteIds }` therefore throws **for
Directors**, whose scope includes every site. Roles holding only active sites never
see it. This shipped as a 500 and was caught in production verification; it cannot
be reproduced locally unless the local estate contains a completed project.

Completed sites are filtered out of the predicate before the write, using
`getClosedSiteIds` from `services/projectClosure/projectWritable.ts`. Adding a
status condition is **not** sufficient. A deploy guard now fails the build if the
exclusion disappears.

## 7. Closure needed no change

The blocker counts `checkedOutAt: null` — the same field the override writes — so
it clears itself. Verified end to end: `canClose: false` → override →
`workers_on_site: 0, satisfied: true` → `canClose: true`. An override does not
bypass other blockers; a site with live permits stayed blocked on those.

## 8. Operating it

Applying the migration to a new environment is a **manual step**: production's
startup command is `next start`, so `prisma migrate deploy` never runs. Five
additive columns — four nullable, one defaulted — metadata-only on PostgreSQL,
reversible by `DROP COLUMN`. Apply the DDL **before** the code, or every query
selecting the new columns fails the moment it lands.

Day-to-day use is in `docs/ATTENDANCE-OPERATIONS.md`.
