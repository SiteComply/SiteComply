export {};
/**
 * Company induction modules administered from BOTH realms.
 *
 * THE PROPERTIES THAT MATTER:
 *  - one service, one approval workflow, one audit trail, one action dispatcher:
 *    the Admin Centre is a second front door, NOT a second module system;
 *  - authority is resolved at the edge, so the service reads no role string and
 *    there is only ever one set of rules to change;
 *  - an Admin OWNER and ADMIN may manage (the owner's decision); a VIEWER may not;
 *  - every write records WHICH REALM it came from, because two authorities that
 *    are equivalent in power are still worth telling apart afterwards;
 *  - an admin id is never written into a platform user column.
 *
 * Runs against the local database and removes everything it creates.
 *
 * Run: npx tsx scripts/induction_modules_realm_verify.ts
 */
const { prisma } = require('../lib/prisma');
const svc = require('../services/inductionModules/inductionModuleService');
const { moduleActorFromAdmin, moduleActorFromPlatformViewer, describeRealm } =
  require('../services/inductionModules/moduleActor');
const { handleModuleAction } = require('../services/inductionModules/moduleActions');
const { readFileSync, existsSync } = require('fs');

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const read = (p: string) => readFileSync(p, 'utf8');

const SLUG = 'REALM_TEST_MODULE';
const adminSession = (role: string) => ({
  typ: 'admin', adminId: 'adm-1', email: 'a@b.c', name: 'Ada Admin', role, iat: 0, exp: 0,
});
const director = { id: 'u1', name: 'Dee Director', role: 'DIRECTOR', siteIds: [] as string[] };

(async () => {
  await prisma.inductionModule.deleteMany({ where: { slug: SLUG } });
  try {
    console.log('\nCAPABILITY IS RESOLVED AT THE EDGE');
    const owner = moduleActorFromAdmin(adminSession('OWNER'));
    const admin = moduleActorFromAdmin(adminSession('ADMIN'));
    const viewer = moduleActorFromAdmin(adminSession('VIEWER'));
    const plat = moduleActorFromPlatformViewer(director);
    chk('an Admin OWNER may draft and issue', owner.canDraft && owner.canIssue);
    chk('an Admin ADMIN may draft and issue', admin.canDraft && admin.canIssue);
    chk('an Admin VIEWER may do neither', !viewer.canDraft && !viewer.canIssue);
    chk('a Director may draft and issue', plat.canDraft && plat.canIssue);
    chk('an admin actor carries no platform user id', owner.userId === null);
    chk('a platform actor carries no admin id', plat.adminId === null);
    chk('realms are tagged', owner.realm === 'ADMIN' && plat.realm === 'PLATFORM');
    chk('realms read for humans',
      describeRealm('ADMIN') === 'Admin Centre' && describeRealm('PLATFORM') === 'Platform');

    console.log('\nTHE SERVICE READS NO ROLE STRING');
    const SRC = read('services/inductionModules/inductionModuleService.ts');
    chk('no PlatformViewer in the service', !/PlatformViewer/.test(SRC));
    chk('no viewer.role in the service', !/viewer\.role/.test(SRC));
    chk('no AdminRole branching in the service', !/'OWNER'|'VIEWER'|AdminRole/.test(SRC));
    chk('the realm is never used for a decision in the service',
      !/(if|&&|\|\|)[^\n]*actor\.realm/.test(SRC),
      'realm is for the record, canDraft/canIssue decide');

    console.log('\nONE DISPATCHER, TWO THIN ROUTES');
    const PR = 'app/api/platform/induction-modules/route.ts';
    const AR = 'app/api/admin/induction-modules/route.ts';
    chk('the admin route exists', existsSync(AR));
    for (const [label, f] of [['platform', PR], ['admin', AR]] as const) {
      const src = read(f);
      chk(`the ${label} route calls the shared dispatcher`, /handleModuleAction\(/.test(src));
      chk(`the ${label} route implements no action itself`,
        !/startDraft\(|issueRevision\(|saveDraft\(/.test(src),
        'an action implemented twice is a workflow duplicated');
    }
    chk('the admin route refuses a VIEWER at the door',
      /requireAdminRole\(ADMIN_WRITE_ROLES\)/.test(read(AR)));

    console.log('\nONE EDITOR COMPONENT, NOT A COPY');
    const SEC = 'components/platform/InductionModulesSection.tsx';
    chk('the editor takes its endpoint as a prop', /endpoint: string/.test(read(SEC)));
    chk('the editor hard-codes no endpoint', !/fetch\('\/api\//.test(read(SEC)));
    // Moved out of Settings into the Induction Videos area; the old path is now a
    // redirect stub, so asserting against it would prove nothing.
    const adminPage = read('app/admin/(dashboard)/induction-videos/modules/page.tsx');
    chk('the admin page renders the SAME editor',
      /InductionModulesSection/.test(adminPage) &&
      /endpoint="\/api\/admin\/induction-modules"/.test(adminPage));
    chk('both pages build rows from the shared builder',
      /moduleRowsForEditor/.test(adminPage) &&
      /moduleRowsForEditor/.test(read('app/platform/dashboard/induction-videos/modules/page.tsx')));

    console.log('\nAN ADMIN CAN ACTUALLY DO THE WORK, END TO END');
    const mod = await prisma.inductionModule.create({
      data: { slug: SLUG, title: 'Realm test', category: 'SAFETY', order: 900,
              mandatory: false, defaultIncluded: true, createdByName: 'test' },
      select: { id: true },
    });
    const started = await handleModuleAction(owner, { action: 'startDraft', moduleId: mod.id });
    chk('an admin starts a draft', started.status === 200 && started.payload.ok === true,
      JSON.stringify(started.payload));
    const revId = started.payload.revisionId as string;
    const saved = await handleModuleAction(admin, {
      action: 'saveDraft', revisionId: revId,
      heading: 'Realm heading', narration: 'A'.repeat(80),
    });
    chk('an Admin ADMIN edits it', saved.payload.ok === true, JSON.stringify(saved.payload));
    const refusedV = await handleModuleAction(viewer, {
      action: 'issue', revisionId: revId, issueNote: 'should be refused',
    });
    chk('an Admin VIEWER is refused by the SERVICE, not just the route',
      refusedV.payload.ok === false);
    const issued = await handleModuleAction(owner, {
      action: 'issue', revisionId: revId, issueNote: 'Issued in a test',
    });
    chk('an admin issues it', issued.payload.ok === true, JSON.stringify(issued.payload));

    console.log('\nTHE RECORD SAYS WHERE IT CAME FROM');
    const rev = await prisma.inductionModuleRevision.findUnique({
      where: { id: revId },
      select: { issuedByRealm: true, issuedByAdminId: true, issuedByUserId: true,
                preparedByRealm: true, issuedByName: true },
    });
    chk('the issued revision records the ADMIN realm', rev.issuedByRealm === 'ADMIN');
    chk('it records the admin id', rev.issuedByAdminId === 'adm-1');
    chk('it does NOT put the admin id in the platform user column',
      rev.issuedByUserId === null,
      'a dangling id in an audit record is worse than an absent one');
    chk('the draft it came from records its realm too', rev.preparedByRealm === 'ADMIN');
    const events = await prisma.inductionModuleEvent.findMany({
      where: { revisionId: revId }, select: { action: true, actorRealm: true },
    });
    chk('every event records a realm',
      events.length >= 3 && events.every((e: { actorRealm: string | null }) => e.actorRealm === 'ADMIN'),
      events.map((e: { action: string; actorRealm: string }) => `${e.action}:${e.actorRealm}`).join(' '));

    console.log('\nTHE SCHEMA MATCHES THE MIGRATION, MODEL FOR MODEL');
    /*
     * Added after a real incident: an unbounded string replace across the schema
     * put `actorRealm` on InductionVideoEvent and four realm columns on
     * CppRevision as well, because both share the field shape being edited. The
     * migration added none of them, so Prisma expected columns production did not
     * have - which surfaces as a runtime error on an unrelated feature, not as a
     * type error. This asserts the two artefacts agree.
     */
    const SCHEMA = read('prisma/schema.prisma');
    /*
     * EVERY migration, not just this feature's. The guard was written against one
     * file and immediately became wrong when induction videos gained realm columns
     * of their own in a second migration - reporting them as orphaned when they
     * were simply migrated elsewhere. The question is "is this column migrated
     * ANYWHERE", so read the whole directory.
     */
    const MIG = require('fs')
      .readdirSync('prisma/migrations')
      .filter((d: string) => existsSync(`prisma/migrations/${d}/migration.sql`))
      .map((d: string) => read(`prisma/migrations/${d}/migration.sql`))
      .join('\n');
    const owners = new Map<string, string>();
    let model = '';
    for (const line of SCHEMA.split('\n')) {
      const m = /^model (\w+)/.exec(line);
      if (m) model = m[1];
      const c = /^\s{2}(\w*(?:Realm|AdminId))\s/.exec(line);
      if (c) owners.set(`${model}.${c[1]}`, model);
    }
    const declared = [...owners.keys()].filter((k) => /Realm$/.test(k));
    const migrated = new Set<string>();
    let table = '';
    for (const line of MIG.split('\n')) {
      const t = /^ALTER TABLE "(\w+)"/.exec(line);
      if (t) table = t[1];
      const c = /ADD COLUMN IF NOT EXISTS "(\w+)"/.exec(line);
      if (c) migrated.add(`${table}.${c[1]}`);
    }
    const unmigrated = declared.filter((k) => !migrated.has(k));
    chk('every *Realm column the schema declares is in the migration',
      unmigrated.length === 0,
      unmigrated.length ? `orphaned: ${unmigrated.join(', ')}` : 'schema and migration agree');
    // The intended set, listed rather than derived: adding a table here should be
    // a deliberate act, so an accidental column on an unrelated model still fails.
    const ALLOWED =
      /^(InductionModuleRevision|InductionModuleEvent|SiteInductionModule|InductionVideo|InductionVideoEvent)\./;
    chk('realm columns appear only on the tables meant to have them',
      declared.every((k) => ALLOWED.test(k)),
      declared.filter((k) => !ALLOWED.test(k)).join(' ') || declared.length + ' declared, all expected');

    console.log('\nONE SOURCE OF TRUTH: THE ADMIN’S WORDS ARE WHAT A SITE RESOLVES');
    const resolved = await svc.resolveModulesForSite('no-such-site');
    const mine = resolved.find((r: { slug: string }) => r.slug === SLUG);
    chk('the module an admin issued is what every project inherits',
      Boolean(mine) && mine.narration === 'A'.repeat(80),
      'no second data model, no copy to keep in step');
  } finally {
    await prisma.inductionModule.deleteMany({ where: { slug: SLUG } });
    await prisma.$disconnect();
  }
  console.log(`\n${fails} failed\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
