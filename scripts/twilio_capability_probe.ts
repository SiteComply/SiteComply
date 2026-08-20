import { PrismaClient } from '@prisma/client';
import { createDecipheriv, hkdfSync } from 'crypto';

/**
 * READ-ONLY Twilio capability probe. NO messages are sent.
 * GET endpoints only: Account (type/status), Balance, IncomingPhoneNumbers.
 * Answers: is this a trial or full account, is the sender owned + SMS-capable,
 * and what can be determined about international (AU) reach without sending.
 */
function key(): Buffer {
  const secret = process.env.SESSION_SECRET || 'dev-only-insecure-secretbox-key';
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret),
    Buffer.from('sitecomply-secretbox'), Buffer.from('sms-config'), 32));
}
function decryptSecret(token: string): string {
  const raw = Buffer.from(token.slice(3), 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
const mask = (s: string) => s ? `${s.slice(0,6)}…${s.slice(-4)} (${s.length} chars)` : '(none)';

async function main() {
  const prisma = new PrismaClient();
  const cfg = await prisma.smsConfig.findUnique({ where: { id: 'sms' } });
  await prisma.$disconnect();
  if (!cfg) { console.log('No SmsConfig row.'); process.exit(1); }
  const s = (cfg.settings as any)?.twilio ?? {};
  const sid = String(s.accountSid ?? '');
  const from = String(s.from ?? '');
  const token = s.authToken ? decryptSecret(String(s.authToken)) : '';
  console.log('== stored config ==');
  console.log('   activeProvider :', cfg.activeProvider);
  console.log('   sendingEnabled :', cfg.sendingEnabled);
  console.log('   accountSid     :', mask(sid));
  console.log('   authToken      :', token ? `decrypted ok (${token.length} chars)` : 'MISSING');
  console.log('   from           :', from || '(none)');
  if (!sid || !token) { console.log('missing credentials — cannot probe'); process.exit(1); }

  const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
  const get = async (path: string) => {
    const r = await fetch(`https://api.twilio.com${path}`, { headers: { authorization: auth } });
    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  };

  console.log('\n== 1. Account (type / status) ==');
  const acc = await get(`/2010-04-01/Accounts/${sid}.json`);
  console.log('   HTTP', acc.status);
  if (acc.status === 200) {
    console.log('   friendlyName :', acc.body.friendly_name);
    console.log('   type         :', acc.body.type, acc.body.type === 'Trial'
      ? '  ⚠ TRIAL — can only send to VERIFIED numbers, geo-limited' : '  (full account)');
    console.log('   status       :', acc.body.status);
  } else {
    console.log('   error        :', acc.body?.code, acc.body?.message);
  }

  console.log('\n== 2. Balance ==');
  const bal = await get(`/2010-04-01/Accounts/${sid}/Balance.json`);
  if (bal.status === 200) console.log('   balance:', bal.body.balance, bal.body.currency);
  else console.log('   HTTP', bal.status, bal.body?.message);

  console.log('\n== 3. Sender number ownership + capabilities ==');
  const nums = await get(`/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`);
  if (nums.status === 200) {
    const list = nums.body.incoming_phone_numbers ?? [];
    console.log('   numbers on account:', list.length);
    for (const n of list) {
      const c = n.capabilities ?? {};
      const isSender = from && n.phone_number === from;
      console.log(`   ${n.phone_number}  SMS=${c.sms} MMS=${c.mms} voice=${c.voice}${isSender ? '   <- configured sender' : ''}`);
    }
    if (from && !list.some((n: any) => n.phone_number === from))
      console.log(`   ⚠ configured sender ${from} is NOT owned by this account`);
  } else {
    console.log('   HTTP', nums.status, nums.body?.message);
  }
  console.log('\n== done (no messages sent) ==');
}
main().catch((e) => { console.error(e); process.exit(1); });
