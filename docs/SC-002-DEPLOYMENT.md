# SC-002 — Deployment Runbook (Daily Bulletin)

**Status:** code complete, committed & pushed on branch `feature/branded-error-pages`.
**Not yet deployed to production. Migration not yet applied to production.** Requires
an administrator with Azure + production database access (same constraint as SC-001
— applying a prod migration from the build host / App Service is blocked).

---

## 1. Is a database migration required?

**Yes.** SC-002 adds two new tables and one enum: `SiteBulletin` (the notices),
`SiteBulletinRead` (per-worker "I've read this" acknowledgements) and
`BulletinCategory`. It is **purely additive** — no existing table, column or type is
changed — so it is backwards-compatible with the currently-running code, and can be
applied with **no downtime** ahead of the code deploy. Deploy order: **migration
first, then code** (the new code reads/writes these tables).

- **Migration file:** `prisma/migrations/20260724101608_add_site_bulletins/migration.sql`
- **Prisma migration name:** `20260724101608_add_site_bulletins`
- **Prisma checksum (sha256 of the file):**
  `50f2b0a79d2fab120ac72c7df144369e398721365ad039001a5b6ee97f191ebe`

New objects:
- enum `BulletinCategory` = `NOTICE | ANNOUNCEMENT | SAFETY_ALERT`
- table `SiteBulletin` (id, jobSiteId→JobSite ON DELETE CASCADE, category, title?, body, active, publishedAt, createdByUserId?, createdByName?, createdAt, updatedAt)
- table `SiteBulletinRead` (id, bulletinId→SiteBulletin CASCADE, workerId→Worker CASCADE, acknowledgedAt; UNIQUE(bulletinId, workerId))
- indexes on `SiteBulletin(jobSiteId, active, publishedAt)` and `SiteBulletinRead(workerId)`

Risk: creating brand-new tables takes no locks on existing tables. Fully reversible
(`DROP TABLE`/`DROP TYPE`).

---

## 2. Applying the migration

Production has `@prisma/client`, `node` and `DATABASE_URL` in the Kudu shell but **no
`prisma` CLI** (devDependency, excluded from the bundle). Also, the migration file is
not on the prod filesystem until the code is deployed — and the migration must go
first — so apply it by running SQL, not `prisma migrate deploy`.

### Option A — Node script in the Kudu Bash console (recommended)
Portal → **sitecomply-web** → Advanced Tools (Kudu) → Debug console → **Bash**, paste:

```bash
cd /home/site/wwwroot && cat > sc002_migrate.js <<'JS'
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const p = new PrismaClient();
const NAME = "20260724101608_add_site_bulletins";
const CHK = "50f2b0a79d2fab120ac72c7df144369e398721365ad039001a5b6ee97f191ebe";
const stmts = [
  `DO $$ BEGIN CREATE TYPE "BulletinCategory" AS ENUM ('NOTICE','ANNOUNCEMENT','SAFETY_ALERT'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `CREATE TABLE IF NOT EXISTS "SiteBulletin" (
     "id" TEXT NOT NULL, "jobSiteId" TEXT NOT NULL,
     "category" "BulletinCategory" NOT NULL DEFAULT 'NOTICE',
     "title" TEXT, "body" TEXT NOT NULL,
     "active" BOOLEAN NOT NULL DEFAULT true,
     "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "createdByUserId" TEXT, "createdByName" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL,
     CONSTRAINT "SiteBulletin_pkey" PRIMARY KEY ("id"))`,
  `CREATE TABLE IF NOT EXISTS "SiteBulletinRead" (
     "id" TEXT NOT NULL, "bulletinId" TEXT NOT NULL, "workerId" TEXT NOT NULL,
     "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "SiteBulletinRead_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "SiteBulletin_jobSiteId_active_publishedAt_idx" ON "SiteBulletin"("jobSiteId","active","publishedAt")`,
  `CREATE INDEX IF NOT EXISTS "SiteBulletinRead_workerId_idx" ON "SiteBulletinRead"("workerId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SiteBulletinRead_bulletinId_workerId_key" ON "SiteBulletinRead"("bulletinId","workerId")`,
  `DO $$ BEGIN ALTER TABLE "SiteBulletin" ADD CONSTRAINT "SiteBulletin_jobSiteId_fkey" FOREIGN KEY ("jobSiteId") REFERENCES "JobSite"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN ALTER TABLE "SiteBulletinRead" ADD CONSTRAINT "SiteBulletinRead_bulletinId_fkey" FOREIGN KEY ("bulletinId") REFERENCES "SiteBulletin"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN ALTER TABLE "SiteBulletinRead" ADD CONSTRAINT "SiteBulletinRead_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
];
(async () => {
  for (const s of stmts) await p.$executeRawUnsafe(s);
  const ex = await p.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1`, NAME);
  if (ex.length === 0) {
    await p.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"(id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), CHK, NAME);
    console.log("BOOKKEEPING=INSERTED");
  } else { console.log("BOOKKEEPING=ALREADY_PRESENT"); }
  const t = await p.$queryRawUnsafe(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('SiteBulletin','SiteBulletinRead') ORDER BY 1`);
  console.log("TABLES=" + t.map((x) => x.table_name).join(","));
  await p.$disconnect();
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
JS
node sc002_migrate.js && rm -f sc002_migrate.js
```
Expected: `BOOKKEEPING=INSERTED` and `TABLES=SiteBulletin,SiteBulletinRead`. Idempotent.

### Option B — raw SQL (Portal query editor / psql)
Run the exact contents of `prisma/migrations/20260724101608_add_site_bulletins/migration.sql`
(a first-time create; run once), then record the migration:
```sql
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       '50f2b0a79d2fab120ac72c7df144369e398721365ad039001a5b6ee97f191ebe',
       '20260724101608_add_site_bulletins', now(), now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE migration_name = '20260724101608_add_site_bulletins');
```

---

## 3. Deploying the code, verification, rollback

- **Deploy:** same prebuilt-zip flow as SC-001 §4 (`npm ci && npm run build` → zip incl.
  `.next` → `az webapp deploy --type zip` → poll Kudu BUILD_ID → `az webapp stop`/`start`).
- **Verify:** `/api/health` → 200; then run the testing steps in the deployment summary.
- **Rollback:** redeploy the previous build; the new tables are additive and harmless to
  leave. To remove: `DROP TABLE "SiteBulletinRead"; DROP TABLE "SiteBulletin"; DROP TYPE "BulletinCategory";`
  and delete the `_prisma_migrations` row for `20260724101608_add_site_bulletins`.
