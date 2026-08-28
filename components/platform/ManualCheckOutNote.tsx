import {
  manualActorLabel,
  type ManualCheckOutFields,
} from '@/services/submissions/manualCheckOut';

/**
 * BL-001 — the MANUAL marker and its attribution.
 *
 * One component so the chip, the actor and the reason read identically on the
 * check-ins rail and in worker history. Amber (`hivis`) is the tone this product
 * already uses for "needs attention" in the closure checklist — a manual close
 * is neither an error nor a clean pass, and should not borrow either colour.
 */
export function ManualCheckOutNote({ row }: { row: ManualCheckOutFields }) {
  if (!row.checkedOutManual) return null;
  return (
    <>
      <span className="ml-2 inline-flex whitespace-nowrap rounded-full bg-hivis-400/25 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-hivis-700">
        Manual
      </span>
      <span className="mt-1 block text-xs text-ink-muted">
        by {manualActorLabel(row)}
        {row.checkedOutReason ? ` — “${row.checkedOutReason}”` : ''}
      </span>
    </>
  );
}
