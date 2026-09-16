import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePlatformViewer } from '@/services/platformUsers/platformAccess';
import { permits } from '@/services/platformUsers/platformPermissions';
import { verifyCscsCard } from '@/services/cscs/cscsVerificationService';
import { SmartCheckCscsProvider } from '@/services/cscs/smartCheckProvider';
import { getCscsRuntimeConfig } from '@/services/cscs/cscsConfigService';
import { isCscsExemptMobile } from '@/services/cscs/cscsExemptAccounts';
import { withClosedProjectHandling } from '@/lib/routeErrors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/platform/workers/[id]/cscs-check
 *
 * Run a REAL Smart Check lookup for ONE named operative, whatever provider is
 * currently live.
 *
 * WHY THIS EXISTS. Proving the integration against a real card otherwise means
 * switching the live provider and exposing every operative to it for the
 * duration. That is a poor trade for a single validation: one person's card
 * needs checking, so check one person's card.
 *
 * SCOPE, deliberately narrow:
 *   - one worker, named in the URL, never a batch
 *   - only when that worker has a card number, surname and scheme recorded
 *   - REFUSES for the exempt test account, which exists precisely so its details
 *     are never sent to CSCS
 *   - credentials come from the stored configuration, exactly as the live path
 *     would use them; nothing is accepted from the request
 *
 * NOT A BYPASS. The outcome is logged and recorded against the worker like any
 * other verification, because a real check that produced a real answer IS that
 * worker's competency record. Running it and discarding the result would leave
 * the screen disagreeing with the audit log.
 */
async function POSTHandler(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const viewer = await requirePlatformViewer();
  // Operatives are reached through check-ins, so that is the module that
  // governs them. 'edit' rather than 'view': this writes a competency record.
  if (!permits(viewer.role, 'checkins', 'edit')) {
    return NextResponse.json(
      { ok: false, error: 'You do not have permission to run a card check.' },
      { status: 403 },
    );
  }

  const worker = await prisma.worker.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      mobile: true,
      surname: true,
      cscsCardNumber: true,
      cscsSchemeId: true,
    },
  });
  if (!worker) {
    return NextResponse.json(
      { ok: false, error: 'Operative not found.' },
      { status: 404 },
    );
  }

  // The exempt account is exempt here too. An action that quietly ignored the
  // allow-list would make the exemption a matter of which button you pressed.
  if (isCscsExemptMobile(worker.mobile)) {
    return NextResponse.json({
      ok: false,
      error:
        'This is the designated test account and is exempt from CSCS Smart Check. Its card details are never sent to CSCS.',
    });
  }

  const missing = [
    worker.cscsCardNumber ? null : 'card number',
    worker.surname ? null : 'surname',
    worker.cscsSchemeId ? null : 'card scheme',
  ].filter((m): m is string => m !== null);
  if (missing.length) {
    return NextResponse.json({
      ok: false,
      error: `This operative has no ${missing.join(' and ')} recorded, so a card check cannot run. They are asked for these at their next check-in.`,
    });
  }

  const config = await getCscsRuntimeConfig();
  if (!config.apiUrl || !config.apiKey || !config.username || !config.password) {
    return NextResponse.json({
      ok: false,
      error:
        'Smart Check credentials are not complete. Add them in Admin -> Settings -> Integrations.',
    });
  }

  /*
   * THE LIVE PROVIDER, built explicitly rather than resolved.
   *
   * resolveCscsProvider() returns whatever is configured - the mock, while the
   * cutover is pending - and a "check this card now" button that quietly ran the
   * mock would report a verification that never happened. The whole purpose is
   * to reach CSCS, so it is constructed directly.
   */
  const provider = new SmartCheckCscsProvider({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    username: config.username,
    password: config.password,
  });

  const result = await verifyCscsCard({
    cardNumber: worker.cscsCardNumber as string,
    surname: worker.surname,
    schemeId: worker.cscsSchemeId,
    workerId: worker.id,
    providerOverride: provider,
  });

  return NextResponse.json({ ok: true, result });
}

export const POST = withClosedProjectHandling(POSTHandler);
