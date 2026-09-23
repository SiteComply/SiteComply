/**
 * Worker Dashboard panel catalogue (SC-003) — DATA ONLY.
 *
 * The SC-003 requirement lists the things the dashboard should be "capable of
 * displaying (where applicable)" and asks that the dashboard be "configurable so
 * site managers can control which information is displayed for each site". This
 * module is the single source of truth for that list: the panel keys, their
 * labels, their built-in defaults and which of them a manager may switch off.
 *
 * Kept free of Prisma / server imports (mirrors ./../bulletins/bulletinConstants)
 * so the configuration UI (client) and the dashboard renderer (server) share one
 * definition. The string values match the Prisma `WorkerDashboardPanel` enum
 * members exactly.
 */

export type WorkerDashboardPanelValue =
  | 'SITE_INFORMATION'
  | 'DAILY_BULLETIN'
  | 'ACTIVE_PERMITS'
  | 'RAMS'
  | 'SITE_DOCUMENTS'
  | 'EMERGENCY_INFORMATION'
  | 'FIRST_AIDER'
  | 'FIRE_ASSEMBLY_POINT'
  | 'SITE_CONTACTS'
  | 'OUTSTANDING_ACTIONS'
  | 'CHECK_OUT';

export interface WorkerDashboardPanelMeta {
  value: WorkerDashboardPanelValue;
  /** Title shown on the worker's dashboard card and in the config list. */
  label: string;
  /** One-line explanation for the site manager configuring the dashboard. */
  description: string;
  /** Whether the panel shows for a site that has never been configured. */
  defaultEnabled: boolean;
  /**
   * Locked panels cannot be switched off. Only Check out is locked: hiding it
   * would leave a worker unable to end their attendance record, which breaks the
   * site's fire-register/CDM duty to know who is on site.
   */
  locked?: boolean;
}

/**
 * The Worker Dashboard panels, in the order they appear on the dashboard.
 *
 * Defaults are ON for everything SiteComply can already populate from live site
 * data, so an existing site gets a useful dashboard with no configuration.
 * Active permits defaults OFF — a manager opts each site in.
 */
export const WORKER_DASHBOARD_PANELS: WorkerDashboardPanelMeta[] = [
  {
    value: 'SITE_INFORMATION',
    label: 'Site information',
    description: 'Site name, job reference and address.',
    defaultEnabled: true,
  },
  {
    value: 'DAILY_BULLETIN',
    label: 'Daily Bulletin',
    description: 'Site notices, announcements and safety alerts.',
    defaultEnabled: true,
  },
  {
    value: 'ACTIVE_PERMITS',
    label: 'Active permits',
    description:
      'Let operatives request Permits to Work and track their approval.',
    /*
     * ON BY DEFAULT since 2026-09-23, by the owner's decision. It shipped dark
     * under SC-009 so each site could opt in, and that turned out to be the
     * wrong default in a way nobody could see: a site with permit types
     * configured and the panel never switched on gave operatives no way to
     * request one, and told neither them nor the manager. Permit to work is a
     * core control, not an extra.
     *
     * TURNING IT OFF IS STILL POSSIBLE and still respected: a stored setting
     * always beats this default, so a site that deliberately switched permits
     * off stays off. This only decides what a site that has never been asked
     * does - which is now "show them".
     */
    defaultEnabled: true,
  },
  {
    value: 'RAMS',
    label: 'RAMS',
    description: 'Risk assessments and method statements for the site.',
    defaultEnabled: true,
  },
  {
    value: 'SITE_DOCUMENTS',
    label: 'Site documents',
    description: 'Other site paperwork operatives may need to read.',
    defaultEnabled: true,
  },
  {
    value: 'EMERGENCY_INFORMATION',
    label: 'Emergency information',
    description: 'Nearest A&E and the site emergency number.',
    defaultEnabled: true,
  },
  {
    value: 'FIRST_AIDER',
    label: 'First aider details',
    description: 'Who the site first aider is and where to find them.',
    defaultEnabled: true,
  },
  {
    value: 'FIRE_ASSEMBLY_POINT',
    label: 'Fire assembly point',
    description:
      'Where to muster in an evacuation. Shown within Emergency information.',
    defaultEnabled: true,
  },
  {
    value: 'SITE_CONTACTS',
    label: 'Site contacts',
    description: 'Named people and numbers an operative may need to call.',
    defaultEnabled: true,
  },
  {
    value: 'OUTSTANDING_ACTIONS',
    label: 'Outstanding actions',
    description: 'Count of open corrective actions raised for this site.',
    defaultEnabled: true,
  },
  {
    value: 'CHECK_OUT',
    label: 'Check-out button',
    description:
      'Lets the operative end their attendance record. Always shown — an operative must be able to check out.',
    defaultEnabled: true,
    locked: true,
  },
];

/**
 * Effective on/off state of every panel for one site. Defined here (rather than
 * alongside the Prisma-backed config service) so client components can accept it
 * without pulling a server module into the bundle.
 */
/**
 * The panel values this build knows about.
 *
 * Used to constrain every read of the stored settings tables. A value that was
 * retired in code but whose rows still exist in the database would otherwise be
 * deserialised by Prisma and throw ("Value 'X' not found in enum"), taking down
 * the worker dashboard. Filtering in the QUERY keeps code and database
 * deployable in either order — the application-level `isWorkerDashboardPanel`
 * guards run too late to help, after deserialisation has already failed.
 */
export const WORKER_DASHBOARD_PANEL_VALUES: WorkerDashboardPanelValue[] =
  WORKER_DASHBOARD_PANELS.map((p) => p.value);

export type PanelVisibility = Record<WorkerDashboardPanelValue, boolean>;

const PANEL_META = new Map(WORKER_DASHBOARD_PANELS.map((p) => [p.value, p]));

export function isWorkerDashboardPanel(
  v: string,
): v is WorkerDashboardPanelValue {
  return PANEL_META.has(v as WorkerDashboardPanelValue);
}

/** Metadata for a panel value, or undefined if the value is unknown. */
export function workerDashboardPanelMeta(
  value: string,
): WorkerDashboardPanelMeta | undefined {
  return PANEL_META.get(value as WorkerDashboardPanelValue);
}

/** Human label for a panel value (falls back to the raw value). */
export function workerDashboardPanelLabel(value: string): string {
  return PANEL_META.get(value as WorkerDashboardPanelValue)?.label ?? value;
}

/** Whether a panel may be switched off by a site manager. */
export function isPanelLocked(value: string): boolean {
  return PANEL_META.get(value as WorkerDashboardPanelValue)?.locked === true;
}

/** The visibility map a site gets before anyone configures it. */
export function defaultPanelVisibility(): Record<
  WorkerDashboardPanelValue,
  boolean
> {
  const out = {} as Record<WorkerDashboardPanelValue, boolean>;
  for (const p of WORKER_DASHBOARD_PANELS) out[p.value] = p.defaultEnabled;
  return out;
}
