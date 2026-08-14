/**
 * Induction record presentation check (LOCAL fixtures, removed at the end).
 * Asserts against getWorkerInductionRecord — the service the page renders from.
 */
import { PrismaClient } from '@prisma/client';
import { answerQuestion, completeAttempt } from '../services/knowledgeChecks/attemptService';
import { getWorkerInductionRecord } from '../services/inductionSignature/inductionRecordService';
const p = new PrismaClient();

let fails = 0;
const chk = (t: string, ok: boolean, d = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t}${d ? ` — ${d}` : ''}`);
  if (!ok) fails++;
};
const opts = (n: string) => [
  { id: `${n}-a`, text: 'A' }, { id: `${n}-b`, text: 'B' },
  { id: `${n}-c`, text: 'C' }, { id: `${n}-d`, text: 'D' },
];

/** What the page renders for the two rows, mirrored from page.tsx. */
function render(kc: any, passedFlag: boolean, skipped: boolean) {
  const primary = kc?.passed
    ? `Passed (${kc.total}/${kc.total})`
    : passedFlag ? 'Passed' : skipped ? 'Not required' : '—';
  const secondary =
    kc && kc.firstTryCorrect < kc.total
      ? `First-time score: ${kc.firstTryPct}% (${kc.firstTryCorrect}/${kc.total})`
      : null;
  return { primary, secondary };
}

async function scenario(name: string, wrongFirst: number, complete: boolean) {
  const site = (await p.jobSite.findFirst({ where: { status: 'ACTIVE' } }))!;
  const worker = (await p.worker.findFirst())!;
  const bank = await p.inductionQuestionBank.create({
    data: { jobSiteId: site.id, checklistVersion: 1, contentHash: `kcv-${Date.now()}-${Math.round(performance.now())}`,
            status: 'READY', provider: 'mock', approvedAt: new Date(), approvedByName: 'KC Verify' },
  });
  const qs = [];
  for (let i = 1; i <= 3; i++) {
    qs.push(await p.inductionQuestion.create({
      data: { bankId: bank.id, order: i, prompt: `Q${i}`, options: opts(`q${i}`), correctOptionId: `q${i}-a` },
    }));
  }
  const sub = await p.submission.create({
    data: { workerId: worker.id, jobSiteId: site.id, checklistVersion: 1, answers: {},
            knowledgeCheckPassed: complete, knowledgeCheckSkipped: false },
  });
  const attempt = await p.knowledgeCheckAttempt.create({
    data: { workerId: worker.id, jobSiteId: site.id, bankId: bank.id, checklistVersion: 1,
            questionIds: qs.map((q) => q.id), answers: {}, questionCount: 3,
            status: 'IN_PROGRESS', submissionId: sub.id },
  });
  let i = 0;
  for (const q of qs) {
    if (i < wrongFirst) await answerQuestion(worker.id, attempt.id, q.id, `q${i + 1}-b`);
    if (complete || i < 2) await answerQuestion(worker.id, attempt.id, q.id, `q${i + 1}-a`);
    i++;
  }
  if (complete) await completeAttempt(worker.id, attempt.id);

  const rec = await getWorkerInductionRecord(worker.id, sub.id);
  const row = await p.knowledgeCheckAttempt.findUnique({ where: { id: attempt.id } });
  const out = render(rec!.knowledgeCheck, rec!.knowledgeCheckPassed, rec!.knowledgeCheckSkipped);
  console.log(`\n=== ${name} ===`);
  console.log(`  stored: status=${row?.status} questionCount=${row?.questionCount} incorrectFirstTry=${row?.incorrectFirstTryCount}`);
  console.log(`  Knowledge check : ${out.primary}`);
  console.log(`  ${out.secondary ? out.secondary : '(no secondary row)'}`);

  const cleanup = async () => {
    await p.knowledgeCheckAttempt.deleteMany({ where: { id: attempt.id } });
    await p.inductionQuestion.deleteMany({ where: { bankId: bank.id } });
    await p.inductionQuestionBank.deleteMany({ where: { id: bank.id } });
    await p.submission.deleteMany({ where: { id: sub.id } });
  };
  return { out, row, rec, cleanup };
}

(async () => {
  // The reported case: 2 of 3 wrong first, all eventually correct.
  const a = await scenario('REPORTED CASE — 2 of 3 wrong first, all corrected', 2, true);
  chk('stored data unchanged (incorrectFirstTryCount still 2)', a.row?.incorrectFirstTryCount === 2, String(a.row?.incorrectFirstTryCount));
  chk('stored status still PASSED', a.row?.status === 'PASSED');
  chk('primary row shows the OUTCOME', a.out.primary === 'Passed (3/3)', a.out.primary);
  chk('primary row does NOT show 33%', !/33%|1\/3/.test(a.out.primary), a.out.primary);
  chk('first-time metric retained, clearly labelled', a.out.secondary === 'First-time score: 33% (1/3)', String(a.out.secondary));
  await a.cleanup();

  // Clean pass: nothing wrong first time.
  const b = await scenario('CLEAN PASS — all correct first time', 0, true);
  chk('primary row shows Passed (3/3)', b.out.primary === 'Passed (3/3)', b.out.primary);
  chk('no redundant secondary row on a first-time pass', b.out.secondary === null, String(b.out.secondary));
  await b.cleanup();

  // Incomplete attempt must never read as a pass.
  const c = await scenario('INCOMPLETE — attempt still in progress', 0, false);
  chk('an IN_PROGRESS attempt does not render as passed', !/Passed \(/.test(c.out.primary), c.out.primary);
  await c.cleanup();

  console.log(`\n== ${fails === 0 ? 'ALL PASSED' : `${fails} FAILED`} ==`);
  await p.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
})();
