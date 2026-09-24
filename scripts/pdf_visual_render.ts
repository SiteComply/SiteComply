/**
 * Render every SiteComply document from a fixed fixture, for visual comparison.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * Migrating three documents onto a shared kit is a refactor whose only honest
 * success criterion is "nothing looks different". Assertions cannot see that: a
 * footer that silently stops printing, a heading that loses its weight or a
 * column that shifts four points all pass every test in the suite.
 *
 * So this renders each document from a deterministic fixture into a directory.
 * Run it before a change and after, turn both into images, and compare the
 * pixels. Every one of the engine's traps shows up immediately.
 *
 *   ./scripts/pdf_visual_render.sh /tmp/before
 *   …make the change…
 *   ./scripts/pdf_visual_render.sh /tmp/after
 *   ./scripts/pdf_visual_diff.sh /tmp/before /tmp/after
 *
 * The fixtures are deliberately LONG ENOUGH TO PAGINATE. A one-page render
 * proves nothing about running heads, footers or page numbers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { renderPermitRecordPdf } from '../services/permitRecord/renderPermitRecord';
import type { PermitRecordData } from '../services/permitRecord/permitRecordData';
import { renderInductionRecordPdf } from '../services/inductionRecord/renderInductionRecord';
import type { InductionRecordData } from '../services/inductionRecord/inductionRecordData';
import { renderCppPdf } from '../services/sites/cppPdf/renderCppPdf';
import type { CppPdfData } from '../services/sites/cppPdf/cppPdfData';
import { renderCloseOutPackPdf } from '../services/closeOutPdf/renderCloseOutPack';
import type { CloseOutPackPdfData } from '../services/closeOutPdf/CloseOutPackPdf';

const LOGO = existsSync('public/sitecomply-logo.png')
  ? readFileSync('public/sitecomply-logo.png')
  : null;
const BRAND = {
  name: 'Parry ST Electrical Ltd',
  tagline: 'Electrical contractors',
  primaryColor: '#00AEEF',
  logo: LOGO ? { bytes: LOGO, contentType: 'image/png' } : null,
};

const AT = new Date('2026-09-24T15:10:00Z');

function permit(): PermitRecordData {
  return {
    reference: 'HW-260924-004',
    generatedAt: AT,
    company: BRAND,
    status: {
      value: 'APPROVED', label: 'Approved', authorised: true,
      statement: 'This work is authorised until the time shown below.',
    },
    work: {
      permitTypeName: 'Hot Works',
      activity: 'Soldering copper pipework to the new riser on the second floor, using a butane torch.',
      location: 'Second floor, east riser cupboard',
      proposedStart: new Date('2026-09-24T08:00:00Z'),
      proposedFinish: new Date('2026-09-24T16:00:00Z'),
    },
    validity: { from: new Date('2026-09-24T08:00:00Z'), until: new Date('2026-09-24T16:00:00Z') },
    operative: { name: 'Ryan Schubert', company: 'Caledonian Groundworks Ltd' },
    site: {
      name: 'Dorchester Road — Rewire', jobReference: 'DR-2026-014',
      address: ['72 Dorchester Road', 'Cannock', 'WS11 1AA'],
      principalContractor: 'RS Electrical Ltd',
    },
    conditions: [
      { label: 'Has the work area been cleared of combustible material within 10 metres?', value: 'Yes', negative: false },
      { label: 'Is a suitable fire extinguisher present at the work position?', value: 'Yes', negative: false },
      { label: 'Has the fire alarm been isolated in this zone?', value: 'No', negative: true },
      { label: 'Who is carrying out the fire watch, and for how long after the work finishes?', value: 'M. Marshal — 60 minutes after completion', negative: false },
    ],
    authorisation: {
      submittedBy: 'Ryan Schubert', submittedAt: new Date('2026-09-23T16:12:00Z'),
      reviewedBy: 'Sam Manager', reviewedAt: new Date('2026-09-23T17:02:00Z'),
      approvedBy: 'Dee Director', approvedAt: new Date('2026-09-23T17:40:00Z'),
      rejectedBy: null, rejectedAt: null, rejectionReason: null,
      cancelledAt: null, closedBy: null, closedAt: null,
    },
    history: Array.from({ length: 6 }, (_, i) => ({
      at: new Date(Date.UTC(2026, 8, 23, 16 + i, 12)),
      what: i === 0 ? 'Requested' : i === 5 ? 'Approved' : 'Comment',
      who: i % 2 ? 'Sam Manager' : 'Ryan Schubert',
      note: i % 2 ? 'Confirm the fire watch cover before I approve this.' : null,
    })),
  };
}

function inductionRecord(): InductionRecordData {
  return {
    documentReference: 'SC-IND-DR2026014-260908-A1B2C3',
    checkInReference: 'CI-A1B2C3',
    generatedAt: AT,
    company: BRAND,
    operative: {
      name: 'Ryan Schubert',
      company: 'Caledonian Groundworks Ltd',
      cscs: 'CSCS •••• 0934 · verified 8 September 2026',
    },
    site: {
      name: 'Dorchester Road — Rewire',
      jobReference: 'DR-2026-014',
      address: ['72 Dorchester Road', 'Cannock', 'WS11 1AA'],
      principalContractor: 'RS Electrical Ltd',
    },
    induction: {
      completedAt: new Date('2026-09-08T07:42:00Z'),
      version: 4,
      acknowledgements: Array.from({ length: 12 }, (_, i) => ({
        label: `I have read and understood item ${i + 1}: the site rules, the emergency arrangements and the permit requirements that apply to my work.`,
        confirmed: true,
      })),
      ppeCount: 6,
      ppeConfirmed: true,
      siteRuleCount: 10,
      gdprConsent: true,
      knowledgeCheck: 'passed',
      knowledgeCheckCount: 6,
      carriedForwardFrom: null,
    },
    declaration: {
      accepted: true,
      text: 'I confirm that I have received the site induction and will follow the rules and arrangements described in it.',
      signedName: 'Ryan Schubert',
      signedAt: new Date('2026-09-08T07:43:00Z'),
      signatureImage: null,
    },
  };
}

function cpp(): CppPdfData {
  return {
    site: {
      id: 'site-1',
      name: 'Dorchester Road',
      jobReference: '2417-DR',
      address: '14–22 Dorchester Road, Weymouth, DT4 7JY',
      principalContractor: 'Hartley Construction Ltd',
    },
    sections: Array.from({ length: 20 }, (_, i) => ({
      key: `sec-${i}`,
      title: `Section ${i + 1} — arrangements and controls`,
      stepKey: null,
      manageHref: null,
      entries: [
        { label: 'Arrangement', value: `Control measure ${i + 1}. ` + 'Refurbishment of a four-storey residential block including re-roofing, window replacement and external repairs. '.repeat(3) },
        { label: 'Responsible', value: 'Site Manager' },
      ],
      items: i % 3 === 0 ? [{ label: `Listed item ${i}`, detail: 'Reviewed at induction' }] : [],
      gatesCompletion: i < 10,
      status: i === 4 ? 'PARTIAL' : 'COMPLETE',
      missing: i === 4 ? ['Emergency procedures'] : [],
    })) as unknown as CppPdfData['sections'],
    drawings: [{ id: 'd1', title: 'Site layout', fileName: 'layout-rev-b.pdf' }],
    revision: {
      version: 2,
      status: 'ISSUED',
      issuedAt: new Date('2026-09-18T09:30:00Z'),
      issuedByName: 'R. Hartley',
      preparedByName: 'M. Okonkwo',
      preparedAt: new Date('2026-09-17T14:00:00Z'),
      signedName: 'Robert Hartley',
      approverRole: 'PRINCIPAL_CONTRACTOR',
      declarationText: 'I confirm this plan is suitable and sufficient.',
      signatureImage: null,
      supersededAt: null,
    },
    logo: LOGO,
  };
}

function pack(): CloseOutPackPdfData {
  return {
    brand: BRAND,
    title: 'Dorchester Road — Project Close-Out Pack',
    version: 2,
    preparedFor: 'Cannock Housing Association',
    generatedByName: 'Dee Director',
    generatedAt: AT,
    site: { name: 'Dorchester Road — Rewire', jobReference: 'DR-2026-014', address: '72 Dorchester Road, Cannock, WS11 1AA' },
    executiveSummary: 'The project comprised a full rewire over eleven weeks. Forty-one operatives were inducted and nine permits issued.',
    sections: [
      { id: 'overview', label: 'Project overview',
        facts: [
          { label: 'Client', value: 'Cannock Housing Association' },
          { label: 'Principal contractor', value: 'RS Electrical Ltd' },
        ],
        narrative: 'The works were carried out under a single construction phase plan.' },
      { id: 'inductions', label: 'Inductions and competency',
        rows: Array.from({ length: 14 }, (_, i) => [
          { label: 'Operative', value: `Operative ${i + 1}` },
          { label: 'Company', value: 'RS Electrical Ltd' },
          { label: 'Inducted', value: '08/07/2026' },
          { label: 'Card', value: 'CSCS · verified' },
        ]),
        cappedNote: 'Showing the first 14 of 41 inductions.' },
      { id: 'empty', label: 'Temporary works' },
    ],
    appendices: [
      { ref: 'A1', title: 'Electrical installation certificate', source: 'Documents register' },
      { ref: 'A2', title: 'Rewire RAMS (rev C)', source: 'RAMS' },
    ],
    appendicesIncluded: true,
  };
}

(async () => {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: pdf_visual_render.sh <output directory>');
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });

  const jobs: [string, () => Promise<Buffer>][] = [
    ['permit', () => renderPermitRecordPdf(permit())],
    ['induction-record', () => renderInductionRecordPdf(inductionRecord())],
    ['cpp', () => renderCppPdf(cpp())],
    ['close-out-pack', () => renderCloseOutPackPdf(pack())],
  ];

  for (const [name, run] of jobs) {
    const bytes = await run();
    writeFileSync(join(out, `${name}.pdf`), bytes);
    console.log(`  ${name.padEnd(18)} ${String(bytes.length).padStart(8)} bytes`);
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
