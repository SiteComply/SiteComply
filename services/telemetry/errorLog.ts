import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { parseUserAgent } from '@/services/reports/reportService';
import type { ErrorEventKind, ErrorEventPortal } from '@prisma/client';

/**
 * Automatic capture of unexpected application errors (Owner Review Item 11).
 *
 * THE RULE THIS FILE LIVES BY: recording an error must never itself become an
 * error the user sees. Every path here swallows its own failures. A logger that
 * throws inside an error handler turns one broken page into a loop, and the
 * table may not even exist yet — production applies migrations by hand, so the
 * app has to run correctly both before and after that happens.
 */

/** How long a record is kept. Also the window the purge sweeps. */
export const RETENTION_DAYS = 90;

/** Storage caps. A stack is diagnostic; a novel is a denial of service. */
const MAX_MESSAGE = 2_000;
const MAX_STACK = 8_000;
const MAX_FIELD = 500;

/**
 * Occurrences of the same fingerprint inside this window fold into one row.
 * A page that crashes on every render would otherwise insert on every reload.
 */
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Per-process insert ceiling. The dedupe above handles one error repeating;
 * this handles many DIFFERENT errors at once — a bad deploy failing everywhere.
 * Dropping records is the right failure: the first hundred describe the problem.
 */
const MAX_INSERTS_PER_MINUTE = 60;
let windowStartedAt = 0;
let windowCount = 0;

function withinInsertBudget(now: number): boolean {
  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    windowCount = 0;
  }
  windowCount += 1;
  return windowCount <= MAX_INSERTS_PER_MINUTE;
}

/**
 * Strip anything that identifies a person from free text.
 *
 * An error message quite often contains the value that broke — an email, a
 * mobile, a token. IssueReport already drops query strings for the same reason:
 * "query strings on these screens carry worker names and date ranges". The same
 * rule has to hold here, where nobody chose to send us the text.
 */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
    .replace(/\+?\d[\d\s()-]{9,}\d/g, '[phone]')
    .replace(/\b(?:eyJ|sk-|Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/g, '[token]')
    .replace(/(password|secret|token|authorization)["'\s:=]+\S+/gi, '$1=[redacted]');
}

/**
 * Path only — never the query string.
 *
 * Accepts a full URL or a bare path, because a client reports `location.href`
 * and a route reports `nextUrl.pathname`.
 */
export function pathOnly(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const withoutHash = input.split('#')[0] ?? '';
    const path = withoutHash.startsWith('http')
      ? new URL(withoutHash).pathname
      : (withoutHash.split('?')[0] ?? '');
    return path.slice(0, MAX_FIELD) || null;
  } catch {
    return null;
  }
}

function cap(v: string | null | undefined, n: number): string | null {
  if (!v) return null;
  const t = String(v).trim();
  return t ? t.slice(0, n) : null;
}

/**
 * What makes two reports "the same error".
 *
 * Deliberately excludes the user and the timestamp: the question a fingerprint
 * answers is "have we seen this fault before", not "has this person seen it".
 * The first stack frame is included because the same message thrown from two
 * places is two faults.
 */
export function fingerprintOf(input: {
  kind: string;
  name?: string | null;
  message: string;
  stack?: string | null;
  route?: string | null;
  pagePath?: string | null;
}): string {
  const frame =
    (input.stack ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('at ')) ?? '';
  const basis = [
    input.kind,
    input.name ?? '',
    // Ids inside a message make every occurrence unique, which would defeat
    // deduping entirely. Collapse them to a placeholder.
    redact(input.message).replace(/\b[0-9a-f]{8,}\b|\bc[a-z0-9]{20,}\b/gi, '#'),
    input.route ?? input.pagePath ?? '',
    frame.replace(/:\d+:\d+/g, ''),
  ].join('|');
  return createHash('sha256').update(basis).digest('hex').slice(0, 32);
}

export interface ErrorEventInput {
  kind: ErrorEventKind;
  portal: ErrorEventPortal;
  message: string;
  name?: string | null;
  stack?: string | null;
  digest?: string | null;
  userRef?: string | null;
  userName?: string | null;
  userRole?: string | null;
  userOrg?: string | null;
  pagePath?: string | null;
  pageTitle?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  buildId?: string | null;
  userAgent?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}

/**
 * Record one error. Never throws, never rejects, never blocks on the caller.
 *
 * Returns the reference when one was written, so a route can echo it to the
 * caller — that is what turns "it crashed" into a row someone can look up.
 */
export async function recordError(
  input: ErrorEventInput,
): Promise<string | null> {
  try {
    if (!withinInsertBudget(Date.now())) return null;

    const message = cap(redact(input.message), MAX_MESSAGE) ?? 'Unknown error';
    const stack = cap(input.stack ? redact(input.stack) : null, MAX_STACK);
    const pagePath = pathOnly(input.pagePath);
    const route = pathOnly(input.route);
    const ua = cap(input.userAgent, MAX_FIELD);
    const parsed = ua ? parseUserAgent(ua) : { browser: null, os: null, deviceType: null };

    const fingerprint = fingerprintOf({
      kind: input.kind,
      name: input.name,
      message,
      stack,
      route,
      pagePath,
    });

    // Fold a repeat into the existing row rather than inserting again.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const folded = await prisma.errorEvent.updateMany({
      where: { fingerprint, lastSeenAt: { gte: since } },
      data: { occurrences: { increment: 1 }, lastSeenAt: new Date() },
    });
    if (folded.count > 0) {
      const existing = await prisma.errorEvent.findFirst({
        where: { fingerprint, lastSeenAt: { gte: since } },
        orderBy: { lastSeenAt: 'desc' },
        select: { reference: true },
      });
      return existing?.reference ?? null;
    }

    const row = await prisma.errorEvent.create({
      data: {
        kind: input.kind,
        portal: input.portal,
        digest: cap(input.digest, 64),
        name: cap(input.name, 200),
        message,
        stack,
        fingerprint,
        userRef: cap(input.userRef, MAX_FIELD),
        userName: cap(input.userName, MAX_FIELD),
        userRole: cap(input.userRole, 64),
        userOrg: cap(input.userOrg, MAX_FIELD),
        pagePath,
        pageTitle: cap(input.pageTitle, MAX_FIELD),
        route,
        method: cap(input.method, 10),
        statusCode: input.statusCode ?? null,
        buildId: cap(input.buildId, 64),
        userAgent: ua,
        browser: parsed.browser,
        os: parsed.os,
        deviceType: parsed.deviceType,
        viewportWidth: input.viewportWidth ?? null,
        viewportHeight: input.viewportHeight ?? null,
      },
      select: { reference: true },
    });
    return row.reference;
  } catch {
    // Including "the table does not exist yet". The app must work the same
    // before and after the migration is applied.
    return null;
  }
}

/** Fire-and-forget: for paths that must not wait on the database. */
export function recordErrorInBackground(input: ErrorEventInput): void {
  void recordError(input).catch(() => {});
}

/**
 * Delete records past the retention period.
 *
 * Returns the number removed. Safe to call as often as you like — on most runs
 * it deletes nothing.
 */
export async function purgeOldErrors(
  days: number = RETENTION_DAYS,
): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await prisma.errorEvent.deleteMany({
      where: { lastSeenAt: { lt: cutoff } },
    });
    return count;
  } catch {
    return 0;
  }
}
