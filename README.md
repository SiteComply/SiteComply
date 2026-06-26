# SiteComply

Mobile-first digital site inductions and compliance check-in for **UK
construction sites**. SiteComply lets a trade worker arriving on site complete
their required health &amp; safety checks, PPE confirmation, site-rules
acknowledgement and check-in **digitally in under two minutes** — replacing
paper inductions and sign-in sheets.

There are two user types:

- **Workers** — verify with an SMS one-time passcode (MFA), select their site,
  complete the digital induction and receive a clear "you are compliant and
  checked in" confirmation.
- **Admins** — sign in with **Microsoft (Azure AD)**, manage sites and
  checklists, see who is on site now, and search/report on submissions.

All dates display as `DD/MM/YYYY`, times in 24-hour `Europe/London`, phone
numbers validate as UK mobiles and normalise to E.164 `+44…`, and personal data
is handled in line with **UK GDPR / Data Protection Act 2018**.

---

## Tech stack

| Layer       | Choice                                                              |
| ----------- | ------------------------------------------------------------------- |
| Frontend    | Next.js (App Router) + TypeScript + Tailwind CSS                    |
| API         | Next.js Route Handlers (`app/api`) with logic in `services/`        |
| Database    | PostgreSQL (Azure Database for PostgreSQL Flexible Server) + Prisma |
| Admin auth  | Microsoft Azure AD via MSAL                                         |
| Worker auth | SMS OTP via Azure Communication Services (provider abstracted)      |
| Hosting     | Azure App Service (or Static Web Apps + linked API)                 |

The frontend, API, auth and data layers are kept clearly separated so any one
can be replaced or extracted later.

## Project structure

```
app/         Next.js routes (App Router) and route handlers (app/api)
components/   Reusable UI (brand, layout, ui primitives)
lib/          Clients & cross-cutting config (lib/config.ts, lib/cn.ts)
services/     Business logic — the API layer’s core, extractable later
prisma/       Prisma schema, migrations and seed (added in Stage 2)
types/        Shared TypeScript types
public/       Static assets (logo, etc.)
```

## Local setup

> Requires Node.js 18.18+ (Node 20 LTS recommended).

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env        # then fill in values as stages are built

# 3. Run the dev server
npm run dev                 # http://localhost:3000
```

Useful scripts:

```bash
npm run build         # production build
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format        # Prettier (incl. Tailwind class sorting)
```

> **British English** is used throughout the UI and code comments
> (organisation, colour, acknowledgement, licence…). This is a code-review
> convention — Prettier handles formatting and Tailwind class ordering, not
> spelling.

## Configuration & secrets

Every external dependency is read from environment variables — see
[`.env.example`](./.env.example) for the full list (database, Azure AD, Azure
Communication Services, session secret). **No secrets are hard-coded.** In
production these come from Azure App Service settings backed by **Azure Key
Vault** references.

## Azure deployment outline

A full `DEPLOYMENT.md` is produced in Stage 13. The intended shape:

1. **Azure Database for PostgreSQL Flexible Server** — create the server &amp;
   database; set `DATABASE_URL` (with `sslmode=require`).
2. **Azure AD App Registration** — for admin SSO; configure redirect URI and a
   client secret; set `AZURE_AD_*` variables.
3. **Azure Communication Services** — provision SMS; set `ACS_CONNECTION_STRING`
   and `ACS_SMS_SENDER`.
4. **Azure Key Vault** — store secrets; reference them from App Service
   configuration rather than storing raw values.
5. **Azure App Service** (Node) — deploy the Next.js app; `npm run build` then
   `npm run start`; map all environment variables.

## Build status

This project is being built in stages.

- **Stage 1 — Foundation &amp; scaffolding** ✅ project structure, design tokens,
  responsive shell, landing screen, linting/formatting, documented env vars.
- **Stage 2 — Data models &amp; schema** ✅ Prisma schema for workers, sites,
  versioned checklists, submissions and admins; initial migration; UK seed data
  (3 sites, a full UK induction checklist, workers across 2 companies, sample
  check-ins).
- **Stage 3 — Worker SMS OTP (MFA)** ✅ UK mobile validation/normalisation to
  E.164, a pluggable `SmsProvider` (Azure Communication Services default, Twilio
  stub, console mock for dev), hashed/expiring one-time codes with request
  cooldown + hourly cap + attempt limits, and a mobile-first
  enter-number → enter-code flow that establishes a short-lived worker session.
- **Stage 4 — Identity &amp; site selection** ✅ name/company capture (pre-filled
  for recognised workers) with optional CSCS card details, a searchable list of
  large tappable site cards, step gating + progress indicator, and draft
  persistence so a dropped connection keeps the worker's place. British
  date/time helpers added (`lib/datetime.ts`).
- **Stage 5 — Digital induction &amp; compliance checklist** ✅ a dynamic,
  one-question-per-screen wizard built from the site's checklist (H&amp;S
  acknowledgements, yes/no, a grouped PPE tap-to-confirm step, RAMS/safe-working
  and a UK GDPR consent step), with a progress indicator, required-item
  enforcement and localStorage progress recovery.
- **Stage 6 — Submission &amp; confirmation** ✅ server-side re-validated
  check-in recorded as COMPLIANT (timestamped, Europe/London), a clear
  "you're compliant and checked in" confirmation showing site, name, company,
  `DD/MM/YYYY HH:mm` and a check-in reference, plus a check-out affordance that
  updates the record. Idempotent (no duplicate open check-ins).
- **Stage 7 — Admin Microsoft SSO &amp; dashboard shell** ✅ Azure AD sign-in via
  MSAL (authorization-code flow with CSRF state), the Azure object id mapped to
  an `Admin` on first login, a secure signed admin session cookie, a guarded
  `/admin` route group (everything redirects to sign-in without a session), and
  the dashboard shell (header, nav, signed-in admin, sign-out, empty-state
  landing). A development sign-in stands in when `AZURE_AD_*` isn't configured
  (never in production).
- **Stage 8 — Admin job site management (CRUD)** ✅ create / edit / archive /
  restore sites with UK postcode validation &amp; normalisation, job reference,
  emergency info and induction content; a searchable admin list with status
  badges and on-site counts. New sites are seeded with a default UK induction
  checklist and appear immediately in the worker site-selection list.
- **Stage 9 — Compliance checklist &amp; induction builder** ✅ a per-site builder
  to add / edit / reorder / delete items (acknowledgement, yes-no, PPE-confirm)
  and mark them required, with a "Load UK template" starting point. Edits drive
  the worker induction immediately and are **versioned** — once a version has
  check-ins, saving publishes a new version so historic submissions keep their
  original content.
- **Stage 10 — Live "On Site Now" view** ✅ workers currently checked in (not yet
  checked out) grouped by active site with name, company, check-in time and
  compliance status, per-site compliance summaries, and auto-refresh (with a
  manual refresh + pause). Check-ins appear and check-outs disappear live.
- **Stage 11 — Submissions, search, filter &amp; reporting** ✅ a browsable
  submissions list filterable by site, worker/company and UK check-in date range
  (BST/GMT-correct), a detail view resolving every answer against the exact
  checklist version completed, and CSV export of the filtered set (British
  English headers, `DD/MM/YYYY HH:mm`, Excel-friendly BOM).
- **Stage 12 — UK localisation &amp; compliance hardening** ✅ a source sweep
  confirming British spelling and centralised UK date/time/phone/postcode
  handling, a full **UK GDPR privacy notice** (`/privacy`, linked from the footer
  and consent step), and a **right-to-erasure** data-deletion path (admins erase
  a worker's personal data; identifiers are anonymised, the anonymised
  compliance record is kept). See [LOCALISATION.md](./LOCALISATION.md).
- **Stage 13 — Mobile-first polish &amp; Azure deployment readiness** ✅
  accessibility pass (skip-to-content links, labelled `main` landmarks, focus
  rings, reduced-motion, `lang="en-GB"`), a web app manifest (add-to-home-screen),
  a `/api/health` liveness probe, Azure-ready scripts (`start:azure`,
  `postinstall` Prisma generate, `engines`, `.nvmrc`), and a full
  [DEPLOYMENT.md](./DEPLOYMENT.md) (App Service + PostgreSQL + ACS + Entra ID +
  Key Vault, with env mapping and a post-deploy checklist).

**All 13 stages complete.** The worker journey (OTP → identity → site →
induction → compliant check-in → check-out) and the admin platform (SSO,
site/checklist management, live on-site view, reporting/CSV) are built,
verified and documented for Azure deployment.

> **Local database:** development uses a userland PostgreSQL 16 managed by
> [`scripts/local-db.sh`](./scripts/local-db.sh) (`init` / `start` / `stop` /
> `psql`). Run it, then `npm run db:migrate` and `npm run db:seed`. Production
> targets Azure Database for PostgreSQL Flexible Server.
