# Platform UX Refresh — structural baseline

- Baseline tag: `rev1-complete` (`44841c5`)
- Captured at: commit `ee9cf4e` on branch `feature/ux-refresh`
- Production BUILD_ID at capture: `Oz4SPgNN-L-ZD8yrfQNk7`

Column meanings — **Cards** counts card/panel wrappers on the page itself;
**+Nested** adds those inside the components it imports (the number a user
actually sees). **Prose** counts explanatory paragraphs. **Gates** counts
permission expressions — *this number must never fall without a stated reason*.

| Screen | Lines | Cards | +Nested | Prose | Saves | Gates | a11y | print: |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Dashboard (not a priority) | 391 | 5 | **7** | 4 | 0 | 7 | 0 | 0 |
| Sites register | 197 | 5 | **7** | 3 | 0 | 3 | 6 | 0 |
| Site → Overview | 161 | 3 | **20** | 2 | 0 | 11 | 0 | 0 |
| Site → Worker Experience  ** BIGGEST ISSUE ** | 292 | 8 | **44** | 0 | 0 | 18 | 0 | 0 |
| Site → Compliance | 258 | 4 | **22** | 1 | 0 | 14 | 0 | 0 |
| Site → Workers | 146 | 3 | **38** | 4 | 0 | 7 | 0 | 0 |
| Site → Documents | 72 | 1 | **8** | 0 | 0 | 3 | 0 | 0 |
| Site → Access | 102 | 2 | **19** | 3 | 0 | 5 | 0 | 0 |
| Project Setup wizard | 152 | 0 | **17** | 0 | 0 | 3 | 0 | 0 |
| CPP draft | 245 | 4 | **6** | 12 | 0 | 0 | 1 | 6 |
| Close-Out Packs (list) | 154 | 2 | **30** | 3 | 0 | 5 | 0 | 0 |
| Close-Out Pack (document) | 116 | 1 | **7** | 1 | 0 | 4 | 0 | 2 |
| Compliance Calendar | 183 | 0 | **13** | 0 | 0 | 4 | 0 | 0 |
| Compliance schedules | 149 | 3 | **5** | 7 | 0 | 2 | 2 | 0 |
| Actions register | 345 | 7 | **18** | 6 | 0 | 3 | 0 | 0 |
| Action detail | 300 | 7 | **19** | 4 | 0 | 9 | 0 | 0 |
| New Action  ** BENCHMARK ** | 50 | 1 | **5** | 2 | 0 | 3 | 0 | 0 |
| Audits register | 244 | 7 | **10** | 6 | 0 | 3 | 0 | 0 |
| Audit detail | 342 | 8 | **37** | 5 | 0 | 10 | 0 | 0 |
| Audit Scoring  ** BENCHMARK ** | 88 | 0 | **19** | 0 | 0 | 1 | 0 | 0 |
| Audit templates | 105 | 1 | **3** | 6 | 0 | 6 | 0 | 0 |
| Permits register | 193 | 6 | **9** | 5 | 0 | 2 | 0 | 0 |
| Permit detail | 227 | 5 | **11** | 8 | 0 | 2 | 0 | 0 |
| Documents register | 276 | 7 | **11** | 6 | 0 | 4 | 1 | 0 |
| Check-ins register | 173 | 5 | **7** | 4 | 0 | 3 | 3 | 0 |
| Worker detail | 320 | 6 | **8** | 16 | 0 | 3 | 3 | 0 |
| Notifications | 51 | 1 | **9** | 1 | 0 | 0 | 0 | 0 |
| Reports hub | 88 | 2 | **4** | 2 | 0 | 2 | 0 | 0 |
| Report → Org overview | 202 | 0 | **16** | 5 | 0 | 2 | 0 | 0 |
| Report → Compliance activities | 331 | 5 | **11** | 16 | 0 | 2 | 0 | 0 |
| Report → Scorecard | 176 | 1 | **15** | 8 | 0 | 2 | 0 | 0 |
| Settings hub | 78 | 2 | **4** | 3 | 0 | 4 | 0 | 0 |
| Settings → Config templates | 117 | 0 | **18** | 2 | 0 | 5 | 0 | 0 |
| Settings → Permission templates | 103 | 0 | **17** | 2 | 0 | 5 | 0 | 0 |

**Totals across in-scope screens — cards 112, incl. nested 494, permission gates 157.**

## Permission-gate inventory

Every permission expression on every in-scope screen, verbatim. Phase 8 diffs
this. A gate that vanishes must be explained, not explained away.

### Dashboard (not a priority)
```
13:  assertModuleView,
64:  assertModuleView(viewer, 'dashboard');
71:  const canActions = permits(viewer.role, 'actions', 'view');
72:  const canDocs = permits(viewer.role, 'documents', 'view');
73:  const canAudits = permits(viewer.role, 'audits', 'view');
74:  const canCheckins = permits(viewer.role, 'checkins', 'view');
75:  const canSites = permits(viewer.role, 'sites', 'view');
```
### Sites register
```
16:  assertModuleView,
44:  assertModuleView(viewer, 'sites');
46:  const canExport = permits(viewer.role, 'sites', 'export');
```
### Site → Overview
```
7:  canCloseProject,
8:  canReopenProject,
15:  assertModuleView,
36:  assertModuleView(viewer, 'sites');
42:  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
67:            canClose={canCloseProject(viewer.role)}
68:            canReopen={canReopenProject(viewer.role)}
136:      {site.status !== 'COMPLETED' && canCloseProject(viewer.role) ? (
144:            canReopen={canReopenProject(viewer.role)}
```
### Site → Worker Experience  ** BIGGEST ISSUE **
```
15:  assertModuleView,
19:  canEditSite,
50:  assertModuleView(viewer, 'sites');
52:  const canViewBulletins = permits(viewer.role, 'bulletins', 'view');
53:  const canPublishBulletins = permits(viewer.role, 'bulletins', 'create');
54:  const canManageBulletins = permits(viewer.role, 'bulletins', 'edit');
55:  const canConfigureDashboard = permits(viewer.role, 'sites', 'edit');
56:  const canEdit = canEditSite(viewer.role);
```
### Site → Compliance
```
10:  assertModuleView,
49:  assertModuleView(viewer, 'sites');
51:  const canViewCheckins = permits(viewer.role, 'checkins', 'view');
52:  const canViewAudits = permits(viewer.role, 'audits', 'view');
53:  const canViewActions = permits(viewer.role, 'actions', 'view');
73:  const canEditServices = permits(viewer.role, 'sites', 'edit');
```
### Site → Workers
```
9:  assertModuleView,
30:  assertModuleView(viewer, 'sites');
31:  if (!permits(viewer.role, 'checkins', 'view')) {
```
### Site → Documents
```
12:  assertModuleView,
30:  assertModuleView(viewer, 'sites');
31:  if (!permits(viewer.role, 'documents', 'view')) {
```
### Site → Access
```
8:  assertModuleView,
13:  canManageContractorAccess,
35:  assertModuleView(viewer, 'sites');
36:  if (!canManageContractorAccess(viewer.role)) {
61:          canManage={canManageContractorAccess(viewer.role)}
```
### Project Setup wizard
```
7:  canEditSite,
42:  if (!permits(viewer.role, 'sites', 'edit')) {
146:        canEditProject={canEditSite(viewer.role)}
```
### Close-Out Packs (list)
```
12:  assertModuleView,
15:  canGenerateCloseOutPack,
36:  assertModuleView(viewer, 'sites');
37:  if (!canGenerateCloseOutPack(viewer.role)) {
95:      {viewerCan(viewer, 'documents', 'create', params.id) ? (
```
### Close-Out Pack (document)
```
8:  assertModuleView,
11:  canGenerateCloseOutPack,
40:  assertModuleView(viewer, 'sites');
41:  if (!canGenerateCloseOutPack(viewer.role)) {
```
### Compliance Calendar
```
4:  assertModuleView,
61:  assertModuleView(viewer, 'audits');
97:  const canManage = permits(viewer.role, 'audits', 'create');
```
### Compliance schedules
```
6:  assertModuleView,
33:  assertModuleView(viewer, 'audits');
```
### Actions register
```
8:  assertModuleView,
53:  assertModuleView(viewer, 'actions');
80:  const canCreate = permits(viewer.role, 'actions', 'create');
```
### Action detail
```
8:  assertModuleView,
48:  assertModuleView(viewer, 'actions');
53:  const canEdit = permits(viewer.role, 'actions', 'edit');
75:    action.auditFinding && permits(viewer.role, 'audits', 'view')
```
### New Action  ** BENCHMARK **
```
7:  assertModuleView,
20:  assertModuleView(viewer, 'actions');
21:  if (!permits(viewer.role, 'actions', 'create')) {
```
### Audits register
```
8:  assertModuleView,
40:  assertModuleView(viewer, 'audits');
57:  const canCreate = permits(viewer.role, 'audits', 'create');
```
### Audit detail
```
8:  assertModuleView,
49:  assertModuleView(viewer, 'audits');
54:  const canEdit = permits(viewer.role, 'audits', 'edit');
55:  const canCreate = permits(viewer.role, 'audits', 'create');
58:  const canCreateAction = permits(viewer.role, 'actions', 'create');
```
### Audit Scoring  ** BENCHMARK **
```
30:  if (!permits(viewer.role, 'audits', 'edit')) {
```
### Audit templates
```
6:  assertModuleView,
23:  assertModuleView(viewer, 'audits');
26:  const canCreate = permits(viewer.role, 'audits', 'create');
```
### Permits register
```
7:  assertModuleView,
35:  assertModuleView(viewer, 'permits');
```
### Permit detail
```
7:  assertModuleView,
26:  assertModuleView(viewer, 'permits');
```
### Documents register
```
8:  assertModuleView,
47:  assertModuleView(viewer, 'documents');
67:  const canCreate = permits(viewer.role, 'documents', 'create');
69:  const canDownload = permits(viewer.role, 'documents', 'export');
```
### Check-ins register
```
10:  assertModuleView,
38:  assertModuleView(viewer, 'checkins');
40:  const canExport = permits(viewer.role, 'checkins', 'export');
```
### Worker detail
```
10:  assertModuleView,
31:  assertModuleView(viewer, 'checkins');
36:  const canSeeMobile = permits(viewer.role, 'checkins', 'export');
```
### Reports hub
```
8:  assertModuleView,
23:  assertModuleView(viewer, 'reports');
```
### Report → Org overview
```
16:  assertModuleView,
45:  assertModuleView(viewer, 'reports');
```
### Report → Compliance activities
```
11:  assertModuleView,
58:  assertModuleView(viewer, 'reports');
```
### Report → Scorecard
```
10:  assertModuleView,
39:  assertModuleView(viewer, 'reports');
```
### Settings hub
```
7:  assertModuleView,
29:  assertModuleView(viewer, 'sites');
```
### Settings → Config templates
```
7:  assertModuleView,
46:  assertModuleView(viewer, 'sites');
102:      {permits(viewer.role, 'sites', 'edit') ? (
```
### Settings → Permission templates
```
7:  assertModuleView,
30:  assertModuleView(viewer, 'sites');
```

## Shared layout primitives at baseline

These are what Phases 1 and 2 actually change. Recorded so the "before" is
unambiguous — every in-scope screen inherits its width and panel style here.

```
PlatformShell width cap    : max-w-6xl      <- ~900px of content after the sidebar
PlatformShell sidebar      : md:w-60
  sidebar rendered as card : 0          <- nav competing with content
  NotificationPoller mounts: 2          <- must stay >0 after Phase 1
Section panel style        : rounded-xl border border-line bg-surface p-5 shadow-card
Nav items (flat)           : 11
Nav grouping constructs    : 12          <- 0 = ungrouped, addressed in Phase 1

BENCHMARKS (leave alone — these are the target composition):
  Audit Scoring            : grid gap-4 lg:grid-cols-3
  Close-Out Pack generator : grid gap-4 lg:grid-cols-[1fr_380px]
  New Action form          : max-w-2xl space-y-5
```
