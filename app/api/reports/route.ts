import { NextRequest, NextResponse } from 'next/server';
import { IssueReportType } from '@prisma/client';
import {
  createIssueReport,
  resolveReporter,
  DESCRIPTION_MAX,
} from '@/services/reports/reportService';
import { deliverInBackground } from '@/services/reports/reportDelivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/reports
 * Body: { type, description, contactRequested, pagePath, pageTitle, viewport… }
 *
 * Files a bug report, piece of feedback or suggestion from any of the three
 * experiences.
 *
 * WHO is resolved from the session cookie; WHERE is taken from the body and
 * treated as untrusted support context, never used for authorisation. An
 * unauthenticated caller is refused outright — every experience that can reach
 * this is behind a session already, so there is no anonymous path to leave open.
 */
export async function POST(req: NextRequest) {
  const reporter = await resolveReporter();
  if (!reporter) {
    return NextResponse.json(
      { ok: false, error: 'Please sign in again to send a report.' },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const type = String(body.type ?? '');
  if (!isReportType(type)) {
    return NextResponse.json(
      { ok: false, error: 'Please choose what kind of report this is.' },
      { status: 400 },
    );
  }

  const description = typeof body.description === 'string' ? body.description : '';
  if (description.length > DESCRIPTION_MAX * 2) {
    // Refuse absurd payloads before they reach the database, without pretending
    // the precise limit lives here — the service owns that message.
    return NextResponse.json(
      { ok: false, error: `Please keep the description under ${DESCRIPTION_MAX} characters.` },
      { status: 400 },
    );
  }

  const result = await createIssueReport(
    reporter,
    {
      type,
      description,
      contactRequested: body.contactRequested === true,
      pagePath: typeof body.pagePath === 'string' ? body.pagePath : '/',
      pageTitle: typeof body.pageTitle === 'string' ? body.pageTitle : null,
      viewportWidth: body.viewportWidth as number | null,
      viewportHeight: body.viewportHeight as number | null,
      devicePixelRatio: body.devicePixelRatio as number | null,
      activeSiteId: typeof body.activeSiteId === 'string' ? body.activeSiteId : null,
      activeSiteName: typeof body.activeSiteName === 'string' ? body.activeSiteName : null,
    },
    req.headers.get('user-agent') ?? 'unknown',
  );

  if (!result.ok) {
    // 429 for the rate limits, 400 for everything else, so a client can tell
    // "try later" apart from "fix your input".
    const status = result.retryAfterSeconds ? 429 : 400;
    return NextResponse.json(
      { ok: false, error: result.error, retryAfterSeconds: result.retryAfterSeconds },
      { status },
    );
  }

  // After the row exists, never before, and never awaited: the reporter has
  // filed their report successfully whatever the mailbox does next. Only the
  // reference goes back — the id stays server-side.
  deliverInBackground(result.id);

  return NextResponse.json({ ok: true, reference: result.reference });
}

function isReportType(v: string): v is IssueReportType {
  return (Object.values(IssueReportType) as string[]).includes(v);
}
