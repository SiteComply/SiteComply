import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { normaliseUkMobile } from '@/lib/phone';
import { buildSmsProvider, SmsSendError } from '@/services/sms';
import { resolveTestSettings } from '@/services/sms/smsConfigService';
import { getSmsProviderDescriptor } from '@/services/sms/providerCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/sms/test
 * Test connectivity for a provider. Admin-only. Body: { providerId, to, settings? }.
 * The form settings are merged over the saved config (blank secret → saved), so
 * an admin can test before saving. Returns the test OUTCOME (ok true/false) with
 * HTTP 200 when the test ran; 400/401 only for bad requests.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: { providerId?: string; to?: string; settings?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const providerId = (body.providerId ?? '').trim();
  const desc = getSmsProviderDescriptor(providerId);
  if (!desc) {
    return NextResponse.json({ ok: false, error: 'Unknown provider.' }, { status: 400 });
  }
  if (!desc.supportsTest) {
    return NextResponse.json(
      { ok: false, error: `Connectivity testing is not applicable for ${desc.name}.` },
      { status: 400 },
    );
  }

  const mobile = normaliseUkMobile(body.to ?? '');
  if (!mobile.ok || !mobile.e164) {
    return NextResponse.json(
      { ok: false, error: 'Enter a valid UK mobile number to send the test to.' },
      { status: 400 },
    );
  }

  const settings = await resolveTestSettings(providerId, body.settings ?? {});
  const missing = desc.fields
    .filter((f) => f.required && !(settings[f.key] && settings[f.key].trim() !== ''))
    .map((f) => f.label);
  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      error: `Complete the required fields before testing: ${missing.join(', ')}.`,
    });
  }

  try {
    const provider = buildSmsProvider(providerId, settings);
    const result = await provider.send({
      to: mobile.e164,
      message: 'SiteComply SMS connectivity test — your integration is working.',
    });
    return NextResponse.json({
      ok: true,
      message: `Test message accepted by ${desc.name}.`,
      messageId: result.messageId,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error:
        error instanceof SmsSendError
          ? error.message
          : 'The test failed. Check the provider settings and try again.',
    });
  }
}
