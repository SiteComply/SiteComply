# SC-001 — Deployment Runbook (ECS/CSCS card + CSCS Smart Check verification)

**Status:** code complete, committed & pushed on branch `feature/branded-error-pages`
(commit `10acc03`). **Not yet deployed to production. Migration not yet applied to
production.** This runbook is for an administrator with Azure + production database
access to apply the migration and deploy the code.

---

## 1. Is the database migration genuinely required?

**Yes.** SC-001 persists CSCS Smart Check verification results and competency
records against the worker, plus the path to an uploaded card image. There is no
pre-existing column or JSON field capable of holding this data, so seven new
columns are added to the `Worker` table. The application code reads and writes
these columns, so **it will error at runtime if they do not exist** (worker
check-in `POST /api/worker/profile` and the platform Worker Details page).

The migration is **additive, non-destructive and backwards-compatible**:

| | Migration applied | Migration NOT applied |
|---|---|---|
| Old code (prod now) | ✅ works | ✅ works (today) |
| New code (SC-001) | ✅ intended | ❌ 500s on check-in / worker page |

The only broken combination is *new code without the migration* — hence the
required order: **apply the migration first, then deploy the code.** Applying the
migration while the current live code runs is safe (the columns are nullable or
defaulted; the old code never references them), so the migration step itself needs
no downtime.

---

## 2. The exact migration

**File:** `prisma/migrations/20260724092046_add_cscs_smart_check/migration.sql`

```sql
-- SC-001: CSCS Smart Check verification & competency record fields on Worker.
ALTER TABLE "Worker" ADD COLUMN     "cscsCardImagePath" TEXT,
ADD COLUMN     "cscsHolderName" TEXT,
ADD COLUMN     "cscsQualifications" JSONB,
ADD COLUMN     "cscsScheme" TEXT,
ADD COLUMN     "cscsVerificationStatus" TEXT,
ADD COLUMN     "cscsVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cscsVerifiedAt" TIMESTAMP(3);
```

| Column | Type | Null | Default |
|---|---|---|---|
| `cscsScheme` | TEXT | yes | — |
| `cscsVerified` | BOOLEAN | NOT NULL | `false` |
| `cscsVerificationStatus` | TEXT | yes | — |
| `cscsVerifiedAt` | TIMESTAMP(3) | yes | — |
| `cscsHolderName` | TEXT | yes | — |
| `cscsQualifications` | JSONB | yes | — |
| `cscsCardImagePath` | TEXT | yes | — |

**Prisma migration name:** `20260724092046_add_cscs_smart_check`
**Prisma checksum (sha256 of the file):**
`fec3582a9f9a3353896a5d86fefecb3a449844735b0c5b997a3f91d7ade7d154`

> Risk/lock: `ADD COLUMN` with a constant default is a metadata-only change on
> PostgreSQL 11+ (no table rewrite); `Worker` is small. Lock time is negligible.
> Fully reversible via `DROP COLUMN` (not needed — additive only).

---

## 3. Applying the migration — three options

> Note: production's deployed bundle does **not** include the `prisma` CLI (it is a
> devDependency), so `prisma migrate deploy` cannot run from the App Service as-is.
> Any method that records the migration in `_prisma_migrations` is required so a
> future migration run does not try to re-apply this one.

### Option A — Node script in the Kudu Bash console (recommended)
The App Service runtime has `@prisma/client`, `node` and `DATABASE_URL` available.
Portal → **sitecomply-web** → Advanced Tools (Kudu) → Debug console → **Bash**:

```bash
cd /home/site/wwwroot && cat > sc001_migrate.js <<'JS'
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const p = new PrismaClient();
const NAME = "20260724092046_add_cscs_smart_check";
const CHK = "fec3582a9f9a3353896a5d86fefecb3a449844735b0c5b997a3f91d7ade7d154";
(async () => {
  await p.$executeRawUnsafe(`ALTER TABLE "Worker"
    ADD COLUMN IF NOT EXISTS "cscsCardImagePath" TEXT,
    ADD COLUMN IF NOT EXISTS "cscsHolderName" TEXT,
    ADD COLUMN IF NOT EXISTS "cscsQualifications" JSONB,
    ADD COLUMN IF NOT EXISTS "cscsScheme" TEXT,
    ADD COLUMN IF NOT EXISTS "cscsVerificationStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "cscsVerified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "cscsVerifiedAt" TIMESTAMP(3)`);
  const ex = await p.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name=$1`, NAME);
  if (ex.length === 0) {
    await p.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations"(id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES($1,$2,$3,now(),now(),1)`,
      crypto.randomUUID(), CHK, NAME);
    console.log("BOOKKEEPING=INSERTED");
  } else { console.log("BOOKKEEPING=ALREADY_PRESENT"); }
  const cols = await p.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name='Worker' AND column_name LIKE 'cscs%' ORDER BY column_name`);
  console.log("CSCS_COLUMNS=" + cols.map((c) => c.column_name).join(","));
  await p.$disconnect();
})().catch((e) => { console.error("ERR " + e.message); process.exit(1); });
JS
node sc001_migrate.js && rm -f sc001_migrate.js
```
Expected output:
```
BOOKKEEPING=INSERTED
CSCS_COLUMNS=cscsCardImagePath,cscsHolderName,cscsQualifications,cscsScheme,cscsVerificationStatus,cscsVerified,cscsVerifiedAt
```
Idempotent — safe to re-run.

### Option B — `prisma migrate deploy` from a workstation with DB access
On a machine that has the repo checked out and can reach the prod DB
(temporarily whitelist the workstation IP on the `sitecomply-pg` firewall):
```bash
DATABASE_URL="<prod connection string>" npx prisma migrate deploy
```
This applies the migration and records `_prisma_migrations` automatically. Remove
the temporary firewall rule afterwards.

### Option C — Raw SQL (Portal PostgreSQL query editor / psql)
```sql
ALTER TABLE "Worker"
  ADD COLUMN IF NOT EXISTS "cscsCardImagePath" TEXT,
  ADD COLUMN IF NOT EXISTS "cscsHolderName" TEXT,
  ADD COLUMN IF NOT EXISTS "cscsQualifications" JSONB,
  ADD COLUMN IF NOT EXISTS "cscsScheme" TEXT,
  ADD COLUMN IF NOT EXISTS "cscsVerificationStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "cscsVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "cscsVerifiedAt" TIMESTAMP(3);

-- Bookkeeping (REQUIRED so future migrations don't re-apply this one):
INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid()::text,
       'fec3582a9f9a3353896a5d86fefecb3a449844735b0c5b997a3f91d7ade7d154',
       '20260724092046_add_cscs_smart_check', now(), now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                  WHERE migration_name = '20260724092046_add_cscs_smart_check');
```
Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='Worker' AND column_name LIKE 'cscs%' ORDER BY 1;   -- expect 7 rows
```

---

## 4. Deploying the code (after the migration is verified)

Standard SiteComply prebuilt-zip deploy (App Service startup is plain `next start`;
it does **not** auto-run migrations, which is why the migration is applied first):

```bash
# from the repo root, on the deploy host with `az` logged in
npm ci
npm run build                     # produces .next
# zip the project INCLUDING .next and node_modules, then:
az webapp deploy --resource-group rgSiteComply --name sitecomply-web --type zip --src-path <zip>
# poll Kudu BUILD_ID until it flips to the new build, then cut over:
az webapp stop  --resource-group rgSiteComply --name sitecomply-web
az webapp start --resource-group rgSiteComply --name sitecomply-web
```
Deploy notes from prior cutovers: `az webapp deploy` can return before files land
(or time out) while the deploy still completes server-side — poll the Kudu
`BUILD_ID` / `deployments/latest` until the new build is on disk **before** the
stop/start, or you restart onto old code. Do not switch the startup command to
`npm run start:azure`.

---

## 5. Post-deploy verification

1. `GET https://sitecomply-web.azurewebsites.net/api/health` → `200`.
2. Worker flow: verify mobile → **Your details** → expand **CSCS / ECS card
   details** → enter a card number (numeric or alphanumeric) → **Verify card &
   continue** → a "Card verified" banner should appear.
3. Platform → a worker who verified a card → **Worker information** shows a
   **Smart Check** status pill, scheme, and **Verified competencies** list.

---

## 6. Configuration note (verification provider)

`CSCS_PROVIDER` is unset in production, so it defaults to `mock` — a deterministic
stub that verifies without calling the real service. **Real verification requires a
CSCS Smart Check partner API.** When credentials are available, set the App Service
settings `CSCS_PROVIDER=smartcheck`, `CSCS_SMARTCHECK_API_URL`,
`CSCS_SMARTCHECK_API_KEY` and implement the request/response mapping in
`services/cscs/smartCheckProvider.ts`. Card images already store in the existing
private Documents blob container (`DOCS_STORAGE_*`, configured in prod) under a
`cscs-cards/` prefix; upload is best-effort and never blocks check-in.

---

## 7. Rollback

- Code: redeploy the previous build (prior prod build `1f3ef4c`).
- Schema: the columns are additive and harmless to leave in place. If removal is
  required: `ALTER TABLE "Worker" DROP COLUMN "cscsScheme", DROP COLUMN "cscsVerified", …;`
  and delete the `_prisma_migrations` row for `20260724092046_add_cscs_smart_check`.
