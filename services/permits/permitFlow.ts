/**
 * Client-safe types + helpers for the permit request form (SC-009). Shared by the
 * worker request UI and the server service so the question model stays generic —
 * new permit types / question types are pure data (see permitCatalogSeed).
 * No Prisma/server imports.
 */

import type { PermitQuestionTypeValue } from '@/services/permits/permitConstants';

export interface PermitQuestion {
  id: string;
  label: string;
  helpText: string | null;
  type: PermitQuestionTypeValue;
  required: boolean;
}

/** A worker's raw answer to one question. */
export type PermitAnswerValue = boolean | 'yes' | 'no' | string;

export type PermitAnswers = Record<string, PermitAnswerValue>;

/**
 * A question answered by a worker, snapshotted onto the permit at submission so
 * the record is self-contained and survives catalogue changes.
 */
export interface AnsweredQuestion {
  questionId: string;
  label: string;
  type: PermitQuestionTypeValue;
  value: PermitAnswerValue;
}

/** Whether a single answer satisfies its (required) question. */
export function isAnswerComplete(
  question: PermitQuestion,
  answers: PermitAnswers,
): boolean {
  if (!question.required) return true;
  const v = answers[question.id];
  switch (question.type) {
    case 'ACKNOWLEDGEMENT':
      return v === true;
    case 'YES_NO':
      return v === 'yes' || v === 'no';
    case 'TEXT':
    case 'DATE':
      return typeof v === 'string' && v.trim() !== '';
    default:
      return false;
  }
}

/** True when every required question is answered. */
export function areAnswersComplete(
  questions: PermitQuestion[],
  answers: PermitAnswers,
): boolean {
  return questions.every((q) => isAnswerComplete(q, answers));
}

/** Human-readable rendering of a stored answer value. */
export function formatAnswer(a: AnsweredQuestion): string {
  if (a.type === 'ACKNOWLEDGEMENT')
    return a.value === true ? 'Confirmed' : 'Not confirmed';
  if (a.type === 'YES_NO')
    return a.value === 'yes' ? 'Yes' : a.value === 'no' ? 'No' : '—';
  return typeof a.value === 'string' && a.value.trim() !== '' ? a.value : '—';
}
