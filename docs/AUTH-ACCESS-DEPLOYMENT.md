# SC-026 — Authentication & Access (Phase 1): deployment, verification, rollback

**Release candidate:** `3357369` on `feature/auth-access-settings`
**Current production:** `b238694` — BUILD_ID `GBrtye6anpzmgSJtz1upu`
**Kind:** schema + code. **Migration required.**

Settings gains a third area. Directors set, for the whole organisation, how
people sign in, how long sessions last and the minimum standard for reaching a
site. Project Managers may read it. No other role can reach it.

Every control has an enforcement point in running code. Microsoft Entra ID,
email OTP and single-session enforcement are **absent by decision** — the
behaviour behind them does not exist, and a switch that silently does nothing
is a false assurance. `scripts/sc026_deploy.sh` asserts they have not appeared.

---

## 1. Production state, confirmed 2026-08-06

Checked before writing any of this, rather than assumed:

| Fact | Value |
|---|---|
| `_prisma_migrations` | 54 rows, **0 failed or unfinished** |
| Pending migrations | exactly one — `20260811090000_auth_config_org_access` |
| `AuthConfig` rows | **0** — the platform runs on env-and-defaults |
| Auth-related App Service settings | none set (`SMS_PROVIDER=mock` only) |

The failed `20260625060232_init` row that blocks `prisma migrate deploy`
locally **does not exist in production**. It is a local-database artefact and
does not affect this release. `scripts/sc026_migrate.sh` re-checks this at run
time anyway — a script that assumes it is a script that will one day be pointed
at the wrong database.

---

## 2. Deployment sequence

Two commands, in this order. The order is not a convention; see §4.1.

```bash
cd /home/cc-dev-1/sitecomply
git checkout main && git merge --no-ff feature/auth-access-settings
git push origin main

# 1. schema — additive, no backfill, no data written
bash scripts/sc026_migrate.sh

# 2. code — refuses to run until the migration is confirmed in production
bash scripts/sc026_deploy.sh
```

To exercise every source assertion without deploying:

```bash
DRY_RUN=1 bash scripts/sc026_deploy.sh
```

### What the migration does

Six additive columns on the `AuthConfig` singleton. No column altered or
dropped, no table created, no backfill, no row written. Postgres adds a
`NOT NULL` column with a constant default without rewriting the table, so lock
time is milliseconds.

Every boolean default reproduces today's behaviour exactly:

| Column | Default | Meaning |
|---|---|---|
| `workerSmsLoginEnabled` | `true` | worker SMS login is on today |
| `expressCheckInEnabled` | `true` | express check-in is available today |
| `invitedWorkersOnly` | `false` | access stays governed per site |
| `requireActiveSiteAssignment` | `false` | as above |
| `workerSessionTtlSeconds` | `NULL` | falls through to env → default (2h) |
| `updatedByUserId` | `NULL` | who last changed it, from the Platform side |

`workerSessionTtlSeconds` is deliberately **nullable**. `NULL` means "fall
through"; a `NOT NULL` column with a default would silently pin the value and
make the `WORKER_TTL_SECONDS` env key dead.

---

## 3. Verification plan

### 3.1 Automatic — run by the scripts

- `sc026_migrate.sh` [4/6] — refuses to proceed if production history contains
  any failed or unfinished migration, and prints what is pending before
  applying it.
- `sc026_verify.ts` — asserts each column's type, nullability and default;
  asserts the Admin Centre's six columns are untouched; asserts **no config row
  was fabricated**. A row means "an administrator chose these values", and
  nobody has.
- `sc026_deploy.sh` [2/9] — the ordering guard (§4.1).
- `sc026_deploy.sh` [3/9] — 13 source assertions. Each was tested by breaking
  the code and confirming the guard fires; all 13 caught their break.
- `sc026_deploy.sh` [9/9] — BUILD_ID cutover, health check, route smoke test.
  The smoke test includes `/api/platform/auth-settings` on purpose: it is the
  path that breaks if schema and code are out of step, and it is not a page
  anyone would think to click.

### 3.2 Manual — a human, after cutover

**As a Director**

1. Settings shows three areas; open **Authentication & access**.
2. Four regions render: Login methods, Session security, OTP settings, Access
   controls.
3. Footer reads *"Not yet configured — the values shown are the platform
   defaults."*
4. OTP region is read-only and says the Admin Centre owns it.
5. Toggle **Invited workers only** on → **Require an active site assignment**
   becomes enabled. Toggle it back off → the stricter rule clears rather than
   being left orphaned.
6. **Save settings** → success, footer changes to *"Last changed by …"*.
7. Reload → the saved values persist.

**As a Project Manager**

8. Same page, same four regions, banner: *"You can see these settings but not
   change them."*
9. Every switch and number input is inert. No Save button.

**As any other role** (Supervisor, Contractor Manager, …)

10. `/platform/dashboard/settings/authentication` redirects to the dashboard.

**Enforcement — the point of the release**

11. Worker check-in still succeeds with the access toggles off (proves the
    floor defaults to today's behaviour).
12. Turn **SMS login for workers** off → a worker OTP request is refused and
    **no code is sent**. Turn it back on → codes send again.
13. Turn **Express check-in** off → `POST /api/worker/express-checkin` is
    refused *at the write*, not merely hidden in the UI.

> Step 13 matters more than it looks. The endpoint is directly reachable, so a
> UI-only gate would not be a gate at all.

### 3.3 What "no change" looks like

Until a Director presses Save, **nothing is different for anyone**. That is the
release's safety property, and the best evidence the deploy went well is that
no user notices it.

---

## 4. Production risks

### 4.1 Ordering — the only risk that causes an outage

The new build `SELECT`s six columns that exist only after the migration.
Against an un-migrated database this does not degrade gracefully: every query
touching `AuthConfig` raises, which takes down **worker OTP login and platform
session creation** — i.e. nobody can sign in.

Mitigated: `sc026_deploy.sh` [2/9] opens a firewall rule, counts the six
columns in production and exits 1 if fewer than six are present. There is no
flag to skip it on a real run.

### 4.2 "SMS one-time codes: Available" is a config claim, not a health check

The Login methods region shows **Available**, derived from `smsOtpEnabled`.
Production runs `SMS_PROVIDER=mock`. So the row can read *Available* while no
real text message is ever sent.

This is pre-existing and not introduced here, but this release is the first
screen to make a visible claim about it. **Recommend** confirming the intended
production SMS provider separately. Nothing in this release should be read as
evidence that SMS delivery works.

### 4.3 Shortening a session timeout does not sign anyone out

Sessions are stateless signed tokens with no server-side store and no
revocation. A new timeout applies only to sessions **created from then on**;
anyone already signed in keeps their session until it expires. The UI says so.
If someone expects "set 15 minutes" to eject current users, it will not.

### 4.4 Access controls take effect immediately and are the highest-impact switch

`Invited workers only` applies org-wide the moment it is saved, **including on
sites that do not enforce worker access themselves**. If workers have not been
invited to their projects, they stop being able to check in straight away.

That is the intended behaviour — it is the point of the control — but it is the
one setting here that can stop work on a site. The floor can only ever *narrow*
access: a site already enforcing its own stricter rules is unaffected, asserted
in the deploy script.

### 4.5 Platform session timeout is organisation-wide

A Director changing it affects every Platform user of every role, within
15 minutes – 30 days. Intended, but it is not a Director-only setting in
effect.

### 4.6 The first save changes precedence, permanently

`getAuthRuntimeConfig()` merges DB → env → default. Production currently has no
row and no auth env keys, so it runs on built-in defaults. The first Director
save writes a row, and from then on the DB value wins over any env key set
later. Nothing to do now; worth knowing before someone sets an App Service
setting and wonders why it is ignored.

---

## 5. Rollback

### 5.1 Code

```bash
git checkout b238694
bash scripts/sc026_deploy.sh    # will need BASE_COMMIT adjusted, or redeploy by zip
```

The previous build ignores the six new columns entirely. Settings loses its
third area; the two existing areas are untouched.

### 5.2 Schema — do not roll back

Leaving the columns in place **is** the rollback. Dropping them would be a
destructive change made to recover from a non-destructive one. No script is
provided for it, deliberately.

### 5.3 The part that does *not* roll back with the code

⚠️ **Read this before rolling back.**

If a Director saved before the rollback, most of what they set becomes inert —
the old build never reads `workerSmsLoginEnabled`, `expressCheckInEnabled`,
`invitedWorkersOnly`, `requireActiveSiteAssignment` or
`workerSessionTtlSeconds`, so those revert in effect automatically.

**`sessionTtlSeconds` is the exception.** It is a pre-existing column that the
old build *does* read. A platform session timeout changed through the new
screen **survives a code rollback**.

To revert it: Admin Centre → Settings → Authentication, which already owns that
field. Or set the column back to `NULL` to restore env/default fall-through:

```sql
UPDATE "AuthConfig" SET "sessionTtlSeconds" = NULL WHERE id = 'auth';
```

### 5.4 Data impact

None. The migration writes no rows and converts nothing. The only data this
release can create is a single `AuthConfig` row, written when a Director
presses Save — never by the deploy.

---

## 6. Deferred / out of scope

- **Microsoft Entra ID (SSO)**, **email OTP**, **single-session enforcement** —
  Phase 2, blocked on the underlying functionality existing.
- **OTP length** is env-configured and not editable from either portal. Shown
  read-only and labelled as such.
- Permit status/filter inconsistency (`?status=EXPIRED` returns nothing while
  rows badge Expired) — unrelated, still open, still deferred.
