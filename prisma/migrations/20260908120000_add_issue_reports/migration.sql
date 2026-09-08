-- Issue reporting (Phase 1): capture and storage.
--
-- Hand-written rather than generated: this database was built with `db push`,
-- so `prisma migrate dev` cannot replay history on a shadow database. Apply
-- with `psql -v ON_ERROR_STOP=1 -f`, then `prisma migrate resolve --applied`.

CREATE TYPE "IssueReportType" AS ENUM ('BUG', 'FEEDBACK', 'SUGGESTION');
CREATE TYPE "IssueReportPortal" AS ENUM ('PLATFORM', 'ADMIN', 'WORKER');
CREATE TYPE "IssueReportDelivery" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DISABLED');

-- The reference sequence. Owned by nothing, so it survives the table being
-- altered; references stay unique for the life of the database rather than
-- restarting and colliding with one already quoted in an email.
CREATE SEQUENCE IF NOT EXISTS issue_report_ref_seq START 1;

CREATE TABLE "IssueReport" (
    "id"                TEXT NOT NULL,
    "reference"         TEXT NOT NULL DEFAULT ('SC-R-' || lpad(nextval('issue_report_ref_seq'::regclass)::text, 4, '0')),
    "type"              "IssueReportType" NOT NULL,
    "description"       TEXT NOT NULL,
    "portal"            "IssueReportPortal" NOT NULL,
    "reporterRef"       TEXT NOT NULL,
    "reporterName"      TEXT NOT NULL,
    "reporterRole"      TEXT NOT NULL,
    "reporterOrg"       TEXT,
    "reporterEmail"     TEXT,
    "contactRequested"  BOOLEAN NOT NULL DEFAULT false,
    "pagePath"          TEXT NOT NULL,
    "pageTitle"         TEXT,
    "buildId"           TEXT,
    "activeSiteId"      TEXT,
    "activeSiteName"    TEXT,
    "userAgent"         TEXT NOT NULL,
    "browser"           TEXT,
    "os"                TEXT,
    "deviceType"        TEXT,
    "viewportWidth"     INTEGER,
    "viewportHeight"    INTEGER,
    "devicePixelRatio"  DOUBLE PRECISION,
    "deliveryStatus"    "IssueReportDelivery" NOT NULL DEFAULT 'PENDING',
    "deliveryAttempts"  INTEGER NOT NULL DEFAULT 0,
    "deliveryLastError" TEXT,
    "deliveredAt"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssueReport_reference_key" ON "IssueReport"("reference");
CREATE INDEX "IssueReport_createdAt_idx" ON "IssueReport"("createdAt");
CREATE INDEX "IssueReport_deliveryStatus_idx" ON "IssueReport"("deliveryStatus");
-- Rate limiting counts on this pair, so it is indexed for that shape.
CREATE INDEX "IssueReport_reporterRef_createdAt_idx" ON "IssueReport"("reporterRef", "createdAt");
