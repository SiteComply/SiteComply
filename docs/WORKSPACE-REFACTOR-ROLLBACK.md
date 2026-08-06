# Workspace Refactor — rollback plan

How to return Audit Scoring, Actions and Permits to the current production
experience if the refreshed workspaces do not meet expectations after
deployment.

---

## The two commits

| | Commit | What it is |
|---|---|---|
| **Pre-refactor production state** | **`1bc0fd2`** — tag **`pre-workspace-refactor`** | What production is serving today. The rollback target. |
| **Release candidate** | **`c47adbb`** — `main` tip | The workspace refactor. Not yet deployed. |

Range being deployed: **`1bc0fd2..c47adbb`** — 5 commits, 9 files, +909/−646.

### How the pre-refactor commit was established — not assumed

Production's own source was read back over Kudu (`/api/vfs/site/wwwroot/…`) and
hashed against the git blobs:

- **All 9 files the refactor touches are byte-identical between `1bc0fd2` and
  live production.**
- **None** of the 9 match `c47adbb`.
- Prod `BUILD_ID` at the time of this check: `L4iJu6KJDkE-OGaqcoW-0`.

One nuance, recorded so nobody trips over it later: `docs/HANDOVER.md` — added
by `1bc0fd2` itself — is **absent** from `wwwroot`, so the currently deployed
artifact was actually built at `d9ced84`, the parent. `d9ced84..1bc0fd2` touches
**no runtime file** (`app/`, `components/`, `services/`, `lib/`, `prisma/` are
identical; the only change is that one docs file, which is never served).
`1bc0fd2` is therefore the correct and safe rollback target: restoring it
reproduces today's production behaviour exactly, and additionally lands an inert
documentation file.

### The rollback point is durable

```
git rev-list -n1 pre-workspace-refactor      # 1bc0fd2497cb50c5c7c2af5324e97c4c9c7a0f4d
git ls-remote --tags origin | grep workspace # present on origin
```

The tag is annotated, pushed to `origin`, and an ancestor of `main` — so the
commit cannot be garbage-collected, and the rollback point survives the loss of
this machine.

---

## Is rollback code-only? Yes — confirmed

**Rollback is a simple code-only redeploy. No database changes, no migrations,
no backfills, no seeds, no data impact.**

This is not a statement of intent; the script proves it at step `[6/8]` and
aborts the rollback if it is ever untrue:

| Check | Result |
|---|---|
| Files changed under `prisma/` in `1bc0fd2..c47adbb` | **0** |
| Files changed under `services/` and `lib/` | **0** |
| Top-level roots touched | **`app/` and `components/` only** |
| Migrations introduced | **none** |
| Rows written or transformed by the release | **none** |

The refactor is presentation-only: it changes layout, grouping and which panel a
control lives in. It writes nothing, reads nothing differently, and alters no
permission, workflow, query or filter. **There is no data state to reverse, so
putting the previous code back puts the platform back.**

Consequences worth stating plainly:

- Rollback is safe at **any** time after deployment — one hour or one month.
  Nothing accumulates that would make it progressively harder.
- Permits approved, actions updated or audits scored *while the refactor is live*
  are unaffected. They were written through unchanged services into an unchanged
  schema, and remain valid and visible after rollback.
- No maintenance window, no read-only period, no data repair.

---

## Rollback procedure

### Step 1 — Drill first (safe, touches nothing in Azure)

```bash
scripts/workspace_rollback.sh --drill
```

Builds the baseline in an isolated worktree and verifies it, without deploying.
Already executed once before go-live — see *Verified* below.

### Step 2 — Execute the rollback

```bash
nohup scripts/workspace_rollback.sh --confirm > /tmp/wsrollback.log 2>&1 &
tail -f /tmp/wsrollback.log
```

> Run it **backgrounded**. The App Service plan is **Linux B1 — no deployment
> slots**, so rollback is a full redeploy of roughly **10–12 minutes**. A
> foreground run can hit a command timeout and be killed mid-cutover.

What `--confirm` does, in order:

1. Verifies the tag exists locally **and on `origin`**.
2. Creates a **fresh, separate git worktree** at the tag and asserts it is clean
   and at exactly `1bc0fd2`.
3. `npm ci` **inside the worktree**.
4. `prisma generate`, then a clean `next build`.
5. Asserts the refactor is **absent** from the built tree and REV-1 code is
   **present**.
6. Asserts the release is presentation-only — **aborts** if `prisma/`,
   `services/` or `lib/` changed.
7. Zips the worktree and `az webapp deploy` (async).
8. Polls Kudu until `BUILD_ID` flips, then `az webapp stop`/`start`, health
   poll, route smoke test.

> **Why a separate worktree:** every deploy script zips the *current working
> tree*. Running one from a post-refactor checkout would package the very files
> you are trying to remove — the "rollback" would ship the refactor. This script
> never builds in place.

**If step 8 reports `WARNING: baseline build id not confirmed` (exit 2), the
script deliberately does NOT cut over.** Production is still serving the
refactor and is unharmed. Re-run.

---

## Verification checks

### Automated (the script performs these)

| Check | Expected |
|---|---|
| Worktree HEAD | `1bc0fd2497cb…` |
| Refactor absent from baseline | no `SegmentedNav` in permits register, no `PRIORITY_DOT`, `PermitReviewControls` not on `Panel`, permit decision **not** in the rail |
| REV-1 intact | SC-025 read-only guard, SC-024 archive, SC-014 scoring all present |
| Presentation-only proof | 0 `prisma/`, 0 `services/`+`lib/` changes |
| Prod `BUILD_ID` | flips **off** the refactor build |
| `/api/health` | HTTP 200 |
| `/platform/dashboard/{actions,permits,audits}` | 3xx (gated) — not 5xx |

### Confirm the cutover happened

```bash
curl -s https://sitecomply-web.azurewebsites.net/ | grep -c '<NEW_BUILD>'  # expect >=1
curl -s https://sitecomply-web.azurewebsites.net/ | grep -c '<OLD_BUILD>'  # expect 0
curl -s -o /dev/null -w '%{http_code}' https://sitecomply-web.azurewebsites.net/api/health
```

> **Expect a new `BUILD_ID`.** `npm run build` mints a random one every run, so
> rollback will **not** reproduce `L4iJu6KJDkE-OGaqcoW-0`. Byte-identity is not
> the test and is not claimed. The recorded ID proves the *direction* of travel:
> production must move **off** the refactor build.

### Manual walkthrough after rollback

Sign in with a role that has permits approve rights and audit access.

1. **Actions register** — the four buckets are **full-height stat cards stacked
   above** the table again, not one recessed strip. Table has **six** columns:
   Action / Site / Priority / Status / Due / Assigned. Priority is a **filled
   pill**, not a dot.
2. **Action detail** — description, completion note and origin finding are
   **separate titled cards**; evidence is its **own panel** below them; status
   workflow is a **card below** Summary.
3. **Permits register** — status is an option inside the **filter dropdown**, not
   a segmented strip. Table has **six** columns: Reference / Type / Worker / Site
   / Status / Submitted, with the reference in mono as the link.
4. **Permit detail** — the who/where/when facts are back in the **main column**;
   the decision controls sit in the main column under the safety questions;
   Activity is in the **rail**. No "Submitted" row in a Summary rail.
5. **Audit Scoring** — nine cards across three equal columns.
6. Approve or reject a test permit; change an action status; adjust a scoring
   weighting. All three must still work — these paths were never touched, and
   confirming them proves the rollback restored a *working* platform, not just an
   older-looking one.
7. Console clean; no horizontal scrolling at 390px.

---

## Expected result of the rollback

Production serves the **exact application code running today**: Audit Scoring,
the Actions register and detail, and the Permits register and detail all return
to their current appearance and behaviour, down to the byte, for all nine
affected files.

- **Database:** untouched. Not read differently, not written, not migrated.
- **User data:** fully preserved, including anything created while the refactor
  was live.
- **Permissions, workflows, filters, reports:** unchanged throughout — they were
  never part of this release in either direction.
- **Only observable difference from today:** a new random `BUILD_ID`, and the
  presence of the inert `docs/HANDOVER.md` in `wwwroot`.

Net effect: users see the pre-refactor experience they had before deployment,
with no data loss and no follow-up remediation.

---

## Verified

Executed, not assumed:

- **Tag resolves and is on the remote** — `git ls-remote --tags origin` returns
  `pre-workspace-refactor` dereferencing to `1bc0fd2`.
- **Production really is pre-refactor** — all 9 affected files hashed from live
  `wwwroot` match `1bc0fd2` and none match `c47adbb`.
- **The rollback path executes** — `--drill` run before go-live: clean worktree
  at the tag, `npm ci`, `prisma generate`, full production build, refactor
  asserted absent, REV-1 asserted present, presentation-only proof passed.

---

## Related

- `scripts/workspace_deploy.sh` — the forward deploy.
- `docs/WORKSPACE-REFACTOR-DEPLOYMENT.md` — deployment and the post-deploy
  walkthrough.
- **Deferred, not a rollback trigger:** the permit status filter reads the stored
  `status` column while the table badges `effectiveStatus()`. Pre-existing on
  `main` and present *both* before and after this release — rolling back does not
  fix it and it must not be mistaken for a regression.
