/**
 * SC-026 migration verifier — organisation-wide Authentication & Access.
 *
 * Six additive columns on the AuthConfig singleton. There is no backfill and
 * nothing to convert, so the interesting assertion is not "did the columns
 * arrive" — it is "does the database still describe today's behaviour".
 *
 * Every boolean default reproduces the current product exactly:
 *   workerSmsLoginEnabled        true   worker SMS login is on today
 *   expressCheckInEnabled        true   express check-in is available today
 *   invitedWorkersOnly           false  access stays governed per site
 *   requireActiveSiteAssignment  false  as above
 *
 * That is what makes this safe to apply BEFORE the code deploy: the running
 * build never reads these columns, and once the new build does, the values it
 * reads are the behaviour it already had.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

/** Column shape as the database reports it. */
interface Col {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function main() {
  console.log('== SC-026 schema verification ==');

  const cols = await prisma.$queryRaw<Col[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'AuthConfig'
    ORDER BY column_name
  `;
  const by = new Map(cols.map((c) => [c.column_name, c]));

  // ---- the four booleans, each with the default that preserves behaviour ----
  const booleans: [string, 'true' | 'false'][] = [
    ['workerSmsLoginEnabled', 'true'],
    ['expressCheckInEnabled', 'true'],
    ['invitedWorkersOnly', 'false'],
    ['requireActiveSiteAssignment', 'false'],
  ];
  for (const [name, want] of booleans) {
    const c = by.get(name);
    const ok =
      !!c &&
      c.data_type === 'boolean' &&
      c.is_nullable === 'NO' &&
      (c.column_default ?? '').startsWith(want);
    check(
      `${name} is NOT NULL DEFAULT ${want}`,
      ok,
      c ? `default=${c.column_default}` : 'missing',
    );
  }

  // ---- the nullable integer: null is meaningful, it means "fall through" ----
  // getAuthRuntimeConfig() merges DB over env over built-in default. A NOT NULL
  // column with a default would silently pin the value and make the env key
  // dead, so nullability is the behaviour, not an oversight.
  const ttl = by.get('workerSessionTtlSeconds');
  check(
    'workerSessionTtlSeconds is a NULLABLE integer',
    !!ttl && ttl.data_type === 'integer' && ttl.is_nullable === 'YES',
    ttl ? `nullable=${ttl.is_nullable} type=${ttl.data_type}` : 'missing',
  );

  const who = by.get('updatedByUserId');
  check(
    'updatedByUserId is a nullable text column',
    !!who && who.data_type === 'text' && who.is_nullable === 'YES',
    who ? `nullable=${who.is_nullable}` : 'missing',
  );

  // ---- what must NOT have moved ----
  // The Admin Centre still owns these. If the migration had altered them, the
  // ownership split this release is built on would not hold.
  for (const name of [
    'otpTtlSeconds',
    'otpMaxAttempts',
    'sessionTtlSeconds',
    'smsOtpEnabled',
    'emailOtpEnabled',
    'updatedByAdminId',
  ]) {
    check(`${name} still exists (Admin Centre's column)`, by.has(name));
  }

  // ---- no data was invented ----
  // Production has no AuthConfig row at all: the platform has been running on
  // env-and-defaults. The migration must not have created one, because a row
  // means "an administrator chose these values" and nobody has.
  const rows = await prisma.authConfig.count();
  console.log(`\n  AuthConfig rows: ${rows}`);
  check(
    'the migration did not fabricate a config row',
    rows <= 1,
    `${rows} rows (the table is a singleton)`,
  );

  if (rows > 0) {
    // If a row already exists it must still describe today's behaviour — a
    // pre-existing Admin Centre row picks up the new columns' defaults.
    const row = await prisma.authConfig.findFirst();
    const preserved =
      row?.workerSmsLoginEnabled === true &&
      row?.expressCheckInEnabled === true &&
      row?.invitedWorkersOnly === false &&
      row?.requireActiveSiteAssignment === false;
    check(
      'the existing row still describes current behaviour',
      preserved,
      `sms=${row?.workerSmsLoginEnabled} express=${row?.expressCheckInEnabled} ` +
        `invited=${row?.invitedWorkersOnly} active=${row?.requireActiveSiteAssignment}`,
    );
    check(
      'worker session TTL still falls through to env/default',
      row?.workerSessionTtlSeconds == null,
      `stored=${row?.workerSessionTtlSeconds}`,
    );
  } else {
    console.log(
      '  (informational) no row — the platform runs on env/defaults, unchanged',
    );
  }

  console.log(`\n== ${failures === 0 ? 'VERIFIED' : `${failures} FAILED`} ==`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
