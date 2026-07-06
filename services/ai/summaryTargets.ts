import { AiSummaryTarget } from '@prisma/client';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { getReportType } from '@/services/reports/reportRegistry';
import { canRunReport } from '@/services/reports/reportAccess';
import { parseReportFilters } from '@/services/reports/reportFilters';
import { getComplianceSummary } from '@/services/reports/complianceReport';
import { getScorecard } from '@/services/reports/scorecardReport';
import { getOrgOverview } from '@/services/reports/orgOverviewReport';
import { getAuditForViewer, listAudits } from '@/services/audits/auditService';
import { listFindingsForAudit } from '@/services/audits/findingService';
import { listActions, actionCounts } from '@/services/actions/actionService';

/**
 * AI Summary target registry (Phase 1b) — the ONLY data path to the model.
 *
 * Each target reuses the exact same scoped services that render the on-screen
 * report/record, so a summary can never contain data the viewer isn't already
 * authorised to see. `authorize()` reuses existing permission rules
 * (canRunReport / permits); `build()` reads only viewer-scoped data and returns
 * a compact, PII-safe context (aggregates and operational fields — never worker
 * personal data). Site scope always comes from the viewer, never the client.
 *
 * These builders are also the future assistant's tools — same enforcement.
 */

export interface SummaryOpts {
  /** Per-item key (e.g. an audit id). Ignored by register-level targets. */
  targetKey?: string;
  /** Report filters (date range + optional sites); sites are intersected with scope. */
  filters?: { from?: string; to?: string; sites?: string[] };
}

export interface BuiltContext {
  /** Stable grouping key for caching (audit id, or report+filters signature). */
  targetKey: string;
  /** Scope snapshot (site ids the context was built from). */
  siteIds: string[];
  /** Short human scope description for the prompt. */
  scopeLabel: string;
  /** The PII-safe context object sent to the model. */
  context: Record<string, unknown>;
}

export interface SummaryTargetDef {
  type: AiSummaryTarget;
  label: string;
  authorize(viewer: PlatformViewer, opts: SummaryOpts): boolean;
  /** Build the scoped context, or null if out of scope / not found. */
  build(viewer: PlatformViewer, opts: SummaryOpts): Promise<BuiltContext | null>;
}

const roundPct = (n: number, total: number) =>
  total > 0 ? Math.round((n / total) * 100) : 0;

const scopeLabelFor = (viewer: PlatformViewer, siteIds: string[]) =>
  viewer.allSites
    ? `organisation-wide, ${siteIds.length} site${siteIds.length === 1 ? '' : 's'}`
    : `${siteIds.length} assigned site${siteIds.length === 1 ? '' : 's'}`;

// A stable grouping key for report targets from filters + scope.
function reportTargetKey(reportId: string, from: string, to: string, siteIds: string[]) {
  return `${reportId}:${from}:${to}:${[...siteIds].sort().join(',')}`;
}

const COMPLIANCE: SummaryTargetDef = {
  type: 'COMPLIANCE_REPORT',
  label: 'compliance report',
  authorize: (v) => canRunReport(v, getReportType('compliance')!),
  async build(viewer, opts) {
    const filters = parseReportFilters(opts.filters ?? {}, viewer);
    const s = await getComplianceSummary(filters.siteIds, filters.range);
    return {
      targetKey: reportTargetKey('compliance', filters.fromStr, filters.toStr, filters.siteIds),
      siteIds: filters.siteIds,
      scopeLabel: scopeLabelFor(viewer, filters.siteIds),
      context: {
        period: { from: filters.fromStr, to: filters.toStr },
        sitesInScope: filters.siteIds.length,
        totals: {
          checkIns: s.total,
          compliant: s.compliant,
          incomplete: s.incomplete,
          compliantPct: roundPct(s.compliant, s.total),
          ppeConfirmedPct: roundPct(s.ppe, s.total),
          rulesAcknowledgedPct: roundPct(s.rules, s.total),
          safeWorkingPct: roundPct(s.safe, s.total),
          gdprConsentPct: roundPct(s.gdpr, s.total),
        },
        bySite: s.bySite.map((b) => ({
          site: b.name,
          checkIns: b.total,
          compliant: b.compliant,
          compliantPct: b.pct,
        })),
      },
    };
  },
};

const SCORECARD: SummaryTargetDef = {
  type: 'SCORECARD_REPORT',
  label: 'site compliance scorecard',
  authorize: (v) => canRunReport(v, getReportType('scorecard')!),
  async build(viewer, opts) {
    const filters = parseReportFilters(opts.filters ?? {}, viewer);
    const scopeSites = viewer.sites.filter((s) => filters.siteIds.includes(s.id));
    const sc = await getScorecard(scopeSites, filters.range);
    return {
      targetKey: reportTargetKey('scorecard', filters.fromStr, filters.toStr, filters.siteIds),
      siteIds: filters.siteIds,
      scopeLabel: scopeLabelFor(viewer, filters.siteIds),
      context: {
        period: { from: filters.fromStr, to: filters.toStr },
        totals: sc.totals,
        bySite: sc.rows.map((r) => ({
          site: r.siteName,
          checkIns: r.checkIns,
          activeWorkers: r.activeWorkers,
          contractors: r.companies,
          compliancePct: r.compliancePct,
          inductionPct: r.inductionPct,
        })),
      },
    };
  },
};

const ORG_OVERVIEW: SummaryTargetDef = {
  type: 'ORG_OVERVIEW_REPORT',
  label: 'organisation overview report',
  authorize: (v) => canRunReport(v, getReportType('org-overview')!), // directorOnly enforced here
  async build(viewer, opts) {
    const filters = parseReportFilters(opts.filters ?? {}, viewer);
    const scopeSites = viewer.sites.filter((s) => filters.siteIds.includes(s.id));
    const o = await getOrgOverview(scopeSites, filters.range);
    return {
      targetKey: reportTargetKey('org-overview', filters.fromStr, filters.toStr, filters.siteIds),
      siteIds: filters.siteIds,
      scopeLabel: scopeLabelFor(viewer, filters.siteIds),
      context: {
        period: { from: filters.fromStr, to: filters.toStr },
        kpis: {
          totalSites: o.totalSites,
          activeWorkers: o.activeWorkers,
          checkIns: o.checkIns,
          onSiteNow: o.onSiteNow,
          contractors: o.companies,
          compliancePct: o.compliancePct,
          inductionPct: o.inductionPct,
          avgCheckInsPerDay: o.avgPerDay,
        },
        attendanceTrend: o.trend,
        topContractors: o.topCompanies,
        sitePerformance: o.sitePerformance.map((s) => ({
          site: s.siteName,
          checkIns: s.checkIns,
          workers: s.workers,
          onSiteNow: s.onSiteNow,
          compliancePct: s.compliancePct,
        })),
      },
    };
  },
};

const AUDIT: SummaryTargetDef = {
  type: 'AUDIT',
  label: 'audit',
  authorize: (v) => permits(v.role, 'audits', 'view'),
  async build(viewer, opts) {
    if (!opts.targetKey) return null;
    const audit = await getAuditForViewer(viewer, opts.targetKey); // enforces site scope
    if (!audit) return null;
    const findings = await listFindingsForAudit(audit.id);
    const now = new Date();
    const by = (key: 'severity' | 'status') =>
      findings.reduce<Record<string, number>>((acc, f) => {
        acc[f[key]] = (acc[f[key]] ?? 0) + 1;
        return acc;
      }, {});
    const overdue = findings.filter(
      (f) => f.status !== 'CLOSED' && f.dueDate && f.dueDate < now,
    ).length;
    return {
      targetKey: audit.id,
      siteIds: [audit.jobSiteId],
      scopeLabel: `audit at ${audit.jobSite.name}`,
      context: {
        title: audit.title,
        site: audit.jobSite.name,
        status: audit.status,
        overallScore: audit.overallScore,
        signedOff: audit.status === 'SIGNED_OFF',
        findings: {
          total: findings.length,
          bySeverity: by('severity'),
          byStatus: by('status'),
          overdue,
          open: findings
            .filter((f) => f.status !== 'CLOSED')
            .slice(0, 20)
            .map((f) => ({
              title: f.title,
              severity: f.severity,
              status: f.status,
              hasCorrectiveAction: !!f.correctiveAction,
            })),
        },
      },
    };
  },
};

const AUDITS_REGISTER: SummaryTargetDef = {
  type: 'AUDITS_REGISTER',
  label: 'audits register',
  authorize: (v) => permits(v.role, 'audits', 'view'),
  async build(viewer) {
    const audits = await listAudits(viewer, {});
    const byStatus = audits.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});
    const scores = audits
      .map((a) => a.overallScore)
      .filter((s): s is number => typeof s === 'number');
    const avgScore = scores.length
      ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
      : null;
    return {
      targetKey: 'register',
      siteIds: viewer.siteIds,
      scopeLabel: scopeLabelFor(viewer, viewer.siteIds),
      context: {
        sitesInScope: viewer.siteIds.length,
        totalAudits: audits.length,
        byStatus,
        score: {
          scored: scores.length,
          average: avgScore,
          lowest: scores.length ? Math.min(...scores) : null,
          highest: scores.length ? Math.max(...scores) : null,
        },
        recent: audits.slice(0, 15).map((a) => ({
          title: a.title,
          site: a.jobSite.name,
          status: a.status,
          score: a.overallScore,
        })),
      },
    };
  },
};

const ACTIONS_REGISTER: SummaryTargetDef = {
  type: 'ACTIONS_REGISTER',
  label: 'actions register',
  authorize: (v) => permits(v.role, 'actions', 'view'),
  async build(viewer) {
    const now = new Date();
    const [counts, overdue] = await Promise.all([
      actionCounts(viewer, now),
      listActions(viewer, { bucket: 'OVERDUE' }, now),
    ]);
    const byPriority = overdue.reduce<Record<string, number>>((acc, a) => {
      acc[a.priority] = (acc[a.priority] ?? 0) + 1;
      return acc;
    }, {});
    return {
      targetKey: 'register',
      siteIds: viewer.siteIds,
      scopeLabel: scopeLabelFor(viewer, viewer.siteIds),
      context: {
        sitesInScope: viewer.siteIds.length,
        counts,
        overdue: {
          total: overdue.length,
          byPriority,
          items: overdue.slice(0, 20).map((a) => ({
            title: a.title,
            site: a.jobSite.name,
            priority: a.priority,
            status: a.status,
            due: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
          })),
        },
      },
    };
  },
};

export const SUMMARY_TARGETS: Record<AiSummaryTarget, SummaryTargetDef> = {
  COMPLIANCE_REPORT: COMPLIANCE,
  SCORECARD_REPORT: SCORECARD,
  ORG_OVERVIEW_REPORT: ORG_OVERVIEW,
  AUDIT,
  AUDITS_REGISTER,
  ACTIONS_REGISTER,
};
