# SiteComply Reports Module — Design (v1, approved)

> **Status: approved design.** Phase 0 (foundations) is being implemented; the
> reports themselves land in later phases. Built on the existing RBAC model
> (`docs/RBAC.md`), the `getPlatformViewer` site-scope layer, and data already
> captured (`Submission`, `Worker`, `JobSite`). No saved/scheduled reports, email
> delivery, custom builder or PDF in v1.

## 1. Principles
- Lives at `/platform/dashboard/reports`, under the same session gate and scope
  layer already in production.
- Every report is bound by **two gates**: the RBAC `reports` permission
  (`permits(role, 'reports', verb)`) and the Assigned-Sites boundary
  (`viewer.siteIds`). Directors (`allSites`) get organisation-wide reporting.
- v1 reports are **on-demand** (View + Export). The RBAC Create/Edit verbs have
  no v1 surface (saved/scheduled reports are deferred).
- **CSV export first**; PDF deferred.

## 2. Report types (v1)

| # | Report | Shows | Source | Personal data |
| --- | --- | --- | --- | --- |
| 1 | **Site Attendance** | Check-in/out log: worker, company, site, in/out, duration, status | `Submission`+`Worker`+`JobSite` | Yes |
| 2 | **Compliance** | Compliant vs incomplete %, PPE/rules/safe-working/GDPR rates | `Submission` flags | Aggregate + drill-down |
| 3 | **On-Site Occupancy** | Live headcount + peak/avg per site over a range | `Submission` (`checkedOutAt` null) | Aggregate |
| 4 | **Workforce & Company** | Attendance by company/subcontractor; unique workers | `Submission`+`Worker.company` | Semi |
| 5 | **CSCS / Competency** | Workers by card type; expired flagged | `Worker` | Yes |
| 6 | **Expiring CSCS Cards** | Cards expiring within **30 / 60 / 90 days** (+ already expired) | `Worker.cscsExpiry` | Yes |
| 7 | **Organisation Overview** *(Director-only)* | Org totals, per-site comparison, org compliance rate, trend | all, org-wide | Aggregate |

## 3. Layout (one template, on-screen + future PDF)
Header (title · scope · period · generated-by) → summary KPI cards → optional
chart → data table (paginated on screen, full in export) → footer (UK-GDPR
note). Reuses existing SiteComply cards/tables/typography and British formatting
(Europe/London, `formatDateTimeUK`).

## 4. Filters
Date range (Today / Last 7 / Last 30 / This month / Custom, Europe/London);
Site(s) — multi-select **constrained to `viewer.siteIds`**; Company; Worker
search; Status; CSCS card type; and the **30/60/90-day** window for Expiring
CSCS. Applied server-side, always intersected with the assigned-sites boundary.

## 5. Exports
- **CSV first** (PDF deferred). Reuses the shipped scoped-CSV route pattern.
- **Gating:** `permits(role, 'reports', 'export')` → Director, Project Manager,
  Site Manager, Auditor, H&S Consultant, Principal Contractor. Client & Engineer
  cannot export.
- **CSCS detail exports are further restricted** to **Director, Project Manager,
  Site Manager and H&S Consultant** (Auditor & Principal Contractor may view but
  not export CSCS detail).
- Exports carry the same filters + scope as the on-screen report (server-authoritative).
- **Every export is audit-logged** (see §9).

## 6. Role-based access

| Role | View | Run standard | Export | CSCS export | Scope |
| --- | --- | --- | --- | --- | --- |
| **Director** | ✅ | ✅ | ✅ | ✅ | **All sites** |
| **Project Manager** | ✅ | ✅ | ✅ | ✅ | Assigned |
| **Site Manager** | ✅ | ✅ | ✅ | ✅ | Assigned |
| **H&S Consultant** | ✅ | ✅ | ✅ | ✅ | Assigned |
| **Auditor** | ✅ | ✅ | ✅ | ❌ (view only) | Assigned |
| **Principal Contractor** | ✅ | ✅ | ✅ | ❌ (view only) | Assigned |
| **Client** | ✅ *(aggregate only)* | ✅ | ❌ | ❌ | Assigned |
| **Engineer** | ✅ | ✅ | ❌ | ❌ | Assigned |

Create/Edit (saved/scheduled) = no v1 surface. **Organisation Overview** is
Director-only.

## 7. Client — aggregate only
Clients see **counts and summaries only** — no worker-level rows, names or other
personal data on any report, including CSCS/Competency (counts by card type,
expiry summaries — never individual workers). Clients cannot export.

## 8. Assigned-Sites filtering & Director org-wide
- Site picker populated from `viewer.sites` only; queries use
  `where jobSiteId IN (selected ∩ viewer.siteIds)` — enforcement survives a
  forged/stale site id. Zero assigned sites → empty state.
- Director (`allSites`) → all sites offered, defaults to the whole portfolio, and
  gets the **Organisation Overview** rollup.

## 9. Audit logging (export accountability)
Every report export writes a `ReportExportLog` row: who (platform user), role,
report type, format, site scope, date range, row count, timestamp. **Viewing the
export audit log is Admin-only** (not exposed to Directors or other platform
users). Supports UK-GDPR accountability for worker-level exports.

## 10. Data-model additions (v1)
- **`ReportExportLog`** — export audit log (Phase 0).
- **`Worker.cscsExpiry` index** — efficient expiry-window queries (Phase 3).
- *No `ReportDefinition`* — saved/scheduled reports are out of v1.

## 11. Deferred (post-v1)
PDF export · saved reports · scheduled reports · email delivery · custom report
builder · Audit & Document reports (need their modules) · charts.

## 12. Phased plan

- **Phase 0 — Foundation:** report registry; permission/scope helpers
  (`canRunReport`, `canExportReport` incl. CSCS override, `isAggregateOnly`,
  `resolveReportScope`); shared CSV util; `ReportExportLog` model + migration +
  `logReportExport`; reports landing page (catalogue filtered by role/scope).
- **Phase 1 — Attendance + Compliance** (CSV, Client aggregate-only, logged).
- **Phase 2 — Occupancy + Workforce/Company.**
- **Phase 3 — CSCS/Competency + Expiring CSCS (30/60/90)**, export restricted to
  Director/PM/SM/H&S; add `cscsExpiry` index.
- **Phase 4 — Director Organisation Overview** (org-wide rollup).
- **Phase 5 — Hardening + Admin-only export-log view + tests.**

## 13. Locked decisions
- Clients: aggregate-only, no worker-level data (incl. CSCS/Competency).
- CSCS detail export: Director, PM, Site Manager, H&S Consultant only.
- Export audit logs: **Admin-only**.
- v1 excludes saved/scheduled reports, email delivery, custom builder; CSV first.
- Added **Expiring CSCS Cards** report with 30/60/90-day filters.
