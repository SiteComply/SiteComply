# SiteComply — Azure cost model inputs

Raw information for building a scaling cost model. **This document contains no
prices.** Every figure here is either measured from the live subscription on the
date shown, or read from the application source. Pricing must be supplied
separately — the subscription is currently *Microsoft Azure Sponsorship*, whose
rates do not reflect what a commercial subscription would pay.

**Measured:** 10 September 2026 · **Subscription:** `cb65b4e1-5e64-437f-9fba-bb207ff23539`
· **Resource group:** `rgSiteComply` · **Primary region:** UK South

---

## 1. What SiteComply is, in cost terms

A UK construction health-and-safety compliance SaaS. Three experiences on one
Next.js application:

- **Worker Portal** — phone-first. Workers check in to a site, complete
  inductions and knowledge checks, read bulletins, raise permits.
- **Platform** — the contractor's own staff (Director, Project Manager, Site
  Manager, Principal Contractor) manage sites, audits, actions, documents.
- **Admin Centre** — SiteComply's own operators.

The cost-relevant consequence: **load is driven by workers checking in**, which
is concentrated at the start and end of a working day on each site, not spread
evenly. Every worker check-in costs one SMS, several database writes and a burst
of server-rendered page loads.

---

## 2. Current deployment inventory

| Resource | Type | SKU / tier | Notes |
|---|---|---|---|
| `sitecomply-plan` | App Service Plan (Linux) | **B1 Basic**, 1 instance | Node 22 LTS, Always On enabled |
| `sitecomply-web` | Web App | on `sitecomply-plan` | HTTPS-only, TLS 1.2 min, FTPS-only, HTTP/2 **off** |
| `ASP-rgSiteComply-06f4` | Function App plan | **FC1 Flex Consumption** | pay-per-execution |
| `sitecomply-scheduler` | Function App | on FC1 | 2 timer functions |
| `sitecomply-pg` | PostgreSQL Flexible Server | **Standard_B1ms, Burstable** | v16, 32 GB P4 storage, 120 IOPS, autogrow on |
| `scdocsuk` | Storage (StorageV2) | **Standard_LRS**, Hot | document and photo store |
| `scschedfn` | Storage (StorageV2) | **Standard_LRS**, Hot | Function App backing store |
| `sc-uk-acs` | Communication Services | consumption | SMS OTP, UK data location |
| `SiteComplyOpenAIUK` | Azure OpenAI | S0, UK South | `gpt-5-mini` deployment, **GlobalStandard, 50 capacity units** |
| `SiteComplyOpenAI` | Azure OpenAI | S0, North Europe | **no deployments — appears unused** |
| `sitecomply-logs` | Log Analytics | **PerGB2018**, 30-day retention | no daily cap set |
| `app.sitecomply.co.uk` | App Service Certificate | — | DigiCert, valid to 30 Dec 2026 |

**Not deployed:** Application Insights, Front Door / CDN, WAF, Key Vault,
Redis, Service Bus, private endpoints, staging slots.

### Resilience posture (all currently the cheapest option)

| | Setting |
|---|---|
| Database HA | **Disabled** (no standby) |
| Database geo-redundant backup | **Disabled** |
| Database backup retention | 35 days |
| Storage replication | **LRS** (single datacentre) |
| App Service instances | **1** |
| Zone redundancy | **Off** everywhere |

Any cost model for a customer-facing launch should price the resilient variant
separately — these four settings are where most of the increase will come from.

---

## 3. Measured utilisation (10 September 2026)

### Database
| Metric | Value |
|---|---|
| Storage used | **4.12 GB** of 32 GB (13.2%) |
| CPU | 11.9% |
| Memory | **60.7%** |

### App Service plan — 7-day window
| Metric | Average | Peak |
|---|---|---|
| CPU | **41.1%** | **99.0%** |
| Memory | **77.1%** | 84.0% |

### Traffic — 7-day totals
| Metric | Value |
|---|---|
| Requests | **409** (~58/day) |
| HTTP 5xx | **0** |
| Bytes received | 204.9 MB |
| Bytes sent | 1.3 MB |

### Blob storage
| Metric | Value |
|---|---|
| `scdocsuk` used capacity | **34.81 MB** |

> **Read this carefully before modelling.** The request figure is essentially
> *pre-production* traffic — automated verification runs and a handful of manual
> sessions. There are no real customers. Yet the B1 instance is already at
> **77% memory and touching 99% CPU**. The baseline cost of running Next.js with
> Always On consumes most of a B1 before a single customer arrives. **The B1 is
> not a viable starting point for production**, and the model should not treat
> current utilisation as headroom.

---

## 4. Cost drivers, per unit of business activity

### Per worker, per working day
| Driver | Volume | Consumes |
|---|---|---|
| SMS OTP for sign-in | ~1 (session TTL is **12 hours**, set in the database, not env) | 1 ACS SMS segment (UK) |
| OTP resend | cooldown 30s; challenge TTL 15 min | additional SMS if used |
| Check-in | 1–2 (may check into a second site) | DB writes: `Submission`, plus GPS validation |
| Page loads | ~10–30 across dashboard, inductions, bulletins, RAMS, permits | App Service CPU; all pages are `force-dynamic` server-rendered |
| Induction signature | once per induction validity period | ≤500 KB PNG to blob |

**SMS is the most directly variable cost and scales linearly with active
workers per day.** A 12-hour session means roughly one SMS per worker per shift.

### Per site
| Driver | Consumes |
|---|---|
| Site map upload | ≤20 MB per file, blob storage |
| Documents, RAMS, CPP | blob storage + DB rows |
| Compliance schedule | `ComplianceOccurrence` rows generated hourly by the scheduler |
| Audits with photo evidence | blob storage; annotated photos store **both** original and annotated |

### Per audit / action
Photo evidence dominates. Annotated photos are stored as a pair, so photo
storage is effectively doubled for annotated evidence.

### AI summaries (currently ON in production)
| Setting | Value |
|---|---|
| `AI_SUMMARIES_ENABLED` | `true` |
| `AI_PROVIDER` | `azure-openai` |
| Model | `gpt-5-mini` (2025-08-07), GlobalStandard, 50 capacity units |
| Eligible roles | `DIRECTOR,PROJECT_MANAGER` |
| Per-user daily cap | **20** |
| Global monthly cap | **1000** |
| Minimum interval | 10 seconds |
| Cache TTL | 24 hours |

These caps are the current ceiling on AI spend and are enforced in application
code. **They are pilot values and will need raising as the customer base grows** —
the model should treat the monthly global cap as a policy variable, not a
constant.

### Scheduled jobs (Function App, pay-per-execution)
| Function | Schedule | Runs/month |
|---|---|---|
| `complianceTick` | hourly at :05 | ~730 |
| `reportDelivery` | hourly at :25 | ~730 |

Both are thin HTTP callers — they hold no logic and do no database work
themselves, so their execution cost is negligible. The work they *trigger*
lands on the App Service and database.

### Email
Report and feedback delivery goes out via **Microsoft Graph `sendMail`** from an
M365 mailbox (`tech@sitecomply.co.uk`), not an Azure service. **No Azure cost** —
but it does require an M365 licence for that mailbox.

---

## 5. Data growth surfaces

The schema has **75 models**. The tables that grow with usage rather than with
configuration:

| Table | Grows with |
|---|---|
| `Submission` | every check-in (the largest driver) |
| `OtpChallenge` | every sign-in attempt |
| `CscsVerificationLog` | every card verification |
| `ComplianceOccurrence` | generated hourly per site schedule |
| `NotificationEvent`, `NotificationRead` | per notification per recipient |
| `IssueReport` | user-submitted feedback (rate-limited: 1/min, 10/hr, 30/day per person) |
| Audit findings and evidence | per audit; photos go to blob, metadata to DB |

Current DB size of **4.12 GB** includes seed and test data. There is no
archiving or partitioning, and **worker check-in history is unbounded** by
decision — a growth assumption the model should make explicit.

---

## 6. What breaks first as load increases

Ordered by how soon it bites.

1. **App Service B1 — already the binding constraint.** 77% memory at
   effectively zero traffic. B1 also **cannot autoscale** (Basic tier is manual
   scale only, max 3 instances) and has **no deployment slots**, so there is no
   zero-downtime release path. Moving to Standard (S1) or Premium v3 (P0v3/P1v3)
   buys autoscale, slots and more memory. *This is the first thing to price.*
2. **Database on Burstable B1ms.** Burstable tiers accrue CPU credits and
   throttle when exhausted — acceptable for pre-production, unpredictable under
   sustained load. **120 IOPS** is low for concurrent check-in bursts. General
   Purpose (D2ds_v4 or similar) is the realistic production floor.
3. **Single instance, single zone.** Any restart is downtime; a deploy is
   downtime. Zone-redundant or multi-instance changes both the App Service and
   the database line items.
4. **No caching layer.** Every page is `force-dynamic` server-rendered against
   the database. There is no Redis and no CDN. At scale this puts avoidable read
   load on a small database — introducing Redis or output caching is a cost
   *and* a saving.
5. **Storage is LRS in one region.** Cheapest option; no regional failover.
6. **Log Analytics has no daily cap.** Ingestion is unbounded and billed per GB.
   Once App Insights is added, this becomes a real and variable line item — set
   a cap.

---

## 7. Scaling decision points to price

Each of these is a genuine either/or the model should carry as an option, not a
foregone conclusion.

**App Service**
- B1 → S1 (autoscale, slots) → P0v3/P1v3 (better price/performance, zone
  redundancy available)
- Scale-out rules: instance count vs instance size
- Whether to add a staging slot (doubles nothing on Premium; costs an instance
  on Standard)

**Database**
- Burstable B1ms → General Purpose (2–4 vCore)
- Storage growth beyond 32 GB, and the IOPS tier that comes with it
- HA standby: **roughly doubles the database line**
- Geo-redundant backup
- Read replicas if reporting load grows

**Storage**
- LRS → ZRS or GRS
- Lifecycle management: move old audit photos and documents to Cool/Archive.
  Given photos are stored as annotated *pairs*, this is where the saving is.

**SMS (ACS)**
- Per-message UK pricing × active workers per day × sites
- Sensitive to the session TTL: lengthening it reduces SMS spend directly

**Azure OpenAI**
- Currently GlobalStandard (pay-per-token) at 50 capacity units
- Provisioned Throughput becomes worth modelling only at sustained volume
- The North Europe account has no deployments — **confirm whether it can be
  deleted**

**Observability**
- Application Insights ingestion (not yet deployed — see §8)
- Log Analytics retention beyond 30 days

**Not yet present, will be needed**
- Key Vault (secrets are currently plaintext app settings)
- WAF / Front Door if public exposure demands it
- Private endpoints for the database

---

## 8. Known gaps that will add cost at go-live

These are real, currently-unfunded line items:

- **No monitoring at all.** The `microsoft.insights` resource provider is
  **NotRegistered** on this subscription, so there is no Application Insights
  and no alerting anywhere. Registration is free; ingestion is not.
- **No HA, no geo-redundancy, no zone redundancy** on any component.
- **No CI.** The only pipeline that exists is on an unpushed branch. No hosted
  runner cost is currently incurred.
- **No CDN or WAF.**
- **M365 licence** for the `tech@sitecomply.co.uk` mailbox (outside Azure).
- **CSCS Smart Check partner credentials** — a commercial dependency with CSCS,
  not an Azure cost, but a required go-live line item.

---

## 9. Variables the model needs, which this document cannot supply

The measured figures above describe a system with **no customers**. To build the
model, these have to come from the business:

1. Number of contractor organisations (tenants)
2. Sites per organisation, and concurrent active sites
3. **Workers per site per day** — the primary driver
4. Working days per month
5. Peak concurrency (how compressed the morning check-in window is — this sets
   instance count, not average load)
6. Documents and photos per site per month, and average file size
7. Audits per site per month, and photo evidence per audit
8. Retention policy — how long check-in history, documents and photos are kept
   (currently unbounded)
9. Target availability (this decides HA, zone redundancy and geo-backup, which
   together are the largest optional cost)
10. Growth curve over the modelling period

### Suggested modelling shape

Because the largest costs are step-functions (instance tier, database tier, HA
on/off) rather than smooth curves, model **discrete tiers** rather than a linear
per-user cost:

| Band | Rough shape |
|---|---|
| Pilot | 1–2 organisations, few sites — current architecture, upgraded App Service |
| Small | General Purpose database, S1/P0v3 with autoscale, no HA |
| Growth | HA standby, ZRS storage, Redis, App Insights with a cap |
| Scale | Multi-instance, read replicas, lifecycle-managed storage, possibly PTU for AI |

Fixed monthly cost dominates at the low end; SMS, storage and AI tokens dominate
the variable component as worker numbers rise.

---

## 10. Caveats

- **No prices in this document, by design.** The subscription is a Sponsorship
  account; its rates are not commercial rates.
- Utilisation figures are a single 7-day window with pre-production traffic.
  They establish the **floor**, not a trend.
- Blob capacity (34.81 MB) is seed and test data only.
- The `SiteComplyOpenAI` (North Europe) account has no deployments and may be
  removable — verify before modelling it.
- HTTP/2 is disabled on the web app; enabling it is free and reduces bytes on
  the wire.
- Database `publicNetworkAccess` is **Enabled**; a private endpoint would change
  both the security posture and the networking line item.
