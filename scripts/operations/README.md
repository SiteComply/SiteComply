# Operations scripts

Diagnostic and data-maintenance scripts used against production. Read the script
before running it — some read, some write.

| Script | Purpose |
|---|---|
| `audit_test_workers.sql` | Read-only. Identifies seeded test worker records. |
| `diagnose_test_worker.sql` | Read-only. Inspects a single worker's state when a login or check-in behaves unexpectedly. |
| `rename_test_workers.sql` | **Writes.** Renames test workers to an archived form so they are distinguishable from real records. |
| `platform_otp_e2e.ts` | End-to-end probe of the platform OTP sign-in path. |

## Running against production

The database is not reachable from a developer machine — the Azure Postgres
firewall does not allow it, and `prisma migrate deploy` never runs because the
App Service start command is `next start`.

The working route is the **Kudu console**, but note `wwwroot/node_modules` is
empty on this app: Oryx ships a `node_modules.tar.gz` that only the app container
extracts. A Node script therefore needs the client extracted first:

```bash
tar -xzf node_modules.tar.gz -C /tmp/x/node_modules ./@prisma ./.prisma
NODE_PATH=/tmp/x/node_modules node yourscript.js
```

Always **dry-run first**, and clean up the uploaded script afterwards. Anything
that writes should be idempotent and report what it changed.

See also `scripts/backfill-*.mjs` for the same pattern applied to migrations.
