'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The modal shell every dialog shares: dimmed backdrop, centred card, Escape to
 * close, backdrop click to close, and focus moved in on open and returned to the
 * trigger on close.
 *
 * Extracted from ConfirmDialog, which had all of this inline for one caller.
 * Focus RETURN is the part that was missing there and matters most for keyboard
 * users: without it, closing a dialog drops focus to the top of the document and
 * the user has to tab back through the whole page to where they were.
 */
export function Dialog({
  open,
  titleId,
  onClose,
  busy = false,
  children,
  className = 'max-w-md',
}: {
  open: boolean;
  /** id of the element labelling the dialog — must exist inside `children`. */
  titleId: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  /**
   * The caller's `onClose` is a new function on every one of its renders — that
   * is ordinary React, not a caller bug — so it must NEVER be a dependency of
   * the focus effect. It used to be, and the effect therefore tore down and
   * re-ran on every keystroke in the report dialog: the cleanup threw focus back
   * to the trigger, then the body moved it to the first focusable control, which
   * is the close button. Typing was impossible.
   *
   * Fixing it in the caller (memoising `onClose`) would have worked and been
   * wrong: every future caller would have to know that rule, and would silently
   * reintroduce the bug the first time one forgot. The dialog owns its own
   * correctness instead, and reads the current callbacks through a ref.
   */
  const latest = useRef({ busy, onClose });
  useEffect(() => {
    latest.current = { busy, onClose };
  });

  // Remember what to give focus back to, and give it back when the dialog goes.
  // Keyed on `open` alone so it can never fire mid-life.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    return () => {
      returnTo.current?.focus?.();
    };
  }, [open]);

  /**
   * Move focus INTO the dialog: when it opens, and again when its CONTENT is
   * replaced — the report dialog swaps its form for a success screen without
   * unmounting, and narrowing this effect to `open` alone left focus on the
   * Send button that had just disappeared, dropping it to <body>.
   *
   * `titleId` is the right key because it identifies what the dialog currently
   * IS. It is a stable string, so it cannot change on a keystroke the way a
   * callback identity does — which is the whole bug this effect was split to fix.
   */
  useEffect(() => {
    if (!open) return;

    // Prefer the first TEXT FIELD, falling back to the first focusable control
    // and then the card itself, so a screen reader always starts inside the
    // dialog rather than behind it.
    //
    // The fallback used to be the only rule, which put focus on the close button
    // — the first thing in the card. In a dialog whose purpose is typing that is
    // a trap: open it, start typing, and the first SPACE presses the focused
    // button and discards what you had written. A dialog with no text field (a
    // confirmation) is unaffected and still focuses its first control.
    const card = cardRef.current;
    const field = card?.querySelector<HTMLElement>(
      'textarea:not([disabled]), input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled])',
    );
    const focusable = card?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (field ?? focusable ?? card)?.focus();
  }, [open, titleId]);

  // Key handling is a separate effect so that changing `busy` mid-submit cannot
  // disturb focus. It reads `busy` and `onClose` through the ref, so it never
  // needs to re-subscribe either.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !latest.current.busy) {
        latest.current.onClose();
        return;
      }
      if (e.key !== 'Tab' || !cardRef.current) return;
      // Keep Tab inside the dialog. Without this a keyboard user tabs out into
      // the page behind, which is still there and still clickable.
      const items = Array.from(
        cardRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // Full-width sheet on phones, centred card from sm up. The sheet keeps
        // the submit button within reach of the thumb and above the keyboard.
        className={`w-full animate-pop-in border border-line bg-surface shadow-card outline-none max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
