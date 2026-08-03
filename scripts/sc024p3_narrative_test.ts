/**
 * SC-024 Phase 3 — the conclusion-language guard.
 *
 * Two ways this fails, and both matter:
 *  - too broad: legitimate prose is rejected and NO pack ever gets a narrative.
 *    This domain is full of innocent words the naive pattern would trip on —
 *    "compliance records", "Daily Safe Start", "Completion certificates".
 *  - too narrow: a compliance verdict reaches a client handover document.
 *
 * So both directions are tested with realistic sentences.
 */
import {
  findConclusionLanguage,
  parseCloseOutNarrative,
} from '@/services/closeOut/closeOutNarrative';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`,
  );
  if (!ok) failures += 1;
}

/** Prose the model SHOULD be allowed to write. */
const LEGITIMATE = [
  'The pack contains 14 permit records issued between March and June 2026.',
  'This section lists the compliance certificates uploaded to the project.',
  'Compliance records for the project are included in section 6.',
  'Twelve Daily Safe Start inspections were recorded during the works.',
  'The site operated a safe system of work permit for all hot works.',
  'Records of safe working method statements are included as appendices.',
  'No records of this type were captured for this project.',
  'The project ran from 4 March 2026 to 27 June 2026 across 118 recorded shifts.',
  'Completion certificates supplied by subcontractors are attached as appendices A4 to A7.',
  'Forty-two inductions were completed, of which nine were express re-inductions.',
  'The section contains 8 audit records with a total of 23 findings recorded.',
  'Attendance records cover 26 workers across the duration of the project.',
  'Toolbox talk records were not captured in SiteComply for this project.',
  'This section reproduces the Construction Phase Plan as recorded at handover.',
];

/** Prose that must be REJECTED — verdicts, approvals, judgements. */
const FORBIDDEN = [
  'Site compliance was satisfactory throughout the project.',
  'The site was compliant with all CDM 2015 duties.',
  'The project was non-compliant in two areas.',
  'Working practices on site were unsafe during the early phase.',
  'Record keeping was inadequate for the permit process.',
  'The standard of documentation was acceptable overall.',
  'All records have been approved by the compliance team.',
  'This pack certifies that the project met its statutory obligations.',
  'The Principal Contractor signed off the project as complete and compliant.',
  'We recommend a follow-up review of the permit records.',
  'Permit control was well-managed across the project.',
  'The audit process was thorough and diligent.',
  'The project breached its permit conditions on two occasions.',
  'All regulatory requirements were met in full.',
  'Health and safety performance was robust throughout.',
];

function main() {
  console.log('== SC-024 P3 conclusion-language guard ==\n');

  console.log('[1] Legitimate domain prose must pass');
  for (const s of LEGITIMATE) {
    const hit = findConclusionLanguage(s);
    check(
      `"${s.slice(0, 62)}${s.length > 62 ? '…' : ''}"`,
      hit === null,
      hit ? `wrongly flagged ${hit.label} on "${hit.match}"` : '',
    );
  }

  console.log('\n[2] Verdicts and approvals must be rejected');
  for (const s of FORBIDDEN) {
    const hit = findConclusionLanguage(s);
    check(
      `"${s.slice(0, 62)}${s.length > 62 ? '…' : ''}"`,
      hit !== null,
      hit ? `caught: ${hit.label}` : 'NOT CAUGHT',
    );
  }

  console.log('\n[3] parseCloseOutNarrative end to end');
  const good = parseCloseOutNarrative(
    {
      headline: 'Project record for Riverside Phase 2',
      executiveSummary:
        'The pack covers works recorded between March and June 2026. It contains 8 audits and 14 permits.',
      sectionNarratives: [
        {
          sectionId: 'permits',
          narrative: 'This section lists 14 permit records.',
        },
        {
          sectionId: 'audits',
          narrative: 'Eight audits were recorded with 23 findings.',
        },
      ],
    },
    ['permits', 'audits'],
  );
  check('clean narrative accepted', good.ok);
  check(
    'both sections kept',
    good.ok && good.narrative.sectionNarratives.length === 2,
    good.ok ? `got ${good.narrative.sectionNarratives.length}` : '',
  );

  const sneaky = parseCloseOutNarrative(
    {
      headline: 'Project record for Riverside Phase 2',
      executiveSummary:
        'The pack covers works recorded between March and June 2026.',
      sectionNarratives: [
        {
          sectionId: 'permits',
          narrative: 'Permit control on this project was well-managed.',
        },
      ],
    },
    ['permits'],
  );
  check(
    'verdict buried in a section narrative is rejected',
    !sneaky.ok,
    sneaky.ok ? 'LET THROUGH' : sneaky.reason,
  );

  // A narrative for a section the viewer never included would be prose about
  // data they could not see.
  const outOfScope = parseCloseOutNarrative(
    {
      headline: 'Project record',
      executiveSummary: 'The pack covers the recorded works.',
      sectionNarratives: [
        { sectionId: 'permits', narrative: 'Fourteen permits were recorded.' },
        { sectionId: 'audits', narrative: 'Eight audits were recorded.' },
      ],
    },
    ['permits'],
  );
  check(
    'narrative for an excluded section is dropped',
    outOfScope.ok && outOfScope.narrative.sectionNarratives.length === 1,
    outOfScope.ok
      ? `kept ${outOfScope.narrative.sectionNarratives.map((s) => s.sectionId).join(',')}`
      : outOfScope.reason,
  );

  const empty = parseCloseOutNarrative(
    { headline: '', executiveSummary: '' },
    [],
  );
  check('empty narrative rejected', !empty.ok);

  const notJson = parseCloseOutNarrative('not json at all', []);
  check('non-JSON rejected', !notJson.ok);

  console.log(
    `\n== ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`} ==`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
