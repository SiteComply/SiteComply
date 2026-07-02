import { SubmissionStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Site Compliance Scorecard data — one row per accessible site summarising
 * attendance, compliance %, induction completion %, active workers and
 * contractor breakdown over the date range. Audit & action metrics are
 * placeholders until those modules exist. Purely aggregate (no worker
 * identities). Callers pass the in-scope sites (id + name) so sites with no
 * check-ins still appear with zeroes.
 */

type Range = { gte?: Date; lt?: Date };

function pct(n: number, d: number): number {
  return d ? Math.round((n / d) * 100) : 0;
}

export interface ScorecardRow {
  siteId: string;
  siteName: string;
  checkIns: number;
  activeWorkers: number;
  companies: number;
  compliancePct: number;
  inductionPct: number;
}

export interface Scorecard {
  totals: {
    sites: number;
    checkIns: number;
    activeWorkers: number;
    compliancePct: number;
    inductionPct: number;
  };
  rows: ScorecardRow[];
}

export async function getScorecard(
  sites: { id: string; name: string }[],
  range: Range,
): Promise<Scorecard> {
  const empty: Scorecard = {
    totals: { sites: 0, checkIns: 0, activeWorkers: 0, compliancePct: 0, inductionPct: 0 },
    rows: [],
  };
  if (!sites.length) return empty;

  const siteIds = sites.map((s) => s.id);
  const subs = await prisma.submission.findMany({
    where: {
      jobSiteId: { in: siteIds },
      ...(range.gte || range.lt ? { checkedInAt: range } : {}),
    },
    select: {
      jobSiteId: true,
      status: true,
      ppeConfirmed: true,
      rulesAcknowledged: true,
      safeWorkingAgreed: true,
      gdprConsent: true,
      workerId: true,
      worker: { select: { company: true } },
    },
  });

  type Acc = {
    name: string;
    checkIns: number;
    workers: Set<string>;
    companies: Set<string>;
    compliant: number;
    inductionComplete: number;
  };
  const perSite = new Map<string, Acc>(
    sites.map((s) => [
      s.id,
      { name: s.name, checkIns: 0, workers: new Set(), companies: new Set(), compliant: 0, inductionComplete: 0 },
    ]),
  );

  const allWorkers = new Set<string>();
  let totalCompliant = 0;
  let totalInduction = 0;
  for (const s of subs) {
    const m = perSite.get(s.jobSiteId);
    if (!m) continue;
    m.checkIns += 1;
    m.workers.add(s.workerId);
    m.companies.add(s.worker.company);
    allWorkers.add(s.workerId);
    if (s.status === SubmissionStatus.COMPLIANT) {
      m.compliant += 1;
      totalCompliant += 1;
    }
    if (s.ppeConfirmed && s.rulesAcknowledged && s.safeWorkingAgreed && s.gdprConsent) {
      m.inductionComplete += 1;
      totalInduction += 1;
    }
  }

  const rows: ScorecardRow[] = sites
    .map((s) => {
      const m = perSite.get(s.id)!;
      return {
        siteId: s.id,
        siteName: m.name,
        checkIns: m.checkIns,
        activeWorkers: m.workers.size,
        companies: m.companies.size,
        compliancePct: pct(m.compliant, m.checkIns),
        inductionPct: pct(m.inductionComplete, m.checkIns),
      };
    })
    .sort((a, b) => a.siteName.localeCompare(b.siteName));

  return {
    totals: {
      sites: sites.length,
      checkIns: subs.length,
      activeWorkers: allWorkers.size,
      compliancePct: pct(totalCompliant, subs.length),
      inductionPct: pct(totalInduction, subs.length),
    },
    rows,
  };
}
