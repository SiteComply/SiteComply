# Platform UX Refresh — rollback point

The UX Refresh is a **presentation-only** project. This document records the
rollback point created before any design or layout change, how to use it, and
what was actually verified rather than assumed.

## The rollback point

| | |
|---|---|
| **Tag** | `rev1-complete` |
| **Commit** | `44841c5` — *SC-025: Project Completion & Archive Management* |
| **Pushed to origin** | yes (verified via `git ls-remote --tags`) |
| **Production BUILD_ID when tagged** | `Oz4SPgNN-L-ZD8yrfQNk7` |
| **Production health when tagged** | `/api/health` → 200 |
| **Refresh branch** | merged to `main` on 2026-08-05; branch deleted |
| **Database migrations introduced by the refresh** | **none, by design** |

At the moment of tagging, local `HEAD`, `origin/feature/branded-error-pages` and
the production source were all the same commit with a clean working tree. The
tag therefore captures exactly what was live.

**The branches named above no longer exist.** The refresh was merged into `main`
(fast-forward to `a4957f9`, alongside the SC-002 and SC-017 follow-ups) and the
merged branches were deleted on 2026-08-05. **This changes nothing about
rollback:** `uxrefresh_rollback.sh` builds from a clean worktree at the TAG, and
`rev1-complete` is both pushed to origin and an ancestor of `main`, so the commit
it names cannot be garbage-collected. Deleting a merged branch never removes a
commit that a tag or another branch still reaches.

## Why rollback is complete

Two properties, together, make restoring the tag equivalent to restoring the
platform:

1. **No migration.** The refresh changes no schema and writes no data, so there
   is no data state to reverse. This is enforced mechanically, not by intention
   — see `scripts/uxrefresh_gate.sh`, check `[3]`.
2. **No logic.** `services/`, `app/api/`, `prisma/`, `lib/prisma.ts` and
   `middleware.ts` are frozen for the duration — gate check `[2]`.

If both gates pass on every refresh commit, putting the tagged code back puts
the platform back.

## How to roll back

```bash
scripts/uxrefresh_rollback.sh --drill     # build + verify only, touches nothing
scripts/uxrefresh_rollback.sh --confirm   # really roll production back
```

The script **builds from a separate clean git worktree at the tag** rather than
in place. This is not fussiness: every `scripts/scXXX_deploy.sh` zips the
*working tree*, so running one from a UX-refresh checkout would package the very
files you are trying to remove — the "rollback" would ship the refresh. The
worktree is asserted clean and asserted to be at the tag commit before anything
is built.

Dependencies are installed with `npm ci` in the worktree rather than reusing the
main repo's `node_modules`. `prisma generate` writes into `node_modules/.prisma`,
and a hard-linked copy would let an emergency rollback mutate the tree you are
rolling back *from*.

### Expect a new BUILD_ID

`npm run build` mints a **random `BUILD_ID` on every run**, so a rollback will
not reproduce `Oz4SPgNN-L-ZD8yrfQNk7`. Byte-identity is not the test and is not
claimed. The recorded baseline ID serves a different purpose: proving the
rollback cut over, because production's ID must move **off** the refresh build.

```bash
curl -s https://sitecomply-web.azurewebsites.net/ | grep -c '<ROLLBACK_BUILD_ID>'  # expect >=1
curl -s https://sitecomply-web.azurewebsites.net/ | grep -c '<REFRESH_BUILD_ID>'   # expect 0
curl -s -o /dev/null -w '%{http_code}' https://sitecomply-web.azurewebsites.net/api/health
```

### Timing

The App Service plan is **Linux B1**, which has **no deployment slots** — Basic
tier does not offer them. A rollback is therefore a redeploy: roughly 10–12
minutes end to end (build, zip, `az webapp deploy --async`, BUILD_ID poll,
stop/start, health). Worth knowing before you need it. Run it backgrounded and
poll the log; a foreground run exceeds the assistant's command timeout and gets
killed mid-cutover.

## What was verified in Phase 0

Not "should work" — actually executed:

- **Tag exists and is on the remote.** `git ls-remote --tags origin` returns
  `rev1-complete` dereferencing to `44841c5`.
- **The gate passes at baseline** — all six checks, empty footprint.
- **The gate FAILS when it should.** Four frozen zones were deliberately
  breached (a colour token, a service, `package.json`, the worker portal); all
  four were caught, the print-bearing warning fired, exit code `1`. The tree was
  then restored clean. A gate that has only ever passed is untested.
- **The rollback path executes.** `--drill` creates the worktree, asserts it is
  clean and at the tag, installs dependencies, builds the baseline, and
  spot-checks that load-bearing REV-1 code (SC-025 read-only guard, SC-024
  archive, SC-014 scoring) is present in the built tree.

## Scope reminder

Frozen for the whole project: functionality, workflows, permissions, business
logic, calculations, report figures/filters/exports, security, database
structure, colours, branding, the worker portal, check-in and the Admin Centre.

In scope: layout, visual hierarchy, information density, spacing, grouping,
navigation, presentation.

Treated as benchmarks and left substantially alone: **SC-014 Audit Scoring**,
**SC-015 Action Assignment**, **SC-024 Close-Out Pack generator**.
