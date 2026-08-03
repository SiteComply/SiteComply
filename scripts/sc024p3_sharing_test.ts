/**
 * SC-024 Phase 3 — the secure-sharing security model, against the real database.
 *
 * A share link is the only part of SiteComply reachable with no session at all,
 * so these are the assertions that matter:
 *   - a token that was never issued resolves to nothing;
 *   - expiry and revocation actually deny;
 *   - the token is NOT recoverable from the database;
 *   - the link dies when the sharer loses access.
 *
 * Fixtures are created and removed inside the run.
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import {
  createShare,
  listShares,
  revokeShare,
  resolveShare,
  recordShareView,
} from '@/services/closeOut/closeOutSharing';
import type { PlatformViewer } from '@/services/platformUsers/platformViewerTypes';

const prisma = new PrismaClient();

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

const SUFFIX = randomBytes(4).toString('hex');
let adminId = '';
const ids: {
  siteId?: string;
  packId?: string;
  directorId?: string;
  otherSiteId?: string;
} = {};

function viewerFor(
  id: string,
  role: string,
  siteIds: string[],
  name = 'Test Director',
): PlatformViewer {
  return {
    id,
    name,
    company: 'SiteComply Test',
    role: role as PlatformViewer['role'],
    allSites: role === 'DIRECTOR',
    siteIds,
    sites: [],
    overrides: {},
    companyDefaults: {},
  };
}

async function setup() {
  // JobSite requires a creating admin. Reuse an existing one rather than
  // fabricating a second identity just for a fixture.
  const admin = await prisma.admin.findFirst({ select: { id: true } });
  if (!admin) throw new Error('No Admin row to attribute fixture sites to.');
  adminId = admin.id;

  const site = await prisma.jobSite.create({
    data: {
      name: `SC024P3 Share Test ${SUFFIX}`,
      jobReference: `SC024P3-${SUFFIX}`,
      addressLine1: '1 Test Way',
      town: 'Testville',
      postcode: 'TE1 1ST',
      status: 'ACTIVE',
      createdByAdmin: { connect: { id: adminId } },
    },
    select: { id: true },
  });
  ids.siteId = site.id;

  const other = await prisma.jobSite.create({
    data: {
      name: `SC024P3 Other ${SUFFIX}`,
      jobReference: `SC024P3-O-${SUFFIX}`,
      addressLine1: '2 Test Way',
      town: 'Testville',
      postcode: 'TE1 2ST',
      status: 'ACTIVE',
      createdByAdmin: { connect: { id: adminId } },
    },
    select: { id: true },
  });
  ids.otherSiteId = other.id;

  const director = await prisma.platformUser.create({
    data: {
      name: `SC024P3 Director ${SUFFIX}`,
      email: `sc024p3.${SUFFIX}@example.test`,
      company: 'SiteComply Test',
      role: 'DIRECTOR',
      status: 'ACTIVE',
    },
    select: { id: true },
  });
  ids.directorId = director.id;

  const pack = await prisma.closeOutPack.create({
    data: {
      jobSiteId: site.id,
      version: 1,
      title: 'Share test pack',
      sections: [{ section: 'site_details', order: 0 }],
      generatedByUserId: director.id,
      generatedByName: 'SC024P3 Director',
    },
    select: { id: true },
  });
  ids.packId = pack.id;
}

async function teardown() {
  if (ids.packId)
    await prisma.closeOutPack.deleteMany({ where: { id: ids.packId } });
  if (ids.siteId)
    await prisma.jobSite.deleteMany({ where: { id: ids.siteId } });
  if (ids.otherSiteId)
    await prisma.jobSite.deleteMany({ where: { id: ids.otherSiteId } });
  if (ids.directorId)
    await prisma.platformUser.deleteMany({ where: { id: ids.directorId } });
}

async function main() {
  console.log('== SC-024 P3 secure sharing ==\n');
  await setup();

  const director = viewerFor(ids.directorId!, 'DIRECTOR', [ids.siteId!]);
  const packId = ids.packId!;

  console.log('[1] Creating a link');
  const created = await createShare(director, packId, {
    label: 'Acme Developments',
    days: 30,
  });
  check('link created', created.ok, created.ok ? '' : created.reason);
  const token = created.ok ? created.share.token : '';
  check(
    'token is 256-bit base64url',
    /^[A-Za-z0-9_-]{43}$/.test(token),
    token.slice(0, 12) + '…',
  );

  console.log('\n[2] The token is NOT recoverable from the database');
  const stored = await prisma.closeOutPackShare.findFirst({
    where: { packId },
    select: { tokenHash: true },
  });
  check('only a hash is stored', stored?.tokenHash !== token);
  check(
    'stored value is the SHA-256 of the token',
    stored?.tokenHash === createHash('sha256').update(token).digest('hex'),
  );
  const listed = await listShares(director, packId);
  check(
    'listing never exposes a token or hash',
    !!listed &&
      !JSON.stringify(listed).includes(token) &&
      !JSON.stringify(listed).includes(stored!.tokenHash),
  );

  console.log('\n[3] Resolving');
  const good = await resolveShare(token);
  check('valid token resolves', good.ok, good.ok ? '' : good.reason);
  check('resolves to the right pack', good.ok && good.share.packId === packId);
  check(
    'carries the sharer viewer',
    good.ok && good.share.viewer.id === ids.directorId,
  );

  console.log('\n[4] Tokens that were never issued are refused');
  for (const [name, bad] of [
    ['a random unissued token', randomBytes(32).toString('base64url')],
    ['empty string', ''],
    ['sql-ish junk', "' OR 1=1--"],
    ['the stored hash itself', stored!.tokenHash],
  ] as [string, string][]) {
    const r = await resolveShare(bad);
    check(`${name} refused`, !r.ok, r.ok ? 'ACCEPTED — BAD' : r.reason);
  }

  console.log('\n[5] Expiry denies');
  await prisma.closeOutPackShare.updateMany({
    where: { packId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const expired = await resolveShare(token);
  check('expired link refused', !expired.ok);
  check(
    'reason is "expired", not a generic failure',
    !expired.ok && expired.reason === 'expired',
    expired.ok ? '' : expired.reason,
  );
  await prisma.closeOutPackShare.updateMany({
    where: { packId },
    data: { expiresAt: new Date(Date.now() + 86400_000) },
  });

  console.log('\n[6] Revocation denies, and is reported as revoked');
  const shareId = (
    await prisma.closeOutPackShare.findFirstOrThrow({
      where: { packId },
      select: { id: true },
    })
  ).id;
  check('revoke succeeds', await revokeShare(director, shareId));
  const revoked = await resolveShare(token);
  check('revoked link refused', !revoked.ok);
  check(
    'reason is "revoked" — not "expired"',
    !revoked.ok && revoked.reason === 'revoked',
    revoked.ok ? '' : revoked.reason,
  );
  check('revoking twice is idempotent', await revokeShare(director, shareId));

  console.log('\n[7] The link dies when the sharer loses access');
  const fresh = await createShare(director, packId, {
    label: 'Second client',
    days: 7,
  });
  const token2 = fresh.ok ? fresh.share.token : '';
  check('second link works', (await resolveShare(token2)).ok);
  await prisma.platformUser.update({
    where: { id: ids.directorId! },
    data: { status: 'DISABLED' },
  });
  const orphan = await resolveShare(token2);
  check(
    'deactivating the sharer kills the link',
    !orphan.ok && orphan.reason === 'sharer_lost_access',
    orphan.ok ? 'STILL WORKS — BAD' : orphan.reason,
  );
  await prisma.platformUser.update({
    where: { id: ids.directorId! },
    data: { status: 'ACTIVE' },
  });
  check('reactivating restores it', (await resolveShare(token2)).ok);

  console.log('\n[8] Permission checks on creation');
  const engineer = viewerFor(ids.directorId!, 'ENGINEER', [ids.siteId!]);
  const denied = await createShare(engineer, packId, { label: 'X', days: 7 });
  check(
    'a role that cannot generate packs cannot share them',
    !denied.ok && denied.reason === 'forbidden',
    denied.ok ? 'ALLOWED — BAD' : denied.reason,
  );

  const wrongSite = viewerFor(ids.directorId!, 'PROJECT_MANAGER', [
    ids.otherSiteId!,
  ]);
  const outOfScope = await createShare(wrongSite, packId, {
    label: 'X',
    days: 7,
  });
  check(
    "a pack outside the viewer's sites cannot be shared",
    !outOfScope.ok && outOfScope.reason === 'not_found',
    outOfScope.ok ? 'ALLOWED — BAD' : outOfScope.reason,
  );
  check(
    'listing is refused out of scope',
    (await listShares(wrongSite, packId)) === null,
  );

  console.log('\n[9] Input validation');
  for (const [name, input] of [
    ['empty label', { label: '   ', days: 30 }],
    ['over-long label', { label: 'x'.repeat(121), days: 30 }],
    ['zero days', { label: 'ok', days: 0 }],
    ['beyond the maximum window', { label: 'ok', days: 365 }],
  ] as [string, { label: string; days: number }][]) {
    const r = await createShare(director, packId, input);
    check(`${name} rejected`, !r.ok, r.ok ? 'ACCEPTED — BAD' : r.reason);
  }

  console.log('\n[10] Access logging');
  const beforeRow = await prisma.closeOutPackShare.findFirstOrThrow({
    where: { packId, revokedAt: null },
    select: { id: true, viewCount: true },
  });
  await recordShareView(beforeRow.id, 'VIEW', '203.0.113.7');
  const afterRow = await prisma.closeOutPackShare.findUniqueOrThrow({
    where: { id: beforeRow.id },
    select: { viewCount: true, lastViewedAt: true },
  });
  check(
    'view increments the counter',
    afterRow.viewCount === beforeRow.viewCount + 1,
    `${beforeRow.viewCount} -> ${afterRow.viewCount}`,
  );
  check('last viewed recorded', afterRow.lastViewedAt !== null);
  const logged = await prisma.closeOutPackShareView.findFirst({
    where: { shareId: beforeRow.id },
    orderBy: { viewedAt: 'desc' },
    select: { ipHash: true, action: true },
  });
  check('action recorded', logged?.action === 'VIEW');
  check(
    'raw IP is never stored',
    !!logged?.ipHash && !logged.ipHash.includes('203.0.113.7'),
    logged?.ipHash ?? 'none',
  );

  console.log(
    `\n== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} ==`,
  );
}

main()
  .then(async () => {
    await teardown();
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await teardown();
    await prisma.$disconnect();
    process.exit(1);
  });
