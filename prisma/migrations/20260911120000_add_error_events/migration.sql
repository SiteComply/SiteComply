-- Automatic error logging (Owner Review Item 11 follow-up).
--
-- Hand-written rather than generated: this database was built with `db push`, so
-- `prisma migrate dev` cannot replay history on a shadow database. Apply with
--   psql -v ON_ERROR_STOP=1 -f migration.sql
-- then `prisma migrate resolve --applied 20260911120000_add_error_events`.
--
-- Every statement is guarded so re-running it is harmless: production applies
-- these by hand, and a half-applied migration re-run must not fail partway.

-- The reference sequence. Owned by nothing, so it survives the table being
-- altered and references stay unique for the life of the database.
CREATE SEQUENCE IF NOT EXISTS error_event_ref_seq;

DO $$ BEGIN
  CREATE TYPE "ErrorEventKind" AS ENUM (
    'SERVER_ROUTE', 'SERVER_RENDER', 'CLIENT_RENDER', 'CLIENT_UNCAUGHT', 'CLIENT_REJECTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ErrorEventPortal" AS ENUM ('PLATFORM', 'ADMIN', 'WORKER', 'PUBLIC', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ErrorEvent" (
  "id"          TEXT NOT NULL,
  "reference"   TEXT NOT NULL DEFAULT ('SC-E-' || lpad(nextval('error_event_ref_seq'::regclass)::text, 5, '0')),
  "kind"        "ErrorEventKind" NOT NULL,
  "digest"      TEXT,
  "name"        TEXT,
  "message"     TEXT NOT NULL,
  "stack"       TEXT,
  "fingerprint" TEXT NOT NULL,
  "portal"      "ErrorEventPortal" NOT NULL,
  "userRef"     TEXT,
  "userName"    TEXT,
  "userRole"    TEXT,
  "userOrg"     TEXT,
  "pagePath"    TEXT,
  "pageTitle"   TEXT,
  "route"       TEXT,
  "method"      TEXT,
  "statusCode"  INTEGER,
  "buildId"     TEXT,
  "userAgent"   TEXT,
  "browser"     TEXT,
  "os"          TEXT,
  "deviceType"  TEXT,
  "viewportWidth"  INTEGER,
  "viewportHeight" INTEGER,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ErrorEvent_reference_key"   ON "ErrorEvent"("reference");
CREATE INDEX        IF NOT EXISTS "ErrorEvent_lastSeenAt_idx"  ON "ErrorEvent"("lastSeenAt");
CREATE INDEX        IF NOT EXISTS "ErrorEvent_fingerprint_idx" ON "ErrorEvent"("fingerprint");
CREATE INDEX        IF NOT EXISTS "ErrorEvent_digest_idx"      ON "ErrorEvent"("digest");
CREATE INDEX        IF NOT EXISTS "ErrorEvent_portal_lastSeenAt_idx" ON "ErrorEvent"("portal", "lastSeenAt");
