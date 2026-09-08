import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IssueReportPortal, IssueReportType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getAdminSession,
  getPlatformSession,
  getWorkerSession,
} from '@/lib/session';

/**
 * Issue reports (Phase 1): capture and storage.
 *
 * The row is the record. Delivery to the tech mailbox is Phase 2 and is
 * deliberately not referenced here — a report is complete once it is stored,
 * which is what lets the capture path ship before any mail transport exists.
 */

/**
 * Which deploy a report is against — the first thing worth knowing when one
 * arrives. Read off disk once, not from an environment variable: Next.js does
 * not publish the build id as one, and the first version of this reached for a
 * `NEXT_BUILD_ID` that does not exist and silently stored null on every report.
 */
let buildIdCache: string | null | undefined;
export function currentBuildId(): string | null {
  if (buildIdCache !== undefined) return buildIdCache;
  try {
    buildIdCache = readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || null;
  } catch {
    // Dev server, or a layout without the file. Not worth failing a report over.
    buildIdCache = null;
  }
  return buildIdCache;
}

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 2000;

/**
 * Rate limits, per reporter. Generous enough that nobody filing real reports
 * will meet them, tight enough that an authenticated account cannot flood the
 * mailbox. Counted against `reporterRef`, so they follow the person rather than
 * the device or the browser session.
 */
const LIMITS = [
  { seconds: 60, max: 1, message: 'Please wait a moment before sending another report.' },
  { seconds: 60 * 60, max: 10, message: 'You have sent several reports in the last hour. Please try again later.' },
  { seconds: 60 * 60 * 24, max: 30, message: 'You have reached the daily limit for reports. Please try again tomorrow.' },
] as const;

export interface Reporter {
  portal: IssueReportPortal;
  ref: string;
  name: string;
  role: string;
  org: string | null;
  /** Null for workers — the Worker model holds a mobile, not an email. */
  email: string | null;
}

/**
 * Who is reporting, from the session cookie ALONE.
 *
 * Never from the request body. A client that could name itself could file a
 * report as somebody else, and the reporter's identity is the main thing that
 * makes a report actionable.
 *
 * Checked in a fixed order so a browser holding two sessions (an administrator
 * who is also a platform user) reports consistently rather than depending on
 * cookie order.
 */
export async function resolveReporter(): Promise<Reporter | null> {
  const platform = getPlatformSession();
  if (platform) {
    const user = await prisma.platformUser.findUnique({
      where: { id: platform.userId },
      select: { id: true, name: true, company: true, role: true, email: true },
    });
    if (!user) return null;
    return {
      portal: IssueReportPortal.PLATFORM,
      ref: user.id,
      name: user.name,
      role: String(user.role),
      org: user.company,
      email: user.email,
    };
  }

  const admin = getAdminSession();
  if (admin) {
    return {
      portal: IssueReportPortal.ADMIN,
      ref: admin.adminId,
      name: admin.name,
      role: admin.role,
      org: null,
      email: admin.email,
    };
  }

  const worker = getWorkerSession();
  if (worker) {
    const w = await prisma.worker.findUnique({
      where: { mobile: worker.mobile },
      select: { id: true, fullName: true, company: true },
    });
    if (!w) return null;
    return {
      portal: IssueReportPortal.WORKER,
      ref: w.id,
      name: w.fullName,
      role: 'Worker',
      org: w.company,
      email: null,
    };
  }

  return null;
}

/** Enough of the User-Agent to reproduce a layout bug. Not a fingerprint. */
export function parseUserAgent(ua: string): {
  browser: string | null;
  os: string | null;
  deviceType: string | null;
} {
  const first = (re: RegExp) => ua.match(re)?.[1] ?? null;

  // Order matters: Edge and Opera both claim to be Chrome, and Chrome claims
  // to be Safari, so the most specific brand has to be tested first.
  const browser =
    (/\bEdg\/(\d+)/.test(ua) && `Edge ${first(/\bEdg\/(\d+)/)}`) ||
    // Before Chrome: "HeadlessChrome/" defeats a \bChrome\/ word boundary, so
    // automated traffic was recording no browser at all.
    (/HeadlessChrome\/(\d+)/.test(ua) &&
      `Chrome ${first(/HeadlessChrome\/(\d+)/)} (headless)`) ||
    (/\bOPR\/(\d+)/.test(ua) && `Opera ${first(/\bOPR\/(\d+)/)}`) ||
    (/\bFirefox\/(\d+)/.test(ua) && `Firefox ${first(/\bFirefox\/(\d+)/)}`) ||
    (/\bChrome\/(\d+)/.test(ua) && `Chrome ${first(/\bChrome\/(\d+)/)}`) ||
    (/\bVersion\/(\d+).*\bSafari\//.test(ua) &&
      `Safari ${first(/\bVersion\/(\d+).*\bSafari\//)}`) ||
    null;

  const os =
    (/\bAndroid (\d+[\d.]*)/.test(ua) && `Android ${first(/\bAndroid (\d+[\d.]*)/)}`) ||
    (/\biPhone OS (\d+[_\d]*)/.test(ua) &&
      `iOS ${first(/\biPhone OS (\d+[_\d]*)/)?.replace(/_/g, '.')}`) ||
    (/\biPad; CPU OS (\d+[_\d]*)/.test(ua) &&
      `iPadOS ${first(/\biPad; CPU OS (\d+[_\d]*)/)?.replace(/_/g, '.')}`) ||
    (/\bMac OS X (\d+[_\d]*)/.test(ua) &&
      `macOS ${first(/\bMac OS X (\d+[_\d]*)/)?.replace(/_/g, '.')}`) ||
    (/\bWindows NT (\d+[\d.]*)/.test(ua) && `Windows NT ${first(/\bWindows NT (\d+[\d.]*)/)}`) ||
    (/\bLinux\b/.test(ua) && 'Linux') ||
    null;

  const deviceType = /\biPad\b/.test(ua)
    ? 'Tablet'
    : /\bMobile\b|\biPhone\b|\bAndroid\b/.test(ua)
      ? 'Phone'
      : 'Desktop';

  return { browser, os, deviceType };
}

/**
 * A page path fit to store.
 *
 * QUERY STRINGS ARE DROPPED. On these screens they carry worker names, company
 * names and date ranges — a filtered Check-ins URL is personal data about people
 * who are not the reporter. The path alone identifies the screen, which is all a
 * support request needs.
 */
export function safePagePath(raw: string): string {
  const path = String(raw || '/').split('?')[0].split('#')[0].trim();
  if (!path.startsWith('/')) return '/';
  return path.slice(0, 300);
}

export interface ReportInput {
  type: IssueReportType;
  description: string;
  contactRequested: boolean;
  pagePath: string;
  pageTitle?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  devicePixelRatio?: number | null;
  activeSiteId?: string | null;
  activeSiteName?: string | null;
}

export type CreateResult =
  | { ok: true; reference: string }
  | { ok: false; error: string; retryAfterSeconds?: number };

/** How many reports this person has filed inside each window. */
async function rateLimited(
  reporterRef: string,
): Promise<{ error: string; retryAfterSeconds: number } | null> {
  const now = Date.now();
  for (const limit of LIMITS) {
    const since = new Date(now - limit.seconds * 1000);
    const count = await prisma.issueReport.count({
      where: { reporterRef, createdAt: { gte: since } },
    });
    if (count >= limit.max) {
      return { error: limit.message, retryAfterSeconds: limit.seconds };
    }
  }
  return null;
}

export async function createIssueReport(
  reporter: Reporter,
  input: ReportInput,
  userAgent: string,
): Promise<CreateResult> {
  const description = input.description.trim();
  if (description.length < DESCRIPTION_MIN) {
    return { ok: false, error: `Please add a little more detail — at least ${DESCRIPTION_MIN} characters.` };
  }
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `Please keep the description under ${DESCRIPTION_MAX} characters.` };
  }

  const limited = await rateLimited(reporter.ref);
  if (limited) {
    return { ok: false, error: limited.error, retryAfterSeconds: limited.retryAfterSeconds };
  }

  const { browser, os, deviceType } = parseUserAgent(userAgent);

  const row = await prisma.issueReport.create({
    data: {
      type: input.type,
      description,
      portal: reporter.portal,
      reporterRef: reporter.ref,
      reporterName: reporter.name,
      reporterRole: reporter.role,
      reporterOrg: reporter.org,
      // Only stored when they asked to be contacted — otherwise there is no
      // reason to keep a second copy of an address we already hold elsewhere.
      reporterEmail: input.contactRequested ? reporter.email : null,
      contactRequested: input.contactRequested && Boolean(reporter.email),
      pagePath: safePagePath(input.pagePath),
      pageTitle: input.pageTitle?.slice(0, 200) ?? null,
      buildId: currentBuildId(),
      activeSiteId: input.activeSiteId ?? null,
      activeSiteName: input.activeSiteName ?? null,
      userAgent: userAgent.slice(0, 500),
      browser,
      os,
      deviceType,
      viewportWidth: intOrNull(input.viewportWidth),
      viewportHeight: intOrNull(input.viewportHeight),
      devicePixelRatio: floatOrNull(input.devicePixelRatio),
    },
    select: { reference: true },
  });

  return { ok: true, reference: row.reference };
}

function intOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 20000 ? Math.round(n) : null;
}

function floatOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 8 ? Math.round(n * 100) / 100 : null;
}

export type { Prisma };
