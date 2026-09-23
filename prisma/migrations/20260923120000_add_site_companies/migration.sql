-- RAMS company ownership: a company per project, and an optional owner for an
-- assignment and for a document.
--
-- ADDITIVE ONLY. Every existing document keeps siteCompanyId NULL, which means
-- "applies to everyone on site", so nobody's visibility changes on the day this
-- runs. Narrowing happens later, and deliberately, when a document is assigned.
--
-- The backfill creates ONE company per site per EXACT trimmed company string
-- already on the roster. Names differing by case or spacing are NOT merged -
-- "test" and "Test" become two rows - because only a person on that project
-- knows whether they are one firm. The review list is in rams_company_precheck.sql.

CREATE TABLE IF NOT EXISTS "SiteCompany" (
  "id"              TEXT NOT NULL,
  "jobSiteId"       TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdByName"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteCompany_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SiteCompany_jobSiteId_fkey" FOREIGN KEY ("jobSiteId")
    REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "SiteCompany_jobSiteId_idx" ON "SiteCompany"("jobSiteId");

-- Uniqueness on the NORMALISED name: one "RS Electrical" per project however it
-- is typed next time. The stored name keeps the company's own capitalisation.
CREATE UNIQUE INDEX IF NOT EXISTS "SiteCompany_jobSiteId_name_key"
  ON "SiteCompany"("jobSiteId", lower(btrim(regexp_replace("name", '\s+', ' ', 'g'))));

ALTER TABLE "WorkerSiteAssignment" ADD COLUMN IF NOT EXISTS "siteCompanyId" TEXT;
ALTER TABLE "Document"             ADD COLUMN IF NOT EXISTS "siteCompanyId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkerSiteAssignment_siteCompanyId_fkey') THEN
    ALTER TABLE "WorkerSiteAssignment"
      ADD CONSTRAINT "WorkerSiteAssignment_siteCompanyId_fkey" FOREIGN KEY ("siteCompanyId")
      REFERENCES "SiteCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Document_siteCompanyId_fkey') THEN
    ALTER TABLE "Document"
      ADD CONSTRAINT "Document_siteCompanyId_fkey" FOREIGN KEY ("siteCompanyId")
      REFERENCES "SiteCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "WorkerSiteAssignment_siteCompanyId_idx" ON "WorkerSiteAssignment"("siteCompanyId");
CREATE INDEX IF NOT EXISTS "Document_siteCompanyId_idx" ON "Document"("siteCompanyId");

-- Backfill: one company per site per exact trimmed name already on the roster.
INSERT INTO "SiteCompany" ("id", "jobSiteId", "name", "createdByName", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text), src."jobSiteId", src.company,
       'Created from the existing roster', now(), now()
  FROM (
    SELECT DISTINCT a."jobSiteId", btrim(w.company) AS company
      FROM "WorkerSiteAssignment" a
      JOIN "Worker" w ON w.id = a."workerId"
     WHERE btrim(coalesce(w.company, '')) <> ''
  ) src
 WHERE NOT EXISTS (
   SELECT 1 FROM "SiteCompany" c
    WHERE c."jobSiteId" = src."jobSiteId"
      AND lower(btrim(regexp_replace(c."name", '\s+', ' ', 'g')))
        = lower(btrim(regexp_replace(src.company, '\s+', ' ', 'g')))
 );

-- Link each assignment to its company. EXACT trimmed match, so nothing is
-- guessed; an operative whose text matches nothing keeps no company and is
-- shown site-wide documents only.
UPDATE "WorkerSiteAssignment" a
   SET "siteCompanyId" = c.id
  FROM "Worker" w, "SiteCompany" c
 WHERE w.id = a."workerId"
   AND c."jobSiteId" = a."jobSiteId"
   AND btrim(coalesce(w.company, '')) <> ''
   AND btrim(w.company) = c."name"
   AND a."siteCompanyId" IS NULL;
