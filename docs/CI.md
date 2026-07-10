# Continuous Integration

SiteComply runs a GitHub Actions pipeline that validates every change before it
can be merged or deployed. It is the automated equivalent of the checks a
developer runs locally, so a broken build or a type error can't reach the
`feature/archived-badge-style` deploy branch unnoticed.

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

## What it runs

The `Validate` job runs three gates in order. Each must pass; the first failure
stops the job and marks the **CI / Validate** check red on the commit and PR.

| # | Gate | Command | What it catches |
|---|------|---------|-----------------|
| 1 | Typecheck | `npm run typecheck` (`tsc --noEmit`) | Type errors across the whole codebase |
| 2 | Lint | `npm run lint` (`next lint`) | ESLint errors/warnings (config in `.eslintrc.json`) |
| 3 | Production build | `npm run build` (`next build`) | Anything that breaks a real production compile |

`npm ci` installs from `package-lock.json` and runs the `postinstall`
(`prisma generate`), so the Prisma client is available before the gates run.

## When it runs

- **Every push** (any branch).
- **Every pull request.**

A `concurrency` group cancels an in-flight run when a newer commit is pushed to
the same branch/PR, so CI always reflects the latest commit.

## How failures block

A failed gate exits non-zero, which fails the job and produces a **failing status
check** on the push/PR. To make that check *block merges* (not just display), a
one-time repository setting is required:

> **Settings → Branches → Branch protection rules** → add a rule for `main` (and
> `feature/archived-badge-style` while it is the deploy branch) → enable
> **"Require status checks to pass before merging"** and select **CI / Validate**.

Until branch protection is enabled the check is advisory (red, but non-blocking).
The workflow itself needs no changes to enforce this.

## Reproduce locally

Run the exact same gates before pushing:

```bash
npm ci            # or: npm install
npm run typecheck
npm run lint
npm run build
```

## Environment & parity

- **Node 22** — matches the App Service runtime (`NODE|22-lts`), so the build is
  validated on the same major version that serves production.
- **`DATABASE_URL`** is set to a placeholder. The gates never connect to a
  database: `prisma generate` only needs the schema, and the app's data access is
  lazy / `force-dynamic`, so `next build` compiles without a live DB.
- **No secrets** are required by CI. It performs read-only validation and never
  deploys.

## Follow-ups

- `.nvmrc` / `package.json#engines` still pin Node 20 (gap-analysis **Q8**); the
  pipeline pins 22 to match production. Aligning those pins is a separate change.
- Unit tests (gap-analysis **Q1**) are not part of the pipeline yet. When added,
  insert a `Test` gate between Lint and Build.
