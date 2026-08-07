/**
 * SC-031 migration verifier — Company Profile & Branding.
 *
 * Twenty additive columns on the CompanyConfig singleton. There is no backfill
 * and nothing to convert, so the interesting assertion is not "did the columns
 * arrive" — it is "does the database still describe today's behaviour".
 *
 * The four pack-branding booleans default TRUE. That is what makes this safe to
 * apply before the code: close-out packs already render company info, the logo
 * and standard details, and a default of TRUE reproduces exactly that. A
 * default of FALSE would silently strip branding from the next pack anyone
 * generated.
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

interface Col {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function main() {
  console.log('== SC-031 schema verification ==');

  const cols = await prisma.$queryRaw<Col[]>`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'CompanyConfig'
    ORDER BY column_name
  `;
  const by = new Map(cols.map((c) => [c.column_name, c]));

  // ---- the four booleans, each defaulting to what packs render today ----
  for (const name of [
    'packIncludeCompanyInfo',
    'packIncludeLogo',
    'packIncludePrintLogo',
    'packIncludeStandardDetails',
  ]) {
    const c = by.get(name);
    const ok =
      !!c &&
      c.data_type === 'boolean' &&
      c.is_nullable === 'NO' &&
      (c.column_default ?? '').startsWith('true');
    check(
      `${name} is NOT NULL DEFAULT true`,
      ok,
      c ? `default=${c.column_default}` : 'missing',
    );
  }

  // ---- text columns: nullable, no default ----
  // NULL means "not set", and every reader falls back to what it does now. A
  // default here would fabricate company details nobody supplied.
  const textCols = [
    'registrationNumber',
    'vatNumber',
    'primaryContactName',
    'primaryEmail',
    'primaryPhone',
    'website',
    'addressLine1',
    'addressLine2',
    'addressTown',
    'addressPostcode',
    'disclaimer',
    'reportFooter',
    'printLogoBlobPath',
    'printLogoContentType',
    'updatedByUserId',
  ];
  for (const name of textCols) {
    const c = by.get(name);
    const ok =
      !!c && c.data_type === 'text' && c.is_nullable === 'YES' && !c.column_default;
    check(
      `${name} is a nullable text column with no default`,
      ok,
      c ? `type=${c.data_type} nullable=${c.is_nullable} default=${c.column_default}` : 'missing',
    );
  }

  const at = by.get('printLogoUpdatedAt');
  check(
    'printLogoUpdatedAt is a nullable timestamp',
    !!at && at.data_type.startsWith('timestamp') && at.is_nullable === 'YES',
    at ? `${at.data_type} nullable=${at.is_nullable}` : 'missing',
  );

  // ---- what must NOT have moved ----
  // These already appear on close-out packs. If the migration had altered them,
  // existing packs would render differently.
  for (const name of [
    'companyName',
    'supportEmail',
    'supportPhone',
    'primaryColor',
    'accentColor',
    'tagline',
    'logoBlobPath',
    'logoContentType',
    'logoUpdatedAt',
    'updatedByAdminId',
  ]) {
    check(`${name} still exists (pre-existing, read by packs)`, by.has(name));
  }

  // ---- no data was invented ----
  const rows = await prisma.companyConfig.count();
  console.log(`\n  CompanyConfig rows: ${rows}`);
  check(
    'the migration did not fabricate a config row',
    rows <= 1,
    `${rows} rows (the table is a singleton)`,
  );

  if (rows > 0) {
    const row = await prisma.companyConfig.findFirst();
    check(
      'pack branding still reproduces current behaviour',
      row?.packIncludeCompanyInfo === true &&
        row?.packIncludeLogo === true &&
        row?.packIncludePrintLogo === true &&
        row?.packIncludeStandardDetails === true,
      `info=${row?.packIncludeCompanyInfo} logo=${row?.packIncludeLogo} ` +
        `print=${row?.packIncludePrintLogo} details=${row?.packIncludeStandardDetails}`,
    );
    check(
      'no company profile details were invented',
      !row?.registrationNumber && !row?.vatNumber && !row?.primaryEmail,
      'expected all null on a pre-existing row',
    );
  } else {
    console.log(
      '  (informational) no row — the platform runs on product defaults, unchanged',
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
