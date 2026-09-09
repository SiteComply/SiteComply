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
 * Issue reports: capture and storage.
 *
 * The row is the record. Delivery (Phase 2) is deliberately NOT called from
 * here — this function's contract is that a report is complete once it is
 * stored, and nothing about mail may make it slower or able to fail. The caller
 * kicks delivery off after a successful create; the hourly sweep is the net.
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
 * `requested` says which EXPERIENCE the report is being filed from, and selects
 * which cookie to read. It does NOT confer identity: the caller must still hold
 * a valid session for that portal or this returns null. Passing a portal you are
 * not signed in to gets you nothing.
 *
 * This parameter exists because resolving by fixed precedence was WRONG. One
 * browser can hold a platform and a worker session at once — a site manager who
 * is also on site — and the old order took the platform one every time. A
 * worker's bug report was then stored as `portal: PLATFORM` under the manager's
 * name, and the two identities shared one rate-limit allowance, so filing from
 * the Worker Portal blocked the next Platform report.
 *
 * `requested` is optional because a browser running an older bundle does not send
 * it. That case is NOT handled by falling straight back to precedence — doing so
 * silently reproduced the exact bug this function exists to fix, for every user
 * who had not hard-reloaded. Instead the page path is used to infer the
 * experience, which older clients do send, and precedence is the last resort.
 */
export async function resolveReporter(
  requested?: IssueReportPortal | null,
  pagePath?: string | null,
): Promise<Reporter | null> {
  const portal = requested ?? portalFromPath(pagePath);

  if (portal) {
    const byPortal =
      portal === IssueReportPortal.PLATFORM
        ? await platformReporter()
        : portal === IssueReportPortal.ADMIN
          ? await adminReporter()
          : await workerReporter();

    // An EXPLICIT portal is authoritative: the client said where it is, so a
    // missing session there is a refusal, not an invitation to guess again.
    if (requested) return byPortal;
    // An INFERRED one is a best guess, so fall through if it finds nothing.
    if (byPortal) return byPortal;
  }

  return (await platformReporter()) ?? (await adminReporter()) ?? (await workerReporter());
}

/**
 * Which experience a page path belongs to. Only ever used to CHOOSE which
 * session cookie to read — like `requested`, it grants nothing on its own.
 */
function portalFromPath(pagePath?: string | null): IssueReportPortal | null {
  if (!pagePath) return null;
  const path = pagePath.split('?')[0]!;
  if (path.startsWith('/worker') || path.startsWith('/check-in')) return IssueReportPortal.WORKER;
  if (path.startsWith('/admin')) return IssueReportPortal.ADMIN;
  if (path.startsWith('/platform')) return IssueReportPortal.PLATFORM;
  return null;
}

/**
 * The rate limit counts on this, so it must identify ONE account. Prefixed by
 * portal so it is self-describing and cannot collide across the three tables —
 * these are ids from different models, and an unprefixed key silently assumes
 * they can never coincide.
 */
function refFor(portal: IssueReportPortal, id: string): string {
  return `${portal.toLowerCase()}:${id}`;
}

async function platformReporter(): Promise<Reporter | null> {
  const platform = getPlatformSession();
  if (!platform) return null;
  const user = await prisma.platformUser.findUnique({
    where: { id: platform.userId },
    select: { id: true, name: true, company: true, role: true, email: true },
  });
  if (!user) return null;
  return {
    portal: IssueReportPortal.PLATFORM,
    ref: refFor(IssueReportPortal.PLATFORM, user.id),
    name: user.name,
    role: String(user.role),
    org: user.company,
    email: user.email,
  };
}

async function adminReporter(): Promise<Reporter | null> {
  const admin = getAdminSession();
  if (!admin) return null;
  return {
    portal: IssueReportPortal.ADMIN,
    ref: refFor(IssueReportPortal.ADMIN, admin.adminId),
    name: admin.name,
    role: admin.role,
    org: null,
    email: admin.email,
  };
}

async function workerReporter(): Promise<Reporter | null> {
  const worker = getWorkerSession();
  if (!worker) return null;
  const w = await prisma.worker.findUnique({
    where: { mobile: worker.mobile },
    select: { id: true, fullName: true, company: true },
  });
  if (!w) return null;
  return {
    portal: IssueReportPortal.WORKER,
    ref: refFor(IssueReportPortal.WORKER, w.id),
    name: w.fullName,
    role: 'Worker',
    org: w.company,
    email: null,
  };
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
  /** `id` is for the caller to hand to delivery. It is never sent to a client. */
  | { ok: true; id: string; reference: string }
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
    select: { id: true, reference: true },
  });

  return { ok: true, id: row.id, reference: row.reference };
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
