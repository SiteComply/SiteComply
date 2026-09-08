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

  useEffect(() => {
    if (!open) return;

    returnTo.current = document.activeElement as HTMLElement | null;
    // Focus the first control inside the dialog, or the card itself if it has
    // none, so a screen reader starts inside the dialog rather than behind it.
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? cardRef.current)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        onClose();
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
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnTo.current?.focus?.();
    };
  }, [open, busy, onClose]);

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
