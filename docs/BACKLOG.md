# SiteComply — backlog

Deferred work that has been reviewed and deliberately not built. Each item records
enough design detail to be picked up cold in a future release, without needing the
branch or conversation it came from.

Items here are **not** commitments and **not** in scope for REV-1.

---

## BL-001 — Authorised manual check-out

**Status:** Deferred — reconsider in a future release
**Raised:** 26 August 2026
**Reference:** tag `archive/manual-checkout` (archived branch `feature/archived-badge-style`)

### The problem

A check-in can only be closed by the worker who opened it. The sole writer of
`Submission.checkedOutAt` is `/api/worker/checkout`, the worker's own action. There is
no platform-side force check-out and no automatic or overnight sweep.

So when a worker leaves site without checking out — dead phone, forgot, left in a hurry
— the check-in stays open permanently, and every figure derived from it stays wrong
permanently. That includes the **on-site count, which is what a site uses as its fire
roll**. A permanently overstated roll is a safety defect with no current remedy.

The capability was specified and never built: `CHECKOUT_OVERRIDE_ROLES` exists in
`services/platformUsers/platformPermissions.ts` with **zero consumers**, and
`docs/RBAC.md` describes the capability in prose.

### Scope

Let an authorised platform user close a check-in that is still open, from Worker
Details, with a mandatory reason, recorded as an auditable and visibly *manual* event.

### Design decisions carried forward

These were worked out on the archived branch and are worth keeping. The **code** is not
— see "Why the branch is not the starting point" below.

**Data model** — four additive nullable columns on `Submission`:

| Column | Type | Purpose |
|---|---|---|
| `checkedOutByUserId` | `TEXT` | actor's `PlatformUser` id, reference only |
| `checkedOutByName` | `TEXT` | denormalised actor name for display |
| `checkedOutReason` | `TEXT` | mandatory reason, truncate to 500 chars |
| `checkedOutManual` | `BOOLEAN NOT NULL DEFAULT false` | marks the record as forced |

The actor is stored **without a foreign key** so the audit record survives deletion of
the user who performed it. `checkedInAt` is never overwritten — the original check-in
time is part of the record.

**Concurrency** — enforce site scope *and* open state inside a single atomic
conditional update rather than read-then-write:

```
WHERE id = ? AND jobSiteId IN (viewer.siteIds) AND checkedOutAt IS NULL
```

Two operators acting at once cannot both succeed. Distinguish "not found / out of
scope" from "already checked out" only *after* the write returns zero rows.

**Status contract** — `401` not signed in · `403` role not permitted · `400` reason
missing · `404` not found in the viewer's sites · `409` already checked out · `200` done.

**Presentation** — history renders `Manual · <actor> — <reason>` beneath the check-out
time, so a forced check-out is visually distinct from a real one **everywhere it
appears**. A forced check-out that looked like a genuine one would be worse than none.

### Constraints for a future implementation

1. **Use the existing RBAC model.** Consume `CHECKOUT_OVERRIDE_ROLES` — Site Manager,
   Project Manager, Principal Contractor. Do **not** introduce a parallel constant, and
   do **not** grant this to Director: `docs/RBAC.md` lists "edit/override check-ins"
   under what a Director cannot do. That is a deliberate separation of duties, the same
   principle that bars Directors from signing off their own audits. If the role set is
   to change, change `docs/RBAC.md` first, as a decision in its own right.
2. **Use current UI patterns.** `components/ui/ConfirmDialog.tsx` is the established
   primitive (eight consumers, including the worker's own `CheckOutOfSiteButton`). Do
   not hand-roll a modal. Any overlay must use `createPortal` — a `fixed inset-0`
   overlay cannot escape a hidden or clipping ancestor, which is what made "Invite
   Worker" silently do nothing in production.
3. **Use the current testing approach**, whatever it is at the time, and **commit the
   tests**. The archived branch claimed a 15/15 integration suite; no test files were
   committed, so the claim carries no weight.
4. **Plan the DDL as a manual step.** Production's App Service startup command is
   `next start`, so `prisma migrate deploy` never runs. The four columns must be applied
   by hand via Azure Cloud Shell, as was done for the Toolbox Talk fix and the MESSAGES
   enum migration.

### Why the branch is not the starting point

Its central access-control decision contradicts the approved RBAC matrix committed in
`9def4b1` on 1 July 2026 — nine days *before* the branch, which carried that document
unchanged. It granted the capability to Director and denied it to Site Manager and
Principal Contractor. That is not staleness a rebase resolves. Combined with a modal
that should be deleted and tests that do not exist, what survives is the design above,
which is better carried as this specification than as code.

### Related, not included

- An **automatic overnight sweep** would address the same fire-roll problem with no
  human in the loop. The two are complements, not alternatives — a sweep handles the
  routine case, a manual override handles the same-day one where the count must be
  right *now*, and only the manual override produces an accountable record. Worth
  considering together.
- Before scheduling this, measure it: count open check-ins older than 24 hours in
  production. The case above is structural, not measured.

---

## BL-002 — GPS check advance notice

**Status:** Deferred — reviewed and deliberately not built
**Raised:** August 2026

On GPS-enforced sites, a worker only discovers that their location will be checked at
the moment the check-in is submitted. Surfacing that earlier in the journey — at site
selection, alongside the existing access hints — would remove a late surprise.

Deferred as a lower-priority polish item; the access-gate work that shipped in August
2026 addressed the more disruptive version of the same problem (invitation and
site-assignment refusals now appear at site selection rather than at submit time).

---

## BL-003 — Retire CSCS mock verification

**Status:** Scheduled — known pre-go-live dependency
**Raised:** 26 August 2026
**Reference:** `docs/CSCS-CUTOVER.md`, `scripts/audit_cscs_mock_verifications.sql`

The CSCS integration runs on `MockCscsProvider` in production. It returns `VALID` /
`verified: true` for any plausible card number, writes a fabricated expiry (verification
date + 3 years) and invented qualification records to the worker, and tells the worker
*"Card verified against the CSCS Smart Check service."*

Accepted as a pre-go-live dependency rather than a live defect because SiteComply is not
yet in customer use. **Phase 1 of the cutover checklist must complete before the first
customer**, independently of when Smart Check is connected — the mock's output is
indistinguishable from a real verification in the UI, and `CSCS_VERIFIED` is a live
site-access requirement that reads the flag it sets.

Full behaviour, identification method and the phased checklist are in
`docs/CSCS-CUTOVER.md`. No code changes made.
