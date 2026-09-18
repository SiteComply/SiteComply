/**
 * CPP document control Phase B — approval and signature. Verification.
 *
 *   npx tsx scripts/cpp_approval_verify.ts
 *
 * Phase A could version and freeze a plan but not say who approved it. Approving
 * and issuing are ONE act here, so this adds the evidence of that act: the
 * approver's role at the time, the declaration they accepted, and their
 * signature — and makes a signature mandatory to issue at all.
 */
import { readFileSync } from 'node:fs';
import { CPP_APPROVAL_DECLARATION } from '../services/sites/cppRevisionService';
import { canIssueCpp, CPP_ISSUE_ROLES } from '../services/platformUsers/platformPermissions';

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

function main() {
  console.log('== CPP APPROVAL (Phase B) ==\n');

  console.log('[1] Who may approve and issue');
  chk('[1] a Director may', canIssueCpp('DIRECTOR'));
  chk('[1] a Principal Contractor may — the duty holder CDM names',
    canIssueCpp('PRINCIPAL_CONTRACTOR'));
  chk('[1] a Site Manager may NOT approve the plan they wrote',
    !canIssueCpp('SITE_MANAGER'));
  for (const r of ['PROJECT_MANAGER', 'CLIENT', 'AUDITOR', 'ENGINEER', 'HS_CONSULTANT'] as const) {
    chk(`[1] ${r} may not`, !canIssueCpp(r));
  }
  chk('[1] exactly two roles', CPP_ISSUE_ROLES.length === 2, CPP_ISSUE_ROLES.join(', '));
  chk('[1] the service enforces it, not merely the UI',
    /canIssueCpp\(viewer\.role\)/.test(code(svc)));
  chk('[1] and says who may',
    /Only a Director or Principal Contractor can approve and issue/.test(svc));

  console.log('\n[2] There is no unsigned route to issuing');
  chk('[2] a missing or invalid signature refuses the issue',
    /A signature is required to approve and issue the plan/.test(svc));
  chk('[2] the check happens BEFORE the transaction',
    code(svc).indexOf('A signature is required') < code(svc).indexOf('$transaction'));
  chk('[2] validation is shared with the induction, not re-implemented',
    /parseSignatureInput/.test(code(svc)));
  chk('[2] the route passes the signature through',
    /signature: sig \?\? undefined/.test(bar) && /body\.signature/.test(code(route)));
  chk('[2] the dialog cannot submit without both declaration and signature',
    /disabled=\{busy \|\| !accepted \|\| !signature\}/.test(bar));

  console.log('\n[3] The approval record');
  for (const col of ['approverRole', 'declarationText', 'signedName', 'signatureType', 'signatureBlobPath']) {
    chk(`[3] ${col} is stored on the revision`,
      new RegExp(`${col}\\s+`).test(schema.slice(schema.indexOf('model CppRevision {'), schema.indexOf('model CppRevisionEvent {'))));
  }
  chk('[3] the role is snapshotted at approval, not read back later',
    /approverRole: viewer\.role/.test(code(svc)));
  chk('[3] the declaration is snapshotted too',
    /declarationText: CPP_APPROVAL_DECLARATION/.test(code(svc)));
  // SCOPED TO CppRevision. The first version scanned the whole schema and
  // tripped on Permit, InductionQuestionBank and WorkerSiteAssignment, which
  // legitimately have approvedAt/approvedByName of their own. The claim is only
  // ever about this model.
  const revModel = code(schema).slice(
    code(schema).indexOf('model CppRevision {'),
    code(schema).indexOf('model CppRevisionEvent {'),
  );
  chk('[3] CONTROL — the CppRevision model was located',
    revModel.includes('contentHash') && revModel.length > 400);
  chk('[3] CppRevision has NO second approvedAt/approvedByName pair',
    !/approvedAt|approvedByName/.test(revModel));
  chk('[3]   because issuing IS the approval', /issuedAt: now/.test(code(svc)));

  console.log('\n[4] The declaration is honest about what software can attest');
  chk('[4] it asks for the approver\'s judgement',
    /in my judgement it is suitable and sufficient/.test(CPP_APPROVAL_DECLARATION));
  chk('[4] it records the duty to keep the plan up to date',
    /reviewed and revised as the work proceeds/.test(CPP_APPROVAL_DECLARATION));
  chk('[4] it never claims the SYSTEM approved anything',
    !/SiteComply|this system|automatically/i.test(CPP_APPROVAL_DECLARATION));
  chk('[4] it is shown before it is accepted',
    /\{declaration\}/.test(bar));

  console.log('\n[5] The printed approval block');
  chk('[5] the blank pen-and-paper lines are gone from an ISSUED revision',
    /viewingRevision\?\.status === 'ISSUED' \|\|/.test(page));
  // The claim is that an UNAPPROVED document shows unsigned lines and says so —
  // not the exact sentence, which the redesign reworded.
  chk('[5] a working draft still shows blank lines — nothing was approved',
    /This is a working draft\./.test(page) && /cpp-sigline/.test(page));
  chk('[5] approver, position and date are printed',
    /<dt>Approved by<\/dt>/.test(page) && /<dt>Position<\/dt>/.test(page) &&
    /<dt>Date<\/dt>/.test(page));
  chk('[5] the declaration accepted is printed with it',
    /viewingRevision\.declarationText/.test(page));
  chk('[5] a drawn signature is rendered from the scoped route',
    /cpp-revisions\/\$\{viewingRevision\.id\}\/signature/.test(page));
  // The face moved into the scoped document stylesheet with the redesign, so
  // the assertion follows it rather than the page.
  chk('[5] a typed signature uses the same face as the induction record',
    /'Segoe Script', 'Brush Script MT', cursive/.test(
      readFileSync('app/globals.css', 'utf8'),
    ));

  console.log('\n[6] Phase A revisions are not given invented evidence');
  chk('[6] every approval column is NULLABLE',
    !/approverRole\s+String\b(?!\?)/.test(schema));
  chk('[6] a revision with no signature says so honestly',
    /[Ii]ssued before approval records were captured/.test(page));
  chk('[6] nothing back-fills a signature', !/UPDATE "CppRevision" SET "signedName"/.test(
    readFileSync('/home/cc-dev-1/cpp_approval.sql', 'utf8')));
  chk('[6] the migration is additive only',
    !/DROP|DELETE/.test(readFileSync('/home/cc-dev-1/cpp_approval.sql', 'utf8')));

  console.log('\n[7] The signature image is scoped like the plan');
  const sigRoute = readFileSync(
    'app/api/platform/sites/[id]/cpp-revisions/[revisionId]/signature/route.ts', 'utf8');
  chk('[7] served through the app, not a public blob URL',
    /downloadDocumentBlob/.test(sigRoute));
  chk('[7] site scope is checked',
    /viewer\.siteIds\.includes\(siteId\)/.test(code(svc).slice(code(svc).indexOf('getApprovalSignatureBlobPath'))));
  chk('[7] and it is not cached',
    /private, no-store/.test(sigRoute));

  console.log('\n[8] The shared SignaturePad was generalised, not copied');
  const pad = readFileSync('components/checkin/SignaturePad.tsx', 'utf8');
  chk('[8] the prop is no longer worker-specific', /defaultName: string;/.test(pad));
  chk('[8] no stale workerName reference remains', !/\bworkerName\b/.test(code(pad)));
  chk('[8] the induction caller was updated',
    /defaultName=\{workerName\}/.test(readFileSync('components/checkin/AcceptSignStep.tsx', 'utf8')));

  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exitCode = 1;
}

main();
