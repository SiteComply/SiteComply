# Workspace Refactor — deployment & production verification

Commit range `1bc0fd2..c47adbb` (fast-forward on `main`, no merge commit).
Deploy script: `scripts/workspace_deploy.sh`.

**Code only.** No schema change, no migration, no seed, no backfill — so there
is no `*_migrate.sh` half to this deploy. Nothing in the range touches
`services/`, `prisma/` or `lib/`; the script asserts that mechanically before it
builds anything.

**Rollback** is a redeploy of `1bc0fd2`. Nothing here is destructive and no data
is written, so rollback is safe at any point and needs no data repair.

---

## What is being deployed

| Screen | Change |
|---|---|
| Actions register | Four stat cards → shared `SegmentedNav` strip; six columns → four |
| Action detail | Description / finding / completion note / evidence are one panel; status control in the Summary rail |
| Permits register | Status is a segmented strip, not a dropdown option; six columns → four |
| Permit detail | Main column is what there is to read; Summary rail carries the facts **and** the decision |
| Audit Scoring | Nine cards → three panels in the SC-014 benchmark grid |

Presentation only. No permission, workflow, filter, query or schema change.

---

## Pre-deploy

Run from a clean checkout of `main` at `c47adbb`.

```bash
git checkout main && git pull            # expect: already up to date, c47adbb
git status --porcelain                   # expect: empty
DRY_RUN=1 scripts/workspace_deploy.sh    # assertions only, no build, no deploy
```

The dry run must end `== DRY RUN — assertions passed ==`. It checks, against
source with comments stripped:

- **Scope** — only `app/` and `components/` changed since `1bc0fd2`, and
  `permitAdminService.ts` is untouched (see *Deferred* below).
- **Filters still filter** — both strips render, keep their accessible names,
  and still clear on re-click; the permits form still carries status through a
  hidden input, so Apply cannot silently drop it.
- **Structure** — four header cells per table; evidence sits inside the action
  record panel; the permit decision sits in the rail and Activity in the main
  column; all three rails are sticky on the **inner div**, not the stretched
  grid item.
- **The deliberate omission** — the permit status strip is still count-free.

> Comments are stripped before matching on purpose. These files explain
> themselves at length and name the very things being asserted, so a plain grep
> matches the prose and passes while the code is missing. That has bitten this
> repo three times. Do not simplify the assertions into greps.

---

## Deploy

```bash
scripts/workspace_deploy.sh
```

Steps 3–8: `prisma generate` → typecheck → lint → clean `next build` → zip
(excluding `.git`, `.env`, `.next/cache`, `scripts`) → `az webapp deploy`
(async) → poll Kudu until `BUILD_ID` flips → `az webapp stop`/`start` → poll
`/api/health` → unauthenticated route smoke test.

Expected tail:

```
== WORKSPACE REFACTOR DEPLOYED ==
   NOW RUN THE WALKTHROUGH: docs/WORKSPACE-REFACTOR-DEPLOYMENT.md
```

**Exit 2 = new build never landed on disk.** The script deliberately does *not*
cut over in that case; prod is still on the old build and is unharmed. Re-run.

The route smoke test expects **3xx** (correctly gated behind sign-in) on
`/platform/dashboard/{actions,permits,audits}`. A `200` would mean the auth gate
had gone; a `5xx` means the new build is broken on a page nobody has opened yet.

---

## Post-deploy walkthrough

The smoke test only proves the routes are reachable and still gated. It cannot
sign in, so **everything below is a human check** against real production data.
Sign in as a role with `permits` approve rights and audit access.

### Actions workspace

1. `/platform/dashboard/actions` — the four buckets render as **one recessed
   strip**, not four cards stacked above the table.
2. Bucket counts are present and non-zero where prod has data.
3. Click **Overdue** — list narrows, the segment highlights, a **Clear** link
   appears. Click **Overdue** again — filter clears.
4. Combine with Site and Priority, press **Apply** — the bucket survives the
   form submit *(this is the hidden-input path)*.
5. Table has **four** columns: Action / State / Due / Assigned. Site sits under
   the action title; overdue rows show a red date and an Overdue pill.
6. Priority is a coloured **dot with a label**, not a filled pill.
7. Open an action raised from an audit — description, the finding link, finding
   evidence and its own evidence are **one panel**, separated by rules.
8. Summary rail: priority, status, due, assignee, site, and **Update status**
   inside the same panel. Scroll — the rail stays put.
9. Change a status; confirm it saves and the activity thread records it.

### Permits workspace

10. `/platform/dashboard/permits` — status is a **segmented strip**, not an
    option in a dropdown. It carries **no counts** (intentional — see below).
11. Click **Awaiting approval** — list narrows; re-click clears.
12. Pick a Site and press **Apply** — the status survives the submit.
13. Table has **four** columns: Permit / Requested by / Status / Submitted. The
    permit **type** is the link, with the reference in mono beneath it.
14. Open a permit **awaiting a decision** — main column is Requested work then
    Activity; the rail is Summary **plus Review** with the decision buttons. The
    rail should not look empty.
15. Confirm **Submitted** appears in Summary.
16. Open an **approved** permit — rail is Summary, the green Approval callout,
    then Review with **Close permit**. Both columns end at roughly the same depth.
17. Open a **rejected** permit — rail is Summary and the red Rejected callout,
    and **no** decision buttons.
18. Check a permit whose history contains a comment — it reads **"Comment"**,
    not a shouted `COMMENT`.
19. Approve or reject a test permit end to end. The approve form's two date
    inputs must stack in one column inside the rail, not squeeze side by side.

### Audit Scoring

20. Open an audit → **Configure scoring** on a **fully configured** audit (not
    an empty one — an empty audit hides the layout problems this fixed).
21. Row 1 is three panels: Scoring Setup / Section Weightings / Score Preview.
22. **Question Scoring Rules** is a wide band under them with its four tiles in
    **one row**, not stacked in a third-width column.
23. The questions list spans two columns beneath that; each question is one line.
24. Scroll — **Score Preview** sticks to the top of the viewport.
25. Change a weighting; the preview updates and the total still reconciles.

### Cross-cutting

26. Repeat 1, 10 and 14 at **390px** width — no horizontal scrolling anywhere.
27. Browser console clean on all five screens.
28. Confirm with a **non-approver** role that Approve/Reject are absent while the
    permit is still readable — the refactor moved these controls, and their
    permission gates must be exactly as before.

---

## Deferred — do not treat as a regression

**Permit status filter vs badge.** The register filters the *stored* `status`
column while the table badges `effectiveStatus()`, which reports an APPROVED
permit as EXPIRED once `validUntil` passes. So `?status=EXPIRED` can return
nothing while a row is visibly badged Expired, and `?status=APPROVED` can return
a row badged Expired.

This is **pre-existing on `main`** and was deliberately kept out of the refactor
to keep it presentation-only. It is also why the permit status strip carries no
counts: any count sourced from the stored column would print "Expired 0" beside
a row badged Expired.

The fix is one shared where-clause used by filter, count and badge alike
(`EXPIRED = stored EXPIRED OR (APPROVED AND validUntil < now)`), which also
unblocks the counts. It changes what the filter returns, so it needs its own
branch and its own verification — not this deploy.

Also outstanding, cosmetic, accepted:

- Dead import `ACTION_PRIORITY_BADGE` in `app/platform/dashboard/actions/page.tsx`
  (comment-only reference; lint-clean).
- "Review" heading sits above a lone "Close permit" on an approved permit.
- The pending Review panel's three buttons wrap 2-then-1 at rail width.
