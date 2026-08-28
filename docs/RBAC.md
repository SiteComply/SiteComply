# SiteComply Platform RBAC — Design (v1, approved)

> **Status: approved design, not yet enforced.** This document is the source of
> truth for how Platform Login users' access _will_ work. The concrete data
> structure lives in
> [`services/platformUsers/platformPermissions.ts`](../services/platformUsers/platformPermissions.ts).
> No permission enforcement, menu hiding, role restriction, login restriction or
> site filtering is implemented yet — those are later stages.

## 1. How the existing structure maps to access control

RBAC reuses the fields already on the `PlatformUser` model — nothing new is
required to describe access:

| Field | Role in RBAC |
| --- | --- |
| `role` (8 roles) | **What** a user can do — the permission set (matrix below). |
| `status` (Pending / Active / Disabled) | **Whether** a user can do anything — the on/off gate. |
| `assignedSites` (m2m → JobSite) | **Where** a user can do it — row-level data scope. |
| `company` | Informational for v1 only — **not** a security boundary. |

Three gates combine on every future request: **status** (must be `ACTIVE`) →
**role** (capability) → **scope** (assigned sites). SiteComply **Admins**
(Microsoft SSO) are a separate, higher tier that manages Platform Users; no
platform role can manage platform users.

## 2. Verbs & modules

- **Verbs:** **V**iew · **C**reate · **E**dit · e**X**port.
- **Modules:** `dashboard`, `sites`, `checkins`, `documents`, `audits`,
  `reports`, `actions`, `platformUsers`.

## 3. Access boundary (Assigned Sites)

- **Director → all sites (organisation-wide).** Never limited by Assigned Sites.
- **All other roles → Assigned Sites only.** Every read/write is filtered to the
  user's assigned sites; records on non-assigned sites are invisible (not merely
  hidden). A scoped user with no assigned sites sees empty states.
- Assigned Sites is the **only** boundary for v1 — no company-level or
  multi-tenant separation.

## 4. Export policy (single rule)

**Export** = downloading datasets/files (check-in records, reports, audits,
registers). Granted only to **Director, Project Manager, Site Manager, Auditor,
H&S Consultant, Principal Contractor**. **Client and Engineer cannot export**
anything — they view on screen only. This keeps worker-level / personal data out
of the two roles that must not hold it (UK GDPR).

## 5. Permissions matrix

Scope: Director = All sites; all others = Assigned Sites only.

| Module | Director | Project Mgr | Site Mgr | Client | Auditor | Engineer | H&S Consultant | Principal Contractor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Dashboard** | V | V | V | V | V | V | V | V |
| **Sites** | V C E X | V C E X | V E | V | V | V | V E | V C E X |
| **Check-ins** | V X¹ | V X¹ | V X¹ | V | V X | V | V X | V X¹ |
| **Documents** | V C E X | V C E X | V C E X | V | V X | V C E | V C E X | V C E X |
| **Audits** | V C E X³ | V C E X | V C E X³ | V | V C E X² | V | V C E X² | V C E X² |
| **Reports** | V C E X | V C E X | V X | V | V C X | V | V C X | V C X |
| **Actions** | V C E X | V C E X | V C E | V | V C | V C E | V C E | V C E X |
| **Platform Users** | — | — | — | — | — | — | — | — |

**Notes**

1. **Check-ins are immutable.** The only mutation is a **check-out override**
   (force check-out): Director, Site Manager, Project Manager, Principal
   Contractor. No role edits the content of a check-in record.

   *Director added 28 August 2026.* Previously excluded on separation-of-duties
   grounds. That reasoning is retained for **audit sign-off**, where it stops the
   executive layer approving its own audit — but it does not hold here. A
   check-out override approves nothing; it corrects an attendance record that a
   worker failed to close. Directors already hold site closure and organisation
   -wide authority, and closure is **hard-blocked** while anyone is still checked
   in, so excluding them created a role that can be stopped from completing a
   project by a stale record it has no way to clear. Because separation of duties
   no longer constrains this capability, the audit trail is the control: every
   override records the actor, a mandatory reason and a permanent manual flag,
   shown wherever the check-out appears.
2. **Audit sign-off / approval** (a capability beyond Edit): Auditor, H&S
   Consultant, Principal Contractor.
3. **Create/edit without sign-off.** Director and Site Manager may author audits
   but are **not** in `AUDIT_SIGNOFF_ROLES` — the same profile Project Manager
   has always had. Editing an audit never confers approving it.
- **Director & Audits:** Directors **create, edit, view and export** audits
  organisation-wide, and manage the shared template library (§5a). They are
  **excluded from sign-off**: that is where the separation of duties sits, so
  the executive layer cannot approve its own audit. Reopening a signed-off audit
  is likewise a sign-off-only act and stays closed to Directors.
  _(Superseded the original v1 rule, which was Director **V X**, audit
  authoring excluded — changed as an approved follow-up to SC-013.)_
- **Site Manager & Audits:** Site Managers gained **create + edit** in SC-013 so
  audits can be raised on site. Sign-off and delete remain excluded.
- **Platform Users** is empty for every platform role — managed exclusively by
  SiteComply **Admins**.
- **Client & Engineer** carry no export (X) in any row, by policy.

## 5a. Audit template library (SC-013)

The `AuditTemplate` library is **organisation-level and shared** — not site-scoped
— so a template edit affects every site. Two distinct gates apply:

| Action | Gate | Roles |
| --- | --- | --- |
| Use a template; save an audit as a new template | `audits:create` | Director, Project Mgr, Site Mgr, Auditor, H&S Consultant, Principal Contractor |
| Create a template directly | `audits:create` | as above |
| **Edit / activate / deactivate / delete** a template | `AUDIT_TEMPLATE_MANAGE_ROLES` | **Director, Project Mgr, Auditor, H&S Consultant** |

Curation is deliberately narrower than authoring: any audit-creating role may
contribute a template, but changing or removing a shared one is restricted so a
single site-scoped user cannot break an org-wide format. Director is included
because Director is the **only** `allSites` role — an organisation-wide artefact
needs an organisation-wide curator. Starter (`isSystem`) templates can never be
deleted, only deactivated. Audits **snapshot** template items and
name/version at creation, so template edits never alter historic audits.

## 6. Per-role summary

| Role | Scope | Can do | Cannot do |
| --- | --- | --- | --- |
| **Director** | All sites | Organisation-wide: view/create/edit/export **sites, documents, reports, actions and audits**; **create/edit/deactivate audit templates** and save audits as templates; delete audits; view & export check-ins; check-out override | **Sign off audits** (or reopen a signed-off audit); edit the content of a check-in record; manage platform users |
| **Project Manager** | Assigned | Full site setup, docs, audits, reports, actions; export; check-out override | Manage platform users |
| **Site Manager** | Assigned | Run the site: edit site/induction/emergency, docs, actions; **create + edit audits** and use/save templates; export check-ins/reports; check-out override | Create sites; **sign off or delete audits**; edit/delete shared templates |
| **Client** | Assigned | **View only** — dashboard, check-ins, docs, audits, reports on screen | Create/edit anything; **any export** |
| **Auditor** | Assigned | View; create/edit/**sign-off audits**; export audits/reports/check-ins | Edit sites; create actions beyond audit follow-ups |
| **Engineer** | Assigned | View; author documents; raise/close actions | **Any export**; audits; site config |
| **H&S Consultant** | Assigned | Edit H&S site content; author docs; **audits + sign-off**; H&S reports; export | Create sites; manage users |
| **Principal Contractor** | Assigned | Broad create/edit across sites, docs, audits (sign-off), actions; export; check-out override | Manage platform users |

## 7. User journeys

- **Onboarding (Admin):** Add user → Name / Company / Email / Mobile + **Role** +
  **Assigned Sites** → **Pending** → Admin **Approves** → **Active**. Directors
  are approved like anyone else but resolve to all-sites scope.
- **Login gate:** Platform Login → resolve `PlatformUser` by email/mobile →
  **status** must be `ACTIVE` (`PENDING` → "awaiting approval", `DISABLED` →
  "access revoked") → dashboard rendered from the role's matrix row, scoped to
  Assigned Sites (all sites for Director).
- **Client (read-only):** views their site's dashboard, check-in evidence,
  documents and audit outcomes on screen; no export/download controls; cannot
  create or edit.
- **Engineer:** views assigned-site data, authors a method statement, closes an
  action; no export controls anywhere.
- **Auditor:** creates an audit (assigned sites only), records findings, **signs
  off**, **exports** the report.
- **Director:** org-wide dashboard across all sites; **creates, edits, views and
  exports audits** and curates the shared template library, **but cannot sign
  off** an audit or reopen a signed-off one — that stays with the roles in note
  2; exports a portfolio compliance report; **cannot** open the Platform Users
  screen (Admin-only).
- **Lifecycle:** disabling a leaver refuses access on the next request (status
  checked per request); re-assigning sites updates scope on next load.

## 8. Enforcement model (later stage — NOT built yet)

- Source of truth: the `PLATFORM_PERMISSIONS` constant in
  `services/platformUsers/platformPermissions.ts` — Director is the only role
  with `allSites: true`.
- Guards (future): `requireActivePlatformUser(user)` (status) →
  `can(user, module, verb)` (role) → `scopeToAssignedSites(query, user)` on every
  data read/write.
- Enforced at the **API / service layer** (authoritative); the UI hides controls
  it cannot use (cosmetic only).
- Export endpoints additionally check the export-capable set and never return
  worker-level / personal data to Client or Engineer.

## 9. v1 decisions (locked)

- Director is organisation-wide; not restricted by Assigned Sites.
- Platform User management stays Admin-only; Directors cannot create, approve,
  disable or assign platform users.
- Auditors and H&S Consultants are restricted to their Assigned Sites.
- Clients are read-only; they create no actions, issues or records.
- Assigned Sites is the only access boundary; no company/multi-tenant separation.
- Permissions are role-based only; no per-user overrides.
- Export is limited to Director, Project Manager, Site Manager, Auditor, H&S
  Consultant and Principal Contractor; Clients and Engineers cannot export
  worker-level or personal data.
