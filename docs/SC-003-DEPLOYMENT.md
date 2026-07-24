# SC-003 — Worker Dashboard: deployment runbook

**Scope:** SC-003 only (REV-1). No part of SC-004 or any later REV-1 item is
implemented here.

---

## 1. What SC-003 adds

A dedicated **Worker Dashboard** that becomes the worker's landing page after a
successful site check-in, at `/worker/dashboard`, plus its detail pages and the
per-site configuration that lets site managers control what it shows.

Everything a worker sees is scoped to the **one site they hold an open check-in
for**. That open check-in (a `Submission` with no `checkedOutAt`) is the entire
access boundary: the site is derived from it server-side and is never taken from
the request. Checking out revokes dashboard and document access immediately.

### Panels (the twelve SC-003 requirement bullets)

| Panel | Default | Source |
| --- | --- | --- |
| Site information | ON | `JobSite` |
| Daily Bulletin | ON | `SiteBulletin` (SC-002) |
| Active permits | **OFF** | *no source system yet* |
| RAMS | ON | `Document` where `category = RAMS` |
| Site documents | ON | `Document` where `category <> RAMS` |
| Emergency information | ON | `JobSite.nearestHospital`, `emergencyNumber` |
| First aider details | ON | `JobSite.firstAider*` |
| Fire assembly point | ON | `JobSite.fireAssemblyPoint` |
| Site contacts | ON | `SiteContact` (new) |
| Outstanding actions | ON | `Action` where status OPEN/IN_PROGRESS |
| Messages and notifications | **OFF** | *no source system yet* |
| Check-out button | ON (**locked**) | `Submission` |

Two deliberate decisions worth flagging:

- **Active permits** and **Messages** have no backing system in SiteComply. A
  digital permit-to-work register and worker messaging are separate REV-1 items
  and were **not** built. Both panels exist in the catalogue and are configurable
  so the dashboard is "capable of displaying" them, but they default to OFF and,
  if switched on, render an honest "not available yet" state rather than a `0`
  that would read as "no permits are in force".
- **Check-out is locked ON.** A site manager can switch off any other panel, but
  not this one: a worker who cannot check out cannot end their attendance record,
  which would leave them on the site's fire register. The lock is enforced in the
  service (`getPanelVisibility` forces it true on read and `updatePanelVisibility`
  skips it on write), so even a hand-edited database row cannot hide it.

### Routes added

Worker (all require an open check-in):
`/worker/dashboard`, `/worker/site-information`, `/worker/bulletins`,
`/worker/rams`, `/worker/documents`, `/worker/emergency`, `/worker/contacts`,
`/worker/actions`, `/worker/permits`, `/worker/messages`.

APIs: `GET /api/worker/documents/[id]/download`, `GET /api/worker/logout`,
`PATCH /api/platform/sites/[id]/dashboard`,
`POST /api/platform/sites/[id]/contacts`,
`PATCH|DELETE /api/platform/site-contacts/[contactId]`.

A panel switched off removes both its card **and** its sidebar link, and its page
redirects to the dashboard — there is no way to reach hidden content by URL.

---

## 2. Is a database migration required?

**Yes**, and it is **purely additive** — no existing table, column, type or
constraint is changed or dropped. It is therefore backwards-compatible with the
currently-running SC-002 code and can be applied with **no downtime ahead of** the
code deploy. Deploy order: **migration first, then code.**

- **Migration file:** `prisma/migrations/20260724150000_add_worker_dashboard/migration.sql`
- **Prisma migration name:** `20260724150000_add_worker_dashboard`
- **Checksum (sha256 of the file):**
  `628cf26c153ec2a9323fa90f14a91b487c509d788a5291f105ed5f0636117f83`

New objects:

- enum `WorkerDashboardPanel` — the twelve panel keys above
- table `SiteContact` (id, jobSiteId→JobSite ON DELETE CASCADE, role, name?,
  phone?, order, createdAt, updatedAt); index on `(jobSiteId, order)`
- table `SiteDashboardSetting` (id, jobSiteId→JobSite ON DELETE CASCADE, panel,
  enabled, updatedByUserId?, updatedByName?, createdAt, updatedAt);
  UNIQUE `(jobSiteId, panel)`, index on `(jobSiteId)`
- three nullable `JobSite` columns: `firstAiderLocation`, `nearestHospital`,
  `emergencyNumber`

**Risk:** creating new tables takes no locks on existing tables. `ADD COLUMN`
with no default and no `NOT NULL` is a catalogue-only change in PostgreSQL — it
does not rewrite the `JobSite` table and takes only a brief `ACCESS EXCLUSIVE`
lock. Fully reversible (`DROP TABLE` / `DROP TYPE` / `ALTER TABLE … DROP COLUMN`).

**No backfill is needed.** `SiteDashboardSetting` stores *overrides only*: a site
with no rows uses the built-in defaults, so every existing site gets a working
dashboard the moment the code lands, and a future change to a default
automatically reaches every site that never touched that panel.

---

## 3. Deployment dependencies

- **SC-002 must be live** — the dashboard renders the Daily Bulletin board and
  reuses `BulletinBoard` and `bulletinService`. Verified live before this work
  began (prod `BUILD_ID` matched the SC-002 build; prod DB reported all 26
  migrations applied).
- **Azure Blob storage** — the worker document download streams from the existing
  private Documents container via `downloadDocumentBlob`. No new container,
  credential or setting. If `AZURE_STORAGE_*` is unset the route returns a clean
  404 ("The file is no longer available") rather than erroring.
- **No new environment variables, secrets, app settings or dependencies.**
- **Database reachability from the build host** — the migration needs a temporary
  PostgreSQL firewall rule for this host's public IP (created and removed by the
  script).

---

## 4. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Workers can now read site documents and RAMS, which was previously platform-only | Medium | Access requires an open check-in for that document's exact site; re-derived server-side on every request; revoked on check-out. Verified with a cross-site document (refused) and after check-out (refused). |
| Outstanding actions become visible to any checked-in worker | Low–Medium | Only title, priority, status and due date are exposed — never the assignee, description, completion notes, evidence or timeline. Panel can be switched off per site if a site treats its action register as confidential. |
| Post-check-in redirect changes (`/check-in/confirmation/…` → `/worker/dashboard`) | Low | The confirmation page is unchanged and still reachable; it is where checking out returns the worker, and it now links forward to the dashboard. |
| A site manager hides a panel workers need | Low | Only the site's own managers can change it, every panel is one toggle away from being restored, and check-out cannot be hidden at all. |
| Worker session (2h TTL) expires while still on site | Low | Pre-existing behaviour, unchanged. A worker with a valid session but no open check-in is sent to the site selector, not a dead end. |

---

## 5. Applying the migration

```bash
scripts/sc003_migrate.sh
```

Adds a temporary DB firewall rule for this host, runs `prisma migrate deploy`,
verifies the two new tables and three new `JobSite` columns exist, and always
removes the firewall rule on exit.

## 6. Deploying the code

```bash
scripts/sc003_deploy.sh
```

Builds, zips (including `.next` and `node_modules`), pushes to App Service, waits
for the new `BUILD_ID` to appear on disk, then stop/starts to cut over and
health-checks `/api/health`.

## 7. Rollback

- **Code:** redeploy the previous commit (`a8c658d`, SC-002) with the same script.
  The SC-002 code ignores the new tables and columns entirely, so no database
  change is required to roll the code back.
- **Database:** only if you also want the schema gone —
  `DROP TABLE "SiteDashboardSetting"; DROP TABLE "SiteContact";
  DROP TYPE "WorkerDashboardPanel";
  ALTER TABLE "JobSite" DROP COLUMN "firstAiderLocation", DROP COLUMN
  "nearestHospital", DROP COLUMN "emergencyNumber";`
  then delete the row from `_prisma_migrations`.
