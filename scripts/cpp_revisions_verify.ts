/**
 * CPP document control Phase A — verification.
 *
 *   npx tsx scripts/cpp_revisions_verify.ts
 *
 * The CPP was a live view with no version, no issue date and no history. This
 * adds frozen revisions ALONGSIDE that view, with a hash connecting the two so
 * the system can say when the plan in force no longer matches the site.
 *
 * The hash is the part worth testing hardest. Hash too much and every page load
 * reports a change until nobody reads the notice; hash too little and a real
 * edit goes unannounced. It is exercised directly, both ways.
 */
import { readFileSync } from 'node:fs';
import { hashDraft } from '../services/sites/cppRevisionService';
import type { CppDraft } from '../services/sites/cppService';

let passed = 0;
let failed = 0;
function chk(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const svc = readFileSync('services/sites/cppRevisionService.ts', 'utf8');
const page = readFileSync('app/platform/dashboard/sites/[id]/cpp/page.tsx', 'utf8');
const bar = readFileSync('components/platform/CppRevisionBar.tsx', 'utf8');
const route = readFileSync('app/api/platform/sites/[id]/cpp-revisions/route.ts', 'utf8');
const code = (src: string) =>
  src.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('///') && !t.startsWith('/*');
  }).join('\n');

/** A minimal draft shaped like the real one. */
function draft(over: Partial<CppDraft> = {}): CppDraft {
  return {
    site: { id: 's1', name: 'Bell Street', jobReference: 'JR-1', address: '1 Bell St' },
    sections: [
      {
        key: 'project', title: 'Project description and programme', stepKey: 'project',
        manageHref: null,
        entries: [{ label: 'Project description', value: 'Demolition of the rear extension.' }],
        items: [], status: 'COMPLETE', missing: [], gatesCompletion: true,
      },
    ],
    drawings: [],
    completeness: {
      applicable: 10, completed: 5, percent: 50, outstanding: [], statuses: {},
      cppReady: false, reviewed: [], reviewedButIncomplete: [],
    },
    meta: {
      generatedAt: new Date('2026-01-01T00:00:00Z'),
      generatedByName: 'Jo', lastUpdatedAt: null, lastUpdatedByName: null,
    },
    outstanding: [],
    ...over,
  } as CppDraft;
}

function main() {
  console.log('== CPP REVISIONS (Phase A) ==\n');

  console.log('[1] The hash tracks CONTENT, and only content');
  const a = draft();
  chk('[1] the same content hashes the same', hashDraft(a) === hashDraft(draft()));

  // Volatile things that must NOT count, or the drift notice becomes noise.
  chk('[1] generatedAt does not count',
    hashDraft(a) === hashDraft(draft({
      meta: { ...a.meta, generatedAt: new Date('2027-06-06T12:00:00Z') },
    })));
  chk('[1] who generated it does not count',
    hashDraft(a) === hashDraft(draft({
      meta: { ...a.meta, generatedByName: 'Someone Else' },
    })));
  chk('[1] the completeness figures do not count',
    hashDraft(a) === hashDraft(draft({
      completeness: { ...a.completeness, completed: 9, percent: 90, cppReady: true },
    })));
  chk('[1] section STATUS alone does not count — text is what a reader sees',
    hashDraft(a) === hashDraft(draft({
      sections: [{ ...a.sections[0]!, status: 'PARTIAL', missing: ['x'] }],
    })));

  // Real changes that MUST count.
  chk('[1] changed section text counts',
    hashDraft(a) !== hashDraft(draft({
      sections: [{
        ...a.sections[0]!,
        entries: [{ label: 'Project description', value: 'Full demolition.' }],
      }],
    })));
  chk('[1] a changed entry LABEL counts',
    hashDraft(a) !== hashDraft(draft({
      sections: [{
        ...a.sections[0]!,
        entries: [{ label: 'Description', value: 'Demolition of the rear extension.' }],
      }],
    })));
  chk('[1] an added section counts',
    hashDraft(a) !== hashDraft(draft({
      sections: [...a.sections, { ...a.sections[0]!, key: 'x', title: 'Another' }],
    })));
  chk('[1] a removed section counts', hashDraft(a) !== hashDraft(draft({ sections: [] })));
  chk('[1] a changed list ITEM counts',
    hashDraft(a) !== hashDraft(draft({
      sections: [{ ...a.sections[0]!, items: [{ label: 'Wear a hard hat', detail: null }] }],
    })));
  chk('[1] a new drawing counts',
    hashDraft(a) !== hashDraft(draft({
      drawings: [{ id: 'd1', title: 'Site layout', fileName: 'layout.pdf' }],
    })));
  chk('[1] a renamed site counts',
    hashDraft(a) !== hashDraft(draft({ site: { ...a.site, name: 'Other Street' } })));
  chk('[1] a null entry is not content',
    hashDraft(a) === hashDraft(draft({
      sections: [{
        ...a.sections[0]!,
        entries: [...a.sections[0]!.entries, { label: 'Empty', value: null }],
      }],
    })));

  console.log('\n[2] A snapshot is immutable');
  // Checked on the UPDATE CALLS THEMSELVES rather than by counting mentions of
  // the word: `snapshot` legitimately appears in a select, in reads and as a
  // parameter name, and the first version of this counted all four and failed
  // correct code.
  const updates = [...code(svc).matchAll(/cppRevision\.update\(\{[\s\S]*?\n\s{4,6}\}\);/g)]
    .map((m) => m[0]);
  chk('[2] CONTROL — the update calls were located', updates.length === 2, `${updates.length}`);
  chk('[2] no update writes a snapshot or its hash',
    updates.every((u) => !/snapshot|contentHash/.test(u)));
  chk('[2] the snapshot is written exactly once, at creation',
    (code(svc).match(/snapshot: snapshotOf\(/g) ?? []).length === 1);
  chk('[2] no route verb edits an existing revision',
    !/'edit'|'update'/.test(code(route)));
  chk('[2] only a DRAFT can be discarded, and the guard is in the query',
    /deleteMany\(\{[\s\S]{0,200}status: CppRevisionStatus\.DRAFT/.test(code(svc)));
  chk('[2] the event log is append-only — nothing updates or deletes it',
    !/cppRevisionEvent\.(update|delete)/.test(code(svc)));

  console.log('\n[3] One in force, one draft');
  chk('[3] a second open draft is refused',
    /is already open as a draft/.test(svc));
  chk('[3] issuing supersedes the previous one in the SAME transaction',
    /\$transaction\([\s\S]{0,900}SUPERSEDED[\s\S]{0,900}ISSUED/.test(code(svc)));
  chk('[3] versions increment per site',
    /orderBy: \{ version: 'desc' \}[\s\S]{0,120}const version = \(last\?\.version \?\? 0\) \+ 1;/.test(code(svc)));
  chk('[3] the unique key stops two revisions sharing a version',
    /@@unique\(\[jobSiteId, version\]\)/.test(schema));

  console.log('\n[4] Permissions');
  // Phase A gated issuing at canEditSite (Director only) so nothing would have
  // to be loosened later; Phase B widened it to the Principal Contractor, who is
  // the duty holder CDM names. The ENDURING claim is that issuing is restricted
  // to duty-holder roles and is enforced in the service — the exact role list is
  // owned by cpp_approval_verify, which tests it directly.
  chk('[4] issuing is restricted to duty-holder roles, in the service',
    /issueRevision[\s\S]{0,600}canIssueCpp\(viewer\.role\)/.test(code(svc)));
  chk('[4]   and it is not merely the ordinary site-edit right',
    !/issueRevision[\s\S]{0,600}permits\(viewer\.role, 'sites', 'edit'\)/.test(code(svc)));
  chk('[4] creating a revision follows sites:edit',
    /createRevision[\s\S]{0,400}permits\(viewer\.role, 'sites', 'edit'\)/.test(code(svc)));
  chk('[4] every entry point checks site scope',
    (code(svc).match(/viewer\.siteIds\.includes\(siteId\)/g) ?? []).length >= 4);
  chk('[4] a closed project is handled like any other write',
    /withClosedProjectHandling/.test(route));

  console.log('\n[5] The plan does not lie about its own standing');
  chk('[5] the banner follows the revision being read',
    /viewingRevision\?\.status === 'ISSUED'/.test(page) &&
    /Superseded — Revision/.test(page));
  chk('[5] the unconditional "Draft" banner is gone',
    !/Draft — for duty holder review and approval/.test(page));
  chk('[5] a working draft still says so',
    /Working draft — for duty holder review and approval/.test(page));
  chk('[5] live completeness is hidden against a frozen revision',
    /\{!viewingRevision && \(/.test(page));
  chk('[5] the gap list too', /!viewingRevision && cpp\.outstanding\.length > 0/.test(page));
  chk('[5] issue date is printed when there is one', /<dt className="inline font-semibold">Issued: <\/dt>/.test(page));

  console.log('\n[6] The live draft survived document control');
  chk('[6] the page still assembles the live draft every request',
    /const cpp = await getCppDraft\(viewer, params\.id\);/.test(page));
  chk('[6] a revision only replaces the sections and drawings',
    /const sections = viewingRevision[\s\S]{0,160}cpp\.sections;/.test(page));
  chk('[6] drift is computed against the LIVE draft',
    /getRevisionState\(viewer, params\.id, cpp\)/.test(page));

  console.log('\n[7] Drift is actionable, not just a flag');
  chk('[7] the diff is section-level', /changedSections/.test(svc) && /changedSections/.test(bar));
  chk('[7] drift is null when nothing is issued — not "up to date"',
    /driftFromIssued: RevisionState\['driftFromIssued'\] = null;/.test(code(svc)));
  chk('[7] the banner states the issued revision is unchanged',
    /The issued revision is unchanged and remains the version in force/.test(bar));
  // Asserted on the PAIR being offered, not on either label's exact wording.
  // The issued button was relabelled "Revision N (Current)" because "Issued
  // (Rev N)" named the EVENT when a reader needs to know which document is in
  // force — and pinning the old string made that a test failure.
  chk('[7] the switcher offers both documents',
    /Working draft/.test(bar) && /\?revision=\$\{issued\.id\}/.test(bar));

  console.log('\n[8] Nothing is seeded, and history is not hidden');
  chk('[8] no revision is invented for existing sites',
    !/createMany/.test(code(svc)));
  chk('[8] superseded revisions stay openable',
    /\$\{base\}\?revision=\$\{r\.id\}/.test(
      readFileSync('app/platform/dashboard/sites/[id]/cpp/revisions/page.tsx', 'utf8'),
    ));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
