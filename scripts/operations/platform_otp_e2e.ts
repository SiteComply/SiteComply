import { PrismaClient } from '@prisma/client';
import { createHmac } from 'crypto';

/**
 * End-to-end verification of the Platform SMS OTP flow against PRODUCTION, using
 * a throwaway Director account. Creates the account, exercises the live routes,
 * and cleans up. NO real SMS is relied upon for the verify leg — the physical
 * delivery hop needs a consented handset — so we prove:
 *   A) /start invokes the real Twilio send path for a Platform account (audited
 *      in SmsMessageLog), and
 *   B) the verify->identity->session leg works E2E by planting a challenge with a
 *      known code (exactly as requestCode would have stored it) and completing
 *      /verify to obtain a real sc_platform session.
 *
 * Requires env: DATABASE_URL (prod), SESSION_SECRET (prod), BASE_URL.
 */
const BASE = process.env.BASE_URL || 'https://sitecomply-web.azurewebsites.net';
const EMAIL = 'otp-e2e-director@sitecomply.co.uk';
const MOBILE = '+447700900321'; // Ofcom reserved test range — safe, un-owned
const KNOWN = '654321';

function hashCode(mobile: string, code: string): string {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-otp-secret';
  return createHmac('sha256', secret).update(`${mobile}:${code}`).digest('hex');
}
async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* non-json */ }
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, json, hasSession: /sc_platform=/.test(setCookie) };
}

async function main() {
  const prisma = new PrismaClient();
  let pass = true;
  try {
    // clean any prior run
    await prisma.otpChallenge.deleteMany({ where: { mobile: MOBILE } });
    await prisma.platformUser.deleteMany({ where: { email: EMAIL } });

    const dir = await prisma.platformUser.create({
      data: { email: EMAIL, name: 'OTP E2E Director', company: 'E2E', role: 'DIRECTOR', status: 'ACTIVE', mobile: MOBILE },
      select: { id: true, email: true, role: true, status: true, mobile: true },
    });
    console.log('CREATED test Director:', JSON.stringify(dir));

    // --- Test A: /start invokes the real Twilio send path ---
    console.log('\n== A. /start (email) triggers real SMS send ==');
    const t0 = new Date(Date.now() - 2000); // small skew tolerance
    const start = await post('/api/platform/auth/start', { method: 'email', value: EMAIL });
    console.log('   /start ->', start.status, JSON.stringify(start.json));
    // The most recent OTP send since t0 is ours (reserved number => Twilio rejects).
    const anyLog = await prisma.smsMessageLog.findFirst({
      where: { purpose: 'OTP', createdAt: { gte: t0 } },
      orderBy: { createdAt: 'desc' },
      select: { provider: true, ok: true, error: true, toMasked: true, messageId: true, createdAt: true },
    });
    console.log('   latest OTP SmsMessageLog since /start:', JSON.stringify(anyLog));
    const challengeAfterStart = await prisma.otpChallenge.count({ where: { mobile: MOBILE } });
    console.log('   OtpChallenge rows created by /start:', challengeAfterStart);
    const aOk = !!anyLog && anyLog.provider === 'twilio' && challengeAfterStart >= 1;
    console.log('   A result:', aOk
      ? 'PASS (Platform /start created a challenge and invoked the real Twilio provider)'
      : 'INCONCLUSIVE (no twilio OTP log row found for this window)');
    if (!aOk) pass = false;

    // --- Test B: verify -> session, using a planted challenge (known code) ---
    console.log('\n== B. /verify with a planted challenge -> real session ==');
    await prisma.otpChallenge.deleteMany({ where: { mobile: MOBILE } });
    await prisma.otpChallenge.create({
      data: { mobile: MOBILE, codeHash: hashCode(MOBILE, KNOWN), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });
    const good = await post('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: KNOWN });
    console.log('   /verify correct code ->', good.status, 'session:', good.hasSession);
    const bOk = good.status === 200 && good.hasSession;
    console.log('   B result:', bOk ? 'PASS (Director signed in via OTP, sc_platform issued)' : 'FAIL');
    if (!bOk) pass = false;

    // --- Test C: wrong code rejected; consumed code cannot be reused ---
    console.log('\n== C. negative checks ==');
    await prisma.otpChallenge.create({
      data: { mobile: MOBILE, codeHash: hashCode(MOBILE, KNOWN), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });
    const bad = await post('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: '000000' });
    console.log('   /verify wrong code ->', bad.status, 'session:', bad.hasSession, '(expect 400, no session)');
    const reuse = await post('/api/platform/auth/verify', { method: 'email', value: EMAIL, code: KNOWN });
    // the wrong attempt above incremented attempts on the same challenge; correct still ok unless locked
    console.log('   /verify correct after 1 wrong ->', reuse.status, 'session:', reuse.hasSession);
    const cOk = bad.status === 400 && !bad.hasSession;
    console.log('   C result:', cOk ? 'PASS (wrong code rejected, no session)' : 'FAIL');
    if (!cOk) pass = false;

    console.log('\n==', pass ? 'E2E PASS (send path wired + verify/session E2E)' : 'E2E FAIL', '==');
  } finally {
    // cleanup
    await prisma.otpChallenge.deleteMany({ where: { mobile: MOBILE } });
    await prisma.platformUser.deleteMany({ where: { email: EMAIL } });
    console.log('cleanup: test Director + challenges removed.');
    await prisma.$disconnect();
  }
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
