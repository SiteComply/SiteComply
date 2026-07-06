# Design — AI-Powered Report Summaries (Phase 1)

**Status:** Design only — approved for review. **Nothing is built and implementation
has not begun.** This document is the proposal to review before any code is written.
**Author:** Platform engineering
**Scope:** On-demand AI executive summaries — both **per-item** (a report run, a single
audit) and **register-level** (all audits / all actions across the viewer's scope) —
with a foundation that a full *SiteComply AI Assistant* can be built on later.

### Confirmed pilot decisions

These are locked for the initial pilot (see §15 for detail):

1. **Provider: Azure OpenAI Service** (UK South) — for UK data residency and the existing
   Microsoft DPA. The provider abstraction still keeps plain OpenAI / mock swappable.
2. **Roles: Director and Project Manager only.** `AI_SUMMARY_ROLES = [DIRECTOR, PROJECT_MANAGER]`.
3. **Both per-item and register-level summaries** are supported.
4. **AI summaries are NOT included in PDF or CSV exports** in this phase (view-only in the UI).
5. **Conservative pilot usage cap** (per-user daily + global monthly + rate limit + caching) — §11.
6. **All RBAC and site-scoping protections are retained exactly as designed** (§4) — unchanged.

---

## 1. Objective

Let authorised platform users generate a concise, **executive summary** of a
report/record/register they are already allowed to see. Phase 1 targets — a mix of
**per-item** and **register-level** granularity:

| # | Target | Granularity | Source module | Existing access rule to reuse |
|---|--------|-------------|---------------|-------------------------------|
| 1 | **Compliance Report** | per-item (report run + filters) | Reports (`compliance`) | `canRunReport`, `isAggregateOnly` |
| 2 | **Site Compliance Scorecard** | per-item (report run + filters) | Reports (`scorecard`) | `canRunReport` |
| 3 | **Organisation Overview** (Director-only) | per-item (report run) | Reports (`org-overview`) | `canRunReport` (already Director-only) |
| 4 | **Audit** | **per-item** (a single audit) | Audits | `permits(role,'audits','view')` + site scope |
| 5 | **Audits register** | **register-level** (all audits in scope) | Audits | `permits(role,'audits','view')` + site scope |
| 6 | **Actions register** | **register-level** (all actions in scope) | Actions | `permits(role,'actions','view')` + site scope |

*Per-item* summaries describe one record/report run; *register-level* summaries roll up
everything of that type across the sites the viewer can access (Director = all sites,
others = assigned sites). Both use the identical scoped data path (§4).

A summary is a short structured output: **headline, key points, risks/concerns,
recommended focus** — written in British English, executive tone, grounded only in
the data provided.

**Non-goals for Phase 1 (but must not be precluded):** conversational chat, cross-report
Q&A, autonomous actions, scheduled/emailed summaries, worker-facing AI, editing data.

---

## 2. Guiding principles

1. **RBAC & site-scoping are upstream of the model, always.** The AI only ever
   receives data the requesting user is *already authorised to see*, produced by the
   **same scoped services** that render the on-screen report. There is no second data
   path and no way for the model to widen scope.
2. **Data minimisation to a third party.** Send aggregates/metrics, never worker PII.
   Honour the Client *aggregate-only* rule. The model sees the least data that still
   produces a useful summary.
3. **Advisory, never authoritative.** Summaries are clearly labelled AI-generated,
   never used to gate permissions or make decisions, and always shown alongside the
   real report.
4. **Provider-abstracted** (mirrors the existing `SmsProvider` pattern) so
   OpenAI ↔ Azure OpenAI is a config switch, not a rewrite.
5. **Auditable & cost-aware** — every generation is logged (like `ReportExportLog`).
6. **Assistant-ready** — Phase 1 building blocks *are* the assistant's foundation.

---

## 3. Architecture overview

```
[Report / Audit / Actions page]
        │  "Generate executive summary" (button, only if authorised + feature on)
        ▼
POST /api/platform/ai/summary   { targetType, targetKey?, filters }
        │
        ├─ 1. getPlatformViewer()                → 401 if not signed in
        ├─ 2. authorize(viewer, target)          → reuse canRunReport / permits (+ AI gate)
        ├─ 3. buildScopedContext(viewer, target) → SAME scoped services the page uses
        ├─ 4. redaction/minimisation guard       → strip PII, enforce aggregate-only, cap size
        ├─ 5. cache lookup (contextHash)         → return cached summary if unchanged & fresh
        ├─ 6. getAiProvider().complete(prompt)   → OpenAI / Azure OpenAI / mock
        ├─ 7. validate + persist (AiSummary)     → audit + cache + cost
        ▼
   { headline, keyPoints[], risks[], recommendedFocus[], meta }
```

The **only** way data reaches the model is step 3 → 4, which is built from
`getPlatformViewer()` — identical scoping to the rendered report.

---

## 4. RBAC & site-scoping enforcement (the critical part)

This is the part that must be provably correct, verified per role (the same way the
RBAC matrix was verified across all 8 roles).

- **Authentication gate.** `getPlatformViewer()` (existing) resolves the user, their
  `role`, `allSites`, `siteIds`, `sites`. Null → `401`. Re-read from DB per request, so
  a disabled user or changed assignment takes effect immediately (existing behaviour).

- **Per-target authorisation — reuse what already exists:**
  - Reports (Compliance / Scorecard / Org Overview) → `canRunReport(viewer, report)`.
    This already keeps **Org Overview Director-only** and honours per-role report access.
  - Audit → `permits(viewer.role,'audits','view')` **and** the audit's `jobSiteId ∈ viewer.siteIds`
    (i.e. `getAuditForViewer`).
  - Actions → `permits(viewer.role,'actions','view')`; the register is built from
    `viewer.siteIds` only.

- **New capability gate (thin) — pilot allow-list.** A `canUseAiSummaries(viewer, target)`
  helper = *existing view/run permission* **AND** the global feature flag **AND** the
  pilot role allow-list **`AI_SUMMARY_ROLES = [DIRECTOR, PROJECT_MANAGER]`**. So even
  though (e.g.) an Auditor can *view* an audit, they cannot generate an AI summary during
  the pilot. Every other role is refused with `403`. This is deliberately additive and
  restrictive — it can only *narrow* access below the existing view permission, never
  widen it. It can later graduate to a first-class `summarize` verb in the RBAC matrix,
  or the allow-list can be expanded, without touching module permissions.
  - **Org Overview** stays Director-only via `canRunReport` (Project Manager is refused
    there by the existing report rule, not by the allow-list — both apply).

- **Site-scope is server-derived, never client-supplied.** The request may carry report
  *filters* (date range, an optional site), but the server **intersects any requested
  site with `viewer.siteIds`** (exactly as reports do today via `resolveReportScope`). A
  client cannot post extra site ids to widen the summary. Empty scope → an honest
  "no data in scope" summary, never a silent widen.

- **Client aggregate-only.** If `isAggregateOnly(viewer, report)` the context contains
  **only aggregates** — no worker rows — mirroring how the report already renders for
  Clients. Re-enforced in the redaction guard (defence in depth).

- **Never trust the client** for scope, target eligibility, or data — the server rebuilds
  everything from the viewer. The `targetKey` (e.g. an audit id) is always re-checked
  against the viewer's scope before any data is read.

**Test plan:** for each of the 8 roles × 5 targets, assert authorised vs `403`, and that
the built context contains only in-scope sites and no PII (automated, like
`rbac-verification.md`).

---

## 5. Data minimisation & privacy (model provider = subprocessor)

The model provider is a **data subprocessor**, so the design treats what leaves the
platform as carefully as an export.

- **What is sent (operational, non-personal):** counts, percentages, trends, site
  names + job references, audit titles/status/score, finding counts by
  severity/status, action counts by bucket/priority, overdue titles + due dates.
- **What is never sent:** worker names, mobiles, CSCS card numbers, individual
  check-in records, or any personal data. Worker-level data is aggregated before it
  reaches the context builder; the redaction guard rejects any disallowed field.
- **Provider — Azure OpenAI Service (UK South) [DECIDED].** SiteComply is already all-in
  on Azure with **UK data residency** (ACS UK, blob storage `scdocsuk` UK). Azure OpenAI
  gives UK/EU data residency, the existing Microsoft enterprise DPA, **no training on
  customer data**, abuse-monitoring opt-out available on request, and private networking
  within the same tenant. It is provisioned as a resource in `rgSiteComply` (uksouth,
  like the other services), with a **model deployment** (e.g. a small GPT-class model —
  aggregates need no large model) referenced by name. The provider abstraction still
  keeps plain OpenAI (`AI_PROVIDER=openai`) and a **mock** available for parity/dev/CI,
  but **Azure OpenAI is the production provider** for the pilot.
- **Notice & labelling.** A one-time notice that summaries are AI-generated and that
  anonymised report metrics are processed by the configured provider; every summary
  carries an "AI-generated" badge, the model name and a timestamp.
- **Secrets & config** (App Service settings, never in the repo — same pattern as
  `SESSION_SECRET`/ACS/`DOCS_STORAGE_CONNECTION_STRING`):
  - `AI_SUMMARIES_ENABLED` (`true|false` — master switch; ships `false`)
  - `AI_PROVIDER` = `azure-openai` (pilot) — also supports `openai` / `mock`
  - `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` (Azure OpenAI)
  - `AI_SUMMARY_ROLES` = `DIRECTOR,PROJECT_MANAGER` (pilot allow-list)
  - Pilot caps: `AI_SUMMARY_DAILY_PER_USER`, `AI_SUMMARY_MONTHLY_GLOBAL`,
    `AI_SUMMARY_MIN_INTERVAL_SECONDS`, `AI_SUMMARY_CACHE_TTL_HOURS` (§11)

---

## 6. Proposed data model (illustrative — not yet created)

```prisma
enum AiSummaryTarget {
  COMPLIANCE_REPORT   // per-item (report run)
  SCORECARD_REPORT    // per-item (report run)
  ORG_OVERVIEW_REPORT // per-item (report run, Director-only)
  AUDIT               // per-item (single audit; targetKey = audit id)
  AUDITS_REGISTER     // register-level (all audits in scope)
  ACTIONS_REGISTER    // register-level (all actions in scope)
}

model AiSummary {
  id             String          @id @default(cuid())
  targetType     AiSummaryTarget
  targetKey      String          // audit id, or a stable hash of report target+filters
  platformUser   PlatformUser?   @relation(fields: [platformUserId], references: [id])
  platformUserId String?
  role           PlatformRole    // role at generation time
  siteIds        Json            // scope snapshot (accountability)
  contextHash    String          // hash of the scoped input → cache key + change detection
  promptVersion  String
  model          String
  summary        Json            // { headline, keyPoints[], risks[], recommendedFocus[] }
  tokensPrompt   Int?
  tokensOutput   Int?
  status         String          // OK | FAILED
  createdAt      DateTime        @default(now())

  @@index([targetType, targetKey, createdAt])
  @@index([platformUserId, createdAt])
}
```

- **Caching / regeneration:** cache key = `(targetType, targetKey, contextHash, scope)`.
  If the underlying data (`contextHash`) is unchanged and within a TTL, return the cached
  summary; "Regenerate" forces a fresh call. This keeps cost low and results stable.
- **Audit:** every row is also the usage/cost record — one place, GDPR-accountable, like
  `ReportExportLog`.

---

## 7. Provider abstraction (mirrors `services/sms/`)

```ts
export interface AiProvider {
  readonly name: string;                 // 'openai' | 'azure-openai' | 'mock'
  complete(input: {
    system: string;
    user: string;
    schema?: object;                     // JSON schema → structured output
    maxOutputTokens?: number;
  }): Promise<{ text: string; json?: unknown; tokensPrompt?: number; tokensOutput?: number }>;
  // Phase 2 additions on the SAME interface: stream(), tools()/function-calling
}

export function getAiProvider(): AiProvider; // reads AI_PROVIDER, like getSmsProvider()
```

- **Mock provider** returns a deterministic templated summary — lets us build, test and
  run CI without spending tokens (exactly how the SMS mock unblocks the OTP flow).
- **Structured output** via JSON schema / `response_format` so summaries are consistent
  and safe to render.

---

## 8. Context builders — the reusable core (and future assistant *tools*)

A registry, one entry per target:

```ts
interface SummaryTarget {
  key: AiSummaryTarget;
  label: string;
  authorize(viewer: PlatformViewer, targetKey?: string): boolean;         // reuse existing rules
  buildContext(viewer: PlatformViewer, opts): Promise<SummaryContext>;    // scoped + PII-safe
  promptVersion: string;
  buildPrompt(ctx: SummaryContext): { system: string; user: string };
}
```

`SummaryContext` = `{ meta: { period, sitesInScope, role, aggregateOnly }, metrics, highlights }`.

- **Compliance** → totals, compliant %, by-site breakdown, expiring counts, period.
- **Scorecard** → per-site attendance %, compliance %, induction %, active workers, contractor count.
- **Org Overview** → org KPIs, attendance trend, contractor breakdown, per-site performance (aggregates).
- **Audit** (per-item) → title, site, status, score, findings by severity/status, overdue findings, corrective-action counts, sign-off.
- **Audits register** (register-level) → across the viewer's scope: audit counts by status, average/spread of scores, findings totals by severity/status, overdue-finding count, sites with the most open findings.
- **Actions register** (register-level) → counts by bucket (open/in-progress/overdue/completed), by priority, overdue list (title/due/site), oldest overdue, completion trend.

> **Why this matters:** these context builders are the *same primitives* the future
> assistant will expose as **function-calling tools** (e.g. `get_compliance_summary(scope)`).
> Because each builder is viewer-scoped, the assistant can never exceed the user's data
> access — the tools *are* the only data path. Phase 1 therefore builds the durable core,
> not throwaway code.

---

## 9. Prompt design

- **System prompt:** "You are a SiteComply compliance analyst for UK construction H&S.
  Write a concise executive summary using ONLY the metrics provided. Do not invent data.
  If a metric is missing or scope is empty, say so. British English. No personal data.
  No legal/medical advice." Output the fixed structure.
- **Versioned** (`promptVersion` logged with each summary → reproducibility).
- **Guardrails:** grounded-only instruction + structured output + always-show-the-real-report.

---

## 10. UX (Phase 1)

- On each target page: an **"AI executive summary"** panel with a **Generate** button
  (shown only when authorised and the feature is on).
- States: idle → generating (spinner, ~2–6s) → summary (headline, bullet key points,
  risks, recommended focus) with an **AI-generated badge**, model + timestamp,
  **Regenerate** and **Copy**.
- A cached summary appears instantly with "Updated {time}" + Regenerate.
- Failures are **non-blocking** — an inline message; the report itself is unaffected.
- **Exports:** AI summaries are **view-only in the UI and are NOT written to any PDF or
  CSV export** in this phase (a deliberate decision — keeps AI-generated text out of
  formal exported records until quality is proven). Revisit in a later phase.

---

## 11. Cost, performance & the pilot usage cap

Contexts are small aggregates → **sub-cent** per summary, but the pilot ships a
deliberately **conservative, multi-layer cap** so cost and load are bounded and
predictable. All values are env-configurable; the proposed pilot defaults:

| Control | Pilot default | Purpose |
|---|---|---|
| **Caching** (`AI_SUMMARY_CACHE_TTL_HOURS`) | **24 h** | Identical scoped context within the TTL returns the cached summary and **does not count** against any cap or cost |
| **Per-user daily cap** (`AI_SUMMARY_DAILY_PER_USER`) | **20 generations/user/day** | Stops one user exhausting the pilot |
| **Global monthly cap** (`AI_SUMMARY_MONTHLY_GLOBAL`) | **1,000 generations/month** | Hard org ceiling — beyond it the feature returns "AI summaries are paused (monthly pilot limit reached)"; the reports still work |
| **Min interval** (`AI_SUMMARY_MIN_INTERVAL_SECONDS`) | **10 s** between generations per user | Rate-limit / anti-hammer |
| **Timeout + retry** | ~15 s, retry once | Graceful degradation; failures are non-blocking |
| **Token budget** | small model, capped output | Deterministic context truncation if oversized |

Only **live generations** (fresh model calls) count toward the caps — a cache hit or a
`403`/blocked request does not. Every generation is written to the audit log (§6) with
token counts, so real cost can be measured before widening the pilot.

---

## 12. Extensibility → full "SiteComply AI Assistant"

Every Phase 1 choice is a deliberate step toward the assistant:

| Phase 1 building block | Becomes, in the assistant |
|---|---|
| Viewer-scoped **context builders** | **Tools/functions** the assistant calls — RBAC + site-scope enforced automatically |
| **Provider abstraction** | Add `stream()` + tool-calling on the same interface |
| **AiSummary** + audit log | Extend to `AiConversation` / `AiMessage` history |
| **Prompt versioning + structured output** | Consistent, reproducible assistant behaviour |
| **Feature flag + capability gate** | Per-role rollout of the assistant |
| `POST /api/platform/ai/summary` | Sibling `POST /api/platform/ai/chat` (streaming) + `/platform/dashboard/assistant` page |

Because the assistant's only data access is through the same viewer-scoped tools, it
**inherits every RBAC and site-scoping guarantee** with no new bypass surface.

---

## 13. Suggested phased rollout

- **1a — Foundation:** provider abstraction + mock + `AiSummary` model + audit log + feature flag (off). No user-facing change.
- **1b — First target:** Compliance context builder + prompt + `POST /api/platform/ai/summary` + UI, behind the flag for Director/PM only.
- **1c — Remaining targets:** Scorecard, Org Overview, Audit, Actions; caching; UX polish.
- **1d — Enable in prod** for chosen roles; monitor cost + quality; per-role verification (all 8 roles).
- **Phase 2 (later):** the assistant (chat, streaming, tools) on the same foundation.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hallucination / wrong numbers | Structured output, "use only provided data", always show the real report, AI label |
| Data leakage to a third party | Data minimisation, Azure OpenAI (UK, no training), DPA, redaction guard + tests |
| **Scope bypass** | Single viewer-scoped data path; server intersects site ids with `viewer.siteIds`; per-role tests |
| Cost runaway | Caching, rate limit, budget guard, usage log |
| Provider lock-in | Provider abstraction (OpenAI ↔ Azure OpenAI ↔ mock) |
| Availability | Non-blocking failures; report works without AI |

---

## 15. Confirmed decisions (pilot) & remaining items

**Confirmed for the pilot:**

1. **Provider — Azure OpenAI Service (UK South).** UK data residency + existing Microsoft
   DPA; provider abstraction retained so OpenAI/mock stay swappable.
2. **Roles — Director and Project Manager only** (`AI_SUMMARY_ROLES = [DIRECTOR, PROJECT_MANAGER]`),
   layered on top of the existing view/run permission (which still keeps Org Overview
   Director-only). All other roles → `403`.
3. **Granularity — both per-item and register-level.** Targets: Compliance / Scorecard /
   Org-Overview report runs, a single Audit (per-item), the Audits register and the
   Actions register (register-level).
4. **Exports — excluded.** AI summaries are view-only; not written to PDF/CSV in this phase.
5. **Usage cap — conservative pilot cap** (§11): 20/user/day, 1,000/month global, 10 s
   min interval, 24 h cache; only live generations count.
6. **RBAC & site-scoping — unchanged.** Retained exactly as designed in §4; the AI gate
   can only narrow access, never widen it.

**Still to confirm before build (do not block the design review):**

- Azure OpenAI **model deployment** to use (a small/cheap model is sufficient) and the
  monthly **spend ceiling** to pair with the 1,000/month cap.
- Ownership/sign-off of the **AI-generated notice & consent** wording (compliance/legal).
- Whether Project Manager should also get a (future) **"all audits" register summary** for
  only their assigned sites (already covered by site-scoping — noting for clarity).

---

*End of design. Implementation has **not** begun and will not start until this document
is reviewed and approved.*
```
