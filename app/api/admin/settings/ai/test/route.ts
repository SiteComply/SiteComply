import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole, ADMIN_WRITE_ROLES } from '@/lib/adminAuth';
import { buildAiProvider, AiError } from '@/services/ai';
import { resolveTestSettings } from '@/services/ai/aiConfigService';
import { getAiProviderDescriptor } from '@/services/ai/aiProviderCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/settings/ai/test
 * Test connectivity for an AI provider. Admin-only. Body: { providerId, settings? }.
 * The form settings are merged over the saved config (blank secret → saved), so
 * an admin can test before saving. Sends a tiny completion and returns the test
 * OUTCOME (ok true/false) with HTTP 200 when the test ran; 400/401 for bad requests.
 */
export async function POST(req: NextRequest) {
  const auth = requireAdminRole(ADMIN_WRITE_ROLES);
  if (!auth.ok) return auth.response;

  let body: { providerId?: string; settings?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const providerId = (body.providerId ?? '').trim();
  const desc = getAiProviderDescriptor(providerId);
  if (!desc) {
    return NextResponse.json({ ok: false, error: 'Unknown provider.' }, { status: 400 });
  }
  if (!desc.supportsTest) {
    return NextResponse.json(
      { ok: false, error: `Connectivity testing is not applicable for ${desc.name}.` },
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
    const provider = buildAiProvider(providerId, settings);
    const result = await provider.complete({
      system: 'You are a connectivity probe. Reply with a single short word.',
      user: 'Reply with the word: ok',
      maxOutputTokens: 5,
      temperature: 0,
    });
    return NextResponse.json({
      ok: true,
      message: `Connected to ${desc.name} (model ${result.model}).`,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error:
        error instanceof AiError
          ? error.message
          : 'The test failed. Check the provider settings and try again.',
    });
  }
}
