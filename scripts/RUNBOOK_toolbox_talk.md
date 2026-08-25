# Runbook — Toolbox Talk audit-template description fix

Removes the internal `SC-018` reference from the one production database row that
still contains it.

| | |
|---|---|
| **Scope** | ONE column of ONE row: `AuditTemplate.description` where `name = 'Toolbox Talk'` |
| **Not touched** | All other audit templates, all template items, categories, schedules, any other seeded content |
| **Downtime** | None. No deploy, no restart — the description is read per request |
| **Apply** | `scripts/fix_toolbox_talk.sql` |
| **Rollback** | `scripts/rollback_toolbox_talk.sql` |
| **Prerequisite** | Azure Cloud Shell (its egress IP is already covered by the existing `AllowAllAzureServicesAndResourcesWithinAzureIps` rule — **no firewall change needed**) |

## The change

| | |
|---|---|
| **From** | `Supervisor-delivered briefing, recorded as a scheduled activity. SC-018 removed the toolbox-talk question from the worker induction precisely because these are delivered separately — this is where they belong.` |
| **To** | `A supervisor-delivered safety briefing, recorded as a scheduled compliance activity.` |

## Why not the seed script

Do **not** use `scripts/seed-audit-templates.ts`. It rewrites every system template *and*
performs `deleteMany` / `createMany` on all 79 template items — far wider than this change.

---

## Execution order

### 1. Open Azure Cloud Shell

<https://shell.azure.com> (or the `>_` icon in the portal). Choose **Bash**.

Confirm the right subscription:

```bash
az account show --query "{sub:name, id:id}" -o tsv
```

Expected: `Microsoft Azure Sponsorship   cb65b4e1-5e64-437f-9fba-bb207ff23539`

### 2. Upload the two SQL files

Cloud Shell → **Upload/Download files** → Upload, or paste them via
`cat > fix_toolbox_talk.sql <<'EOF' … EOF`.

Files needed: `fix_toolbox_talk.sql`, `rollback_toolbox_talk.sql`

### 3. Build the connection string

```bash
RAW=$(az webapp config appsettings list -g rgSiteComply -n sitecomply-web \
        --query "[?name=='DATABASE_URL'].value" -o tsv)
DB=$(printf '%s' "$RAW" | sed -E 's/[?&]schema=[^&]*//')
```

The `sed` is required — `psql` rejects Prisma's `?schema=` parameter with
`psql: error: invalid URI query parameter: "schema"`. Keep `sslmode=require`.

Using a shell variable also keeps the password out of your shell history.

### 4. Pre-flight (read-only — confirms exactly one row will match)

```bash
psql "$DB" -c "SELECT id, name, \"isSystem\", description FROM \"AuditTemplate\" WHERE name = 'Toolbox Talk';"
```

Expected: **1 row**, description containing `SC-018`.

> If 0 rows → the change may already be applied; run the verification in step 6 and stop.
> If >1 row → **stop** and re-check before proceeding.

### 5. Apply

```bash
psql "$DB" -f fix_toolbox_talk.sql
```

**Expected output** (verbatim from a rehearsal against a copy of the production row):

```
--- BEFORE ---
            id             |     name     | isSystem |            description
---------------------------+--------------+----------+------------------------------------
 cms70822q001jyzba8rbumyq7 | Toolbox Talk | t        | Supervisor-delivered briefing, ... SC-018 removed the toolbox-talk question ...
(1 row)

psql:fix_toolbox_talk.sql:38: NOTICE:  OK: updated 1 row.
DO
--- AFTER ---
            id             |     name     | isSystem |            description
---------------------------+--------------+----------+------------------------------------
 cms70822q001jyzba8rbumyq7 | Toolbox Talk | t        | A supervisor-delivered safety briefing, recorded as a scheduled compliance activity.
(1 row)

--- VERIFY: any SC-0xx / REV-1 left anywhere in the database? (expect 0 rows) ---
 table_name | column_name | match_value
------------+-------------+-------------
(0 rows)
```

Exit code `0`.

The row `id` will differ in production — `cms70822q...` is from the rehearsal database.
Everything else should match.

### 6. Verify

The script's own final query is the database-wide check: it scans **every text/varchar column
in the `public` schema** for `SC-0xx` / `REV-1`. **`(0 rows)` is the pass condition.**

Then confirm in the UI:

**Platform → Audits → Templates → Toolbox Talk**

should read *"A supervisor-delivered safety briefing, recorded as a scheduled compliance
activity."* No restart or cache clear is needed.

---

## Failure modes

The `UPDATE` is guarded on three conditions (`name`, `isSystem = true`, and
`description LIKE '%SC-018%'`) inside a `DO` block that raises unless **exactly one** row
matches. Anything unexpected rolls back the whole statement — no partial writes.

| Symptom | Meaning | Action |
|---|---|---|
| `ERROR: Expected exactly 1 matching row, found 0. No change made (rolled back).` | Already applied, or the text differs from expectation | Run step 6. If the wording is already correct, you are done — this is the safe idempotent refusal (exit code 3) |
| `ERROR: ... found 2` (or more) | Duplicate Toolbox Talk templates exist | **Stop.** Nothing was changed. Investigate before retrying |
| `psql: error: invalid URI query parameter: "schema"` | The `?schema=` strip in step 3 was skipped | Re-run step 3 |
| `could not connect to server` / timeout | Not running from an Azure-side host | Use Cloud Shell, not a local terminal |

---

## Rollback

Restores the byte-exact pre-fix string (taken from the deployed seed at commit `55a7eb0`),
under the same one-row guard.

```bash
psql "$DB" -f rollback_toolbox_talk.sql
```

**Expected output:**

```
psql:rollback_toolbox_talk.sql:27: NOTICE:  ROLLED BACK: restored 1 row to the pre-fix description.
DO
            id             |     name     |            description
---------------------------+--------------+------------------------------------
 cms70822q001jyzba8rbumyq7 | Toolbox Talk | Supervisor-delivered briefing, ... SC-018 removed ...
(1 row)
```

No deploy or restart is involved in either direction.

---

## Pre-verification performed

Rehearsed against a local database seeded with the exact production row:

| Check | Result |
|---|---|
| Fix applies | `NOTICE: OK: updated 1 row.` |
| Other 11 audit templates after | md5 `c75da3ebf7eb9b4effe772e81b4c7b6f` — identical to baseline |
| All template items after | md5 `1d38cc1e5864a08dd0e5e1569f1480fe`, 79 items — identical to baseline |
| Re-run (idempotency) | Refuses with `found 0`, row left intact |
| Rollback | Restores the exact prior string |
| Re-apply after rollback | Clean — round-trip verified in both directions |
| DB-wide SC/REV scan after | `(0 rows)` across all 527 text columns |

The md5 fingerprints are the evidence for the scope constraint: nothing outside that one
description changed.

## Related, NOT included in this change

`prisma/migrations/20260820100000_remove_worker_messages_panel/` is committed but still
unapplied in production — prod's App Service startup command is `next start`, not
`npm run start:azure`, so `prisma migrate deploy` never runs. It is currently harmless (every
read filters on `WORKER_DASHBOARD_PANEL_VALUES`), but it needs the same database access. If you
are already connected, it is a sensible second task — deliberately kept out of this runbook to
keep the scope to one record.
