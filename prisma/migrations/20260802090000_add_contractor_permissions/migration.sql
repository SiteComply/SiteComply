-- SC-022 Phase 1 — per-user, per-site permission overrides + change audit.
--
-- Purely ADDITIVE: two new tables, no change to any existing column and NO
-- backfill. Absence of an override row means the role baseline applies
-- unchanged, so every existing user keeps exactly the access they have today
-- and nothing is silently reduced on deploy.

CREATE TABLE "SiteUserPermission" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "jobSiteId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "verbs" TEXT[],
    "updatedByUserId" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteUserPermission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PermissionChangeLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetName" TEXT NOT NULL,
    "targetRole" TEXT NOT NULL,
    "jobSiteId" TEXT,
    "jobSiteName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT,
    "beforeVerbs" TEXT[],
    "afterVerbs" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermissionChangeLog_pkey" PRIMARY KEY ("id")
);

-- One override row per (user, site, module): makes a write an upsert and keeps
-- the effective permission unambiguous.
CREATE UNIQUE INDEX "SiteUserPermission_platformUserId_jobSiteId_module_key" ON "SiteUserPermission"("platformUserId", "jobSiteId", "module");
CREATE INDEX "SiteUserPermission_platformUserId_idx" ON "SiteUserPermission"("platformUserId");
CREATE INDEX "SiteUserPermission_jobSiteId_idx" ON "SiteUserPermission"("jobSiteId");

CREATE INDEX "PermissionChangeLog_targetUserId_createdAt_idx" ON "PermissionChangeLog"("targetUserId", "createdAt");
CREATE INDEX "PermissionChangeLog_jobSiteId_createdAt_idx" ON "PermissionChangeLog"("jobSiteId", "createdAt");

-- Overrides cascade with the user and the site they describe. The audit log
-- deliberately has NO foreign keys: it must survive deletion of the user, the
-- actor or the site, which is exactly when an access-control trail matters most.
ALTER TABLE "SiteUserPermission" ADD CONSTRAINT "SiteUserPermission_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteUserPermission" ADD CONSTRAINT "SiteUserPermission_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
