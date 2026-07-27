import { InductionUnavailablePolicy } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { PlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import {
  KNOWLEDGE_CHECK_DEFAULTS,
  QUESTIONS_PER_ATTEMPT_MIN,
  QUESTIONS_PER_ATTEMPT_MAX,
  isUnavailablePolicy,
  type InductionUnavailablePolicyValue,
} from '@/services/knowledgeChecks/knowledgeCheckConstants';

/**
 * Per-site knowledge-check configuration (SC-005), with the approved "global
 * default + per-site override" model. A SiteInductionConfig row holds only the
 * overrides a manager has set; getEffectiveConfig overlays them on the global
 * defaults so a site with no row behaves predictably.
 *
 * Writes require the `sites` "edit" permission (site managers included) and the
 * site to be in the viewer's scope — enforced here as defence in depth.
 */

export interface EffectiveKnowledgeCheckConfig {
  enabled: boolean;
  questionsPerAttempt: number;
  requireManagerApproval: boolean;
  unavailablePolicy: InductionUnavailablePolicyValue;
}

/** The effective config for a site (defaults overlaid with any stored overrides). */
export async function getEffectiveConfig(
  siteId: string,
): Promise<EffectiveKnowledgeCheckConfig> {
  const row = await prisma.siteInductionConfig.findUnique({
    where: { jobSiteId: siteId },
  });
  return {
    enabled: row?.knowledgeCheckEnabled ?? KNOWLEDGE_CHECK_DEFAULTS.enabled,
    questionsPerAttempt:
      row?.questionsPerAttempt ?? KNOWLEDGE_CHECK_DEFAULTS.questionsPerAttempt,
    requireManagerApproval:
      row?.requireManagerApproval ??
      KNOWLEDGE_CHECK_DEFAULTS.requireManagerApproval,
    unavailablePolicy:
      (row?.unavailablePolicy as InductionUnavailablePolicyValue | undefined) ??
      KNOWLEDGE_CHECK_DEFAULTS.unavailablePolicy,
  };
}

/** The raw stored overrides for the config UI (nulls = "inherit default"). */
export interface StoredKnowledgeCheckConfig {
  knowledgeCheckEnabled: boolean | null;
  questionsPerAttempt: number | null;
  requireManagerApproval: boolean;
  unavailablePolicy: InductionUnavailablePolicyValue | null;
}

export async function getStoredConfigForViewer(
  viewer: PlatformViewer,
  siteId: string,
): Promise<StoredKnowledgeCheckConfig | null> {
  if (!viewer.siteIds.includes(siteId)) return null;
  const row = await prisma.siteInductionConfig.findUnique({
    where: { jobSiteId: siteId },
  });
  return {
    knowledgeCheckEnabled: row?.knowledgeCheckEnabled ?? null,
    questionsPerAttempt: row?.questionsPerAttempt ?? null,
    requireManagerApproval: row?.requireManagerApproval ?? false,
    unavailablePolicy:
      (row?.unavailablePolicy as InductionUnavailablePolicyValue | null) ??
      null,
  };
}

export interface KnowledgeCheckConfigInput {
  knowledgeCheckEnabled?: boolean | null;
  questionsPerAttempt?: number | null;
  requireManagerApproval?: boolean;
  unavailablePolicy?: string | null;
}

export type ConfigResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'invalid' };

/**
 * Upsert a site's knowledge-check config. Only the `sites` edit permission and
 * site-scope are required (site managers manage their own sites). Values are
 * clamped/validated; `null` clears an override back to the global default.
 */
export async function saveConfig(
  viewer: PlatformViewer,
  siteId: string,
  input: KnowledgeCheckConfigInput,
): Promise<ConfigResult> {
  if (!permits(viewer.role, 'sites', 'edit')) {
    return { ok: false, reason: 'forbidden' };
  }
  if (!viewer.siteIds.includes(siteId))
    return { ok: false, reason: 'not_found' };

  const site = await prisma.jobSite.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) return { ok: false, reason: 'not_found' };

  let qpa: number | null | undefined = input.questionsPerAttempt;
  if (qpa !== undefined && qpa !== null) {
    if (!Number.isInteger(qpa)) return { ok: false, reason: 'invalid' };
    qpa = Math.min(
      Math.max(qpa, QUESTIONS_PER_ATTEMPT_MIN),
      QUESTIONS_PER_ATTEMPT_MAX,
    );
  }

  let policy: InductionUnavailablePolicy | null | undefined;
  if (input.unavailablePolicy === null) policy = null;
  else if (typeof input.unavailablePolicy === 'string') {
    if (!isUnavailablePolicy(input.unavailablePolicy))
      return { ok: false, reason: 'invalid' };
    policy = input.unavailablePolicy as InductionUnavailablePolicy;
  }

  const data = {
    knowledgeCheckEnabled: input.knowledgeCheckEnabled ?? null,
    questionsPerAttempt: qpa ?? null,
    requireManagerApproval: input.requireManagerApproval ?? false,
    unavailablePolicy: policy ?? null,
    updatedByUserId: viewer.id,
    updatedByName: viewer.name,
  };

  await prisma.siteInductionConfig.upsert({
    where: { jobSiteId: siteId },
    create: { jobSiteId: siteId, ...data },
    update: data,
  });
  return { ok: true };
}
