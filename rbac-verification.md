# SiteComply — Platform RBAC Production Verification

**Date:** 2026-07-02 · **Environment:** production (`https://app.sitecomply.co.uk`)
**Deployed commit:** `d3f755f` (Reports Phase 1) · **Reference:** `docs/RBAC.md`, `docs/REPORTS.md`

## Method
Temporary production Platform Users were created for the five roles missing from
production (Site Manager, Auditor, Engineer, H&S Consultant, Principal
Contractor), each **ACTIVE** and assigned to **Test Site A only** (so the
non-assigned **Test Site B** could be used to prove assigned-site restrictions).
Combined with the existing `director@ / pm@ / client@ / pending@test.com`, all
eight roles plus a Pending account were exercised against the live platform via
authenticated HTTPS requests. All temporary users were removed afterwards.

Legend: **Y** = present/allowed · **–** = absent/hidden · HTTP codes for exports.

## 1. Reports landing, assigned-site visibility & Client aggregate-only

| Role | Reports visible | Org Overview | Test Site A | Test Site B | Attendance aggregate-only |
|---|---|---|---|---|---|
| Director | 7 | Y | Y | **Y** | – |
| Project Manager | 6 | – | Y | **–** | – |
| Client | 6 | – | Y | **–** | **Y** |
| Site Manager | 6 | – | Y | **–** | – |
| Auditor | 6 | – | Y | **–** | – |
| Engineer | 6 | – | Y | **–** | – |
| H&S Consultant | 6 | – | Y | **–** | – |
| Principal Contractor | 6 | – | Y | **–** | – |

✅ **Organisation Overview** is Director-only (7 reports vs 6). ✅ **Assigned-site
restriction**: only Director sees the non-assigned Test Site B; every scoped role
sees only Test Site A. ✅ **Client aggregate-only**: Client's report pages render
KPIs/summaries with the aggregate notice and **no worker-level rows** (confirmed
for Attendance and Compliance).

## 2. Report export gating — Attendance & Compliance

Expected (reports export permission): allowed for Director, PM, Site Manager,
Auditor, H&S, PC; refused for Client & Engineer.

| Role | Attendance export | Compliance export | Expected |
|---|---|---|---|
| Director | 200 | 200 | ✅ |
| Project Manager | 200 | 200 | ✅ |
| Client | **403** | **403** | ✅ |
| Site Manager | 200 | 200 | ✅ |
| Auditor | 200 | 200 | ✅ |
| Engineer | **403** | **403** | ✅ |
| H&S Consultant | 200 | 200 | ✅ |
| Principal Contractor | 200 | 200 | ✅ |

✅ **Client cannot export worker-level data** (403 on both reports, and no export
control on the page). ✅ Engineer refused (no reports-export permission).

## 3. Module export gating — Sites & Check-ins

Sites export = Director/PM/PC only. Check-ins export = all except Engineer &
Client.

| Role | Sites export | Check-ins export | Expected |
|---|---|---|---|
| Director | 200 | 200 | ✅ |
| Project Manager | 200 | 200 | ✅ |
| Client | 403 | 403 | ✅ |
| Site Manager | **403** | 200 | ✅ |
| Auditor | **403** | 200 | ✅ |
| Engineer | 403 | **403** | ✅ |
| H&S Consultant | **403** | 200 | ✅ |
| Principal Contractor | 200 | 200 | ✅ |

✅ Sites-register export correctly restricted to Director/PM/PC. ✅ Check-ins
export refused for Engineer and Client only.

## 4. Export audit log (`ReportExportLog`)

Read directly from the production database after the report exports above:

- **16 rows** written by successful report exports. By role: **Director 4, PM 4,
  Site Manager 2, Auditor 2, H&S 2, Principal Contractor 2**.
- **Client 0, Engineer 0** — their 403 exports wrote **no** log rows (logging
  happens only on successful export).
- Scope captured per row (Director exports `siteIds` = 2 = all sites; scoped
  roles = 1 = Test Site A), plus report type, role, and row count.
- On removing the 5 temporary users, their log rows **cascade-deleted** (16 → 8;
  the remaining 8 belong to the pre-existing `director@`/`pm@`).

## 5. Login / status gate
- All 8 ACTIVE role accounts signed in and reached their scoped dashboard.
- `pending@test.com` → `403 { reason: pending }` ("awaiting approval"), no
  session, dashboard blocked (unchanged from prior verification).

## 6. Non-regression (existing platform)
- Health 200; worker `/check-in` 200; admin Microsoft SSO redirect intact;
  unauthenticated `/platform/dashboard` → 307 → `/platform`.
- All roles can view every module (nav shows all 7 sections; no page blocked) —
  matches the matrix (every role has `view` on every module).

## Result
**All checks pass — production behaviour matches the approved RBAC matrix
exactly for all 8 roles.** No discrepancies were found across reports, pages,
exports, assigned-site restrictions, export restrictions, or Client
aggregate-only rules.

## Cleanup
- The 5 temporary users (`tmp-sm@ / tmp-aud@ / tmp-eng@ / tmp-hs@ /
  tmp-pc@rbac.test`) were **removed** (verified `not_found`).
- Temporary DB firewall rules removed; Postgres access is Azure-services-only.
- **Still present (not created in this task, left untouched):** the pre-existing
  test users `director@ / pm@ / client@ / pending@test.com`, the sites **Test
  Site A / Test Site B**, and 8 residual `ReportExportLog` rows from those users.
  Recommend removing these before go-live.
