# SiteComply compliance scheduler timer (SC-020 Phase 4)

An hourly Azure Functions timer that calls `POST /api/system/compliance/tick`
on the SiteComply web app, which generates compliance occurrences on a rolling
60-day horizon and records escalations.

## Why a Function App and not a Logic App

A Logic App recurrence trigger was the preferred option, but
`Microsoft.Logic` is **not registered** on this subscription and registering a
resource provider is a subscription-level action this account cannot perform
(it holds Contributor on `rgSiteComply` only). `Microsoft.Web` is already
registered, so a Function App timer delivers the same architecture — an
external clock calling a secret-guarded HTTP endpoint — with no new provider.

## Design notes

- **No business logic here.** Generation, escalation and idempotency live in
  `services/compliance/schedulerRunner.ts`, exercised by the app's tests. This
  function only makes an HTTP call.
- **No secret in source.** `SCHEDULER_SECRET` and `TICK_URL` are App Service
  settings on the function app; they must match the web app's
  `SCHEDULER_SECRET`.
- **Missing configuration throws** rather than returning quietly, so a
  misconfigured timer cannot masquerade as a healthy quiet hour.
- **The app owns run history.** Every triggered run — success or failure — is
  written to `SchedulerRun` and surfaced on the Compliance Calendar, which is
  why this function needs no state of its own.
- Node 24 on the Functions **v4 programming model** (`app.timer(...)` in
  `src/functions/`). Node 20 is past end-of-life and is refused by
  `az functionapp create`, and Node 22+ dropped the older `function.json`
  model — so the single dependency `@azure/functions` is unavoidable. It is
  committed with the app and zipped with `node_modules`, so no build runs on
  deploy.
- `host.json` declares the **extension bundle**, without which the timer
  binding is not available to a JavaScript function at all.

## Deploying

`scripts/sc020p4_timer.sh` creates the storage account and function app,
applies the settings, zips this directory and deploys it. It is idempotent —
re-running it updates the code and settings in place.
