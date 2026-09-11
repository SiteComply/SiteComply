# Automatic error logging

Unexpected failures are recorded to the `ErrorEvent` table with enough context to
investigate them later, so a crash report no longer depends on what the person
happened to write down. Every record gets a reference (`SC-E-00001`, …).

Review at **Platform → Settings → Error log** (same roles as the rest of
Settings).

## What is captured

| Source | File | Catches |
| --- | --- | --- |
| API route failures | `lib/routeErrors.ts` | Any write handler that throws. Full stack. Re-thrown, so the response is unchanged. |
| Page crashes | `app/error.tsx`, `app/global-error.tsx` | Posts `error.digest` — the reference code the user is shown, and the key the server-side stack is logged under. |
| Event handlers, timers | `components/telemetry/ErrorTelemetry.tsx` | `window.onerror`. An error boundary only covers rendering; these walk straight past it. |
| Rejected promises | same | `unhandledrejection`. |

`ProjectClosedError` is deliberately **not** recorded: it is a refusal the
product means to send, not a fault.

Context: portal, user ref/name/role, page path, route, method, build id,
browser, OS, device, viewport, first and last seen, occurrence count.

## What is deliberately not stored

- **Query strings.** Stripped from every path. On these screens they carry
  operative names and date ranges — the same reason `IssueReport.pagePath` is
  path-only.
- **Emails, phone numbers, bearer tokens, `password`/`secret`/`token` values.**
  Redacted from messages and stacks (`redact()` in `services/telemetry/errorLog.ts`).
- **An operative's mobile.** Never the actor ref; no `workerId` means no ref.
- **Request bodies.** Never read.

## Volume control

- Repeats of one fingerprint inside an hour fold into one row with a count.
- The process caps inserts at 60/minute.
- `POST /api/telemetry/error` is rate limited to 20/minute per IP, caps the body
  at 16 KB and always answers `204` — it is a write-only drop box.

## Retention

90 days (`RETENTION_DAYS`). Purged by `purgeOldErrors()`, called from the hourly
sweep in `app/api/system/reports/deliver/route.ts` — placed *before* the mail
branch so retention still runs when mail is switched off. No new timer, no new
app setting.

## Later: Application Insights

Complementary, not a replacement. It needs `Microsoft.Insights` registered on the
subscription (currently `NotRegistered`, and registering it requires
subscription-level rights). This table stays either way: it is the searchable,
UK-resident record with product context attached.

---

# Migration runbook

Production runs `next start`, **not** `npm run start:azure`, so
`prisma migrate deploy` never runs there. This migration is applied by hand.

File: `prisma/migrations/20260911120000_add_error_events/migration.sql`

Every statement is guarded (`IF NOT EXISTS`, `EXCEPTION WHEN duplicate_object`),
so re-running it is harmless. Verified idempotent by applying it twice locally.

## 1. Pre-check

Confirm you are on the right database and that nothing already exists:

```sql
SELECT current_database(), current_user, inet_server_addr();

SELECT to_regclass('public."ErrorEvent"')      AS error_event_table,   -- expect NULL
       to_regclass('public.error_event_ref_seq') AS ref_sequence,      -- expect NULL
       EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ErrorEventKind')   AS kind_type,   -- expect false
       EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ErrorEventPortal') AS portal_type; -- expect false

-- Sanity: this should be the SiteComply database.
SELECT count(*) FROM "JobSite";
```

If `error_event_table` is not NULL the migration has already been applied — skip
to step 3.

## 2. Migration

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f prisma/migrations/20260911120000_add_error_events/migration.sql
```

Expected output: `CREATE SEQUENCE`, two `DO`, `CREATE TABLE`, five `CREATE INDEX`.

## 3. Verification

```sql
-- a. The table exists with all 28 columns.
SELECT count(*) AS columns FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ErrorEvent';        -- expect 28

-- b. All five indexes exist.
SELECT indexname FROM pg_indexes
WHERE tablename = 'ErrorEvent' ORDER BY indexname;                  -- expect 6 rows (5 + pkey)

-- c. Both enum types exist with the right members.
SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('ErrorEventKind', 'ErrorEventPortal')
GROUP BY t.typname;

-- d. The reference sequence issues a usable reference. Inserts one row, reads
--    it back, then removes it — nothing is left behind.
INSERT INTO "ErrorEvent" ("id", "kind", "portal", "message", "fingerprint")
VALUES ('migration-check', 'SERVER_ROUTE', 'SYSTEM', 'migration check', 'migration-check');

SELECT "reference", "occurrences", "firstSeenAt" IS NOT NULL AS stamped
FROM "ErrorEvent" WHERE "id" = 'migration-check';                   -- expect SC-E-00001, 1, true

DELETE FROM "ErrorEvent" WHERE "id" = 'migration-check';

SELECT count(*) FROM "ErrorEvent";                                  -- expect 0
```

## 4. Cleanup

Nothing to remove — step 3d deletes its own row. The sequence will have advanced
by one, which is expected and harmless (references are unique, not gapless).

If this database keeps Prisma migration bookkeeping, record the migration as
applied so a future `migrate deploy` does not try to replay it:

```bash
npx prisma migrate resolve --applied 20260911120000_add_error_events
```

## Rollback

Only if the migration must be undone. No other table references `ErrorEvent`, so
dropping it affects nothing else; the app treats a missing table as "logging off".

```sql
DROP TABLE IF EXISTS "ErrorEvent";
DROP TYPE  IF EXISTS "ErrorEventKind";
DROP TYPE  IF EXISTS "ErrorEventPortal";
DROP SEQUENCE IF EXISTS error_event_ref_seq;
```

## After the migration

Deploy the code. Until then the app is unaffected: every capture path degrades to
a no-op and the Error log page reports that logging is not switched on, rather
than failing.
