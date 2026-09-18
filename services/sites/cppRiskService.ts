import { RiskTopic } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  CPP_RISK_TOPICS,
  isRiskTopicKey,
  type RiskTopicAnswer,
} from '@/services/sites/cppRiskTopics';

/**
 * CPP Tier 2 — the significant-risk register.
 *
 * Stores one decision per L153 Appendix 3 topic per site. See cppRiskTopics for
 * why the list is fixed and why nothing is seeded.
 *
 * Follows sitePpeService and siteRulesService: a thin service over the site's
 * own rows, with the pure catalogue kept separate so the editor (a client
 * component) can import labels without dragging Prisma into the browser bundle —
 * the trap that broke the Site Rules build.
 */

export interface RiskTopicRow {
  key: string;
  label: string;
  hint: string | null;
  kind: 'SAFETY' | 'HEALTH';
  commonlyApplicable: boolean;
  answer: RiskTopicAnswer;
  controls: string | null;
}

export interface RiskRegister {
  rows: RiskTopicRow[];
  /** Topics that apply and have controls recorded. */
  controlled: number;
  /** Topics that apply but have NO controls recorded — the actionable gap. */
  applicableWithoutControls: number;
  /** Topics nobody has considered either way. */
  unanswered: number;
}

/**
 * The register for a site, with every topic present whether or not it has a row.
 *
 * A missing row is UNANSWERED, not absent: the catalogue is the spine, and the
 * stored rows are answers against it. That way adding a topic to the guidance
 * makes it appear on every site as an open question rather than silently missing.
 */
export async function getRiskRegister(siteId: string): Promise<RiskRegister> {
  const stored = await prisma.siteRiskTopic.findMany({
    where: { jobSiteId: siteId },
    select: { topic: true, applicable: true, controls: true },
  });
  const byTopic = new Map(stored.map((r) => [String(r.topic), r]));

  const rows: RiskTopicRow[] = CPP_RISK_TOPICS.map((t) => {
    const row = byTopic.get(t.key);
    const answer: RiskTopicAnswer =
      !row || row.applicable === null
        ? 'UNANSWERED'
        : row.applicable
          ? 'APPLIES'
          : 'NOT_APPLICABLE';
    return {
      key: t.key,
      label: t.label,
      hint: t.hint ?? null,
      kind: t.kind,
      commonlyApplicable: t.commonlyApplicable,
      answer,
      // Controls are kept when a topic is switched off, so toggling does not
      // destroy what somebody wrote. They are simply not shown or counted.
      controls: answer === 'APPLIES' ? (row?.controls ?? null) : null,
    };
  });

  return {
    rows,
    controlled: rows.filter(
      (r) => r.answer === 'APPLIES' && (r.controls ?? '').trim() !== '',
    ).length,
    applicableWithoutControls: rows.filter(
      (r) => r.answer === 'APPLIES' && (r.controls ?? '').trim() === '',
    ).length,
    unanswered: rows.filter((r) => r.answer === 'UNANSWERED').length,
  };
}

export type SaveRiskTopicResult =
  | { ok: true }
  | { ok: false; error: string };

const MAX_CONTROLS = 2000;

/**
 * Record one topic's decision.
 *
 * One topic at a time rather than the whole register: twenty-five topics is a
 * long form, a manager works through it over more than one sitting, and a
 * save-everything endpoint would make a half-finished register an all-or-nothing
 * write. Matches how the setup wizard saves a step.
 */
export async function saveRiskTopic(
  viewer: PlatformViewer,
  siteId: string,
  input: { topic: string; applicable: boolean | null; controls: string | null },
): Promise<SaveRiskTopicResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, error: 'You do not have permission to edit this site.' };
  }
  if (!viewer.siteIds.includes(siteId)) {
    return { ok: false, error: 'Site not found.' };
  }
  if (!isRiskTopicKey(input.topic)) {
    return { ok: false, error: 'Unknown risk topic.' };
  }
  const controls = (input.controls ?? '').trim().slice(0, MAX_CONTROLS) || null;

  const data = {
    applicable: input.applicable,
    // Kept even when the topic does not apply — see getRiskRegister.
    controls,
    updatedByUserId: viewer.id,
    updatedByName: viewer.name,
  };
  await prisma.siteRiskTopic.upsert({
    where: {
      jobSiteId_topic: {
        jobSiteId: siteId,
        topic: input.topic as RiskTopic,
      },
    },
    update: data,
    create: { jobSiteId: siteId, topic: input.topic as RiskTopic, ...data },
  });
  return { ok: true };
}
