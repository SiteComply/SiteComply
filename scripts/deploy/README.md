# Deployment scripts

One script per production deployment, kept rather than deleted because each
encodes the **guards** that were written for that change — and those guards are
the record of what had to be true for it to ship.

## Shape

Every script follows the same sequence:

1. **Source guards** — assert the change is what it claims to be *before*
   building: the expected file set, the behaviour that must be present, and the
   behaviour that must NOT have regressed.
2. **Build** — `prisma generate`, then a clean production build.
3. **Artifact guards** — assert the compiled output actually contains the change.
   These are written from **observed** build output, never from what the output
   was assumed to look like. Guessing here produces guards that fail on correct
   code, which happened more than once before the rule was adopted.
4. **Package and deploy** — zip (excluding `.git`, `.env`, `.next/cache`,
   `scripts`), then `az webapp deploy --async`.
5. **Wait for the new `BUILD_ID` on disk**, then stop/start to cut over.
6. **Health check** — the deploy is not "done" until `/api/health` returns 200.

## Conventions worth keeping

- **Dry-run the guards before deploying.** Several scripts caught their own
  faulty guards this way, with nothing uploaded.
- **Strip comments before grepping source.** Explanatory comments legitimately
  quote the strings a guard asserts are absent; a raw grep then fails on prose
  while the code is correct.
- **Assert the inverse too.** Where a rule must NOT apply (e.g. direct-id
  document access must stay unfiltered), guard that it is still absent.
- **Never `pkill -f` on a pattern matching the script's own command line** — it
  kills the script. This caught two runs.

## Note on layout

Older deploy scripts remain at `scripts/` root; these were relocated here after
the fact. Moving the older ones would be tidy but touches history for no
functional gain.
