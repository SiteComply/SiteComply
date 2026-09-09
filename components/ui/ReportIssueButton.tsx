'use client';

import { useEffect, useState } from 'react';
import { ReportIssueDialog, type ReportContext } from '@/components/ui/ReportIssueDialog';

const COACH_PREFIX = 'sc.report.coach.';

/**
 * The one entry point to issue reporting, placed top-right of each shell's top
 * row so it is above the fold on every page. Pages average 1.1–2.1 screens and
 * reach 2.9, so a footer action would have been below the fold nearly everywhere.
 *
 * THE LABEL IS HIDDEN ONLY BELOW 375px, not below `sm`. Measured against the
 * live headers with the real control: below 375px a labelled button clips the
 * portal badge, so icon-only is an edge case rather than the mobile default.
 * The icon-only variant is 44px rather than the app’s 52px `touch-target`,
 * because those extra 8px were themselves enough to clip the badge at 320px —
 * 44px is still at the accessibility floor.
 *
 * Making the icon understood without a visible label takes four layers, because
 * `title` is not one of them on a phone — TOOLTIPS NEED HOVER, and the widths
 * that hide the label are exactly the ones with no pointer:
 *   1. the visible label, wherever it fits (375px and up);
 *   2. `aria-label`, at every width, carrying the full phrase;
 *   3. a one-time coach mark, which is the only layer that teaches a sighted
 *      touch user below 375px what the icon means;
 *   4. `title`, for desktop mouse users, as a fourth layer and not the mechanism.
 */
export function ReportIssueButton({
  portal,
  canBeContacted,
  activeSiteId,
  activeSiteName,
}: {
  portal: 'PLATFORM' | 'ADMIN' | 'WORKER';
  canBeContacted: boolean;
  activeSiteId?: string | null;
  activeSiteName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<ReportContext | null>(null);
  const [coach, setCoach] = useState(false);

  // Shown once per portal per device. localStorage deliberately, not the
  // database: it is a device preference, and giving it a write path would mean
  // a request on every page load and a row about someone's dismissals.
  useEffect(() => {
    try {
      if (!localStorage.getItem(COACH_PREFIX + portal)) setCoach(true);
    } catch {
      // Private browsing or storage disabled — no coach mark, no error.
    }
  }, [portal]);

  function dismissCoach() {
    setCoach(false);
    try {
      localStorage.setItem(COACH_PREFIX + portal, '1');
    } catch {
      /* nothing to do */
    }
  }

  function openDialog() {
    dismissCoach();
    // Captured at open time, from the page the reporter is actually looking at.
    setContext({
      pagePath: window.location.pathname,
      pageTitle: document.title || null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      activeSiteId: activeSiteId ?? null,
      activeSiteName: activeSiteName ?? null,
    });
    setOpen(true);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openDialog}
        aria-label="Report an issue or give feedback"
        aria-haspopup="dialog"
        title="Report an issue or give feedback"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-line text-xs font-semibold text-ink-muted hover:bg-surface-sunken min-[375px]:h-[3.25rem] min-[375px]:w-auto min-[375px]:px-2.5"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
          strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden="true">
          {/*
            The same flag as the "Bug or problem" chip, so the trigger and the
            workflow it opens share one visual language. (An earlier version
            argued for a speech bubble here on the grounds that a flag suggests
            reporting CONTENT; in review the flag read more clearly as "raise
            this", which is what the control does.)
          */}
          <path d="M5 21V4M5 5h13l-2.6 4L18 13H5" />
        </svg>
        <span className="hidden min-[375px]:inline">Feedback</span>
      </button>

      {coach && !open && (
        <div
          role="note"
          className="absolute left-1/2 top-[calc(100%+8px)] z-40 w-60 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-xl bg-ink p-3 text-left shadow-card"
        >
          <span
            aria-hidden="true"
            className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-ink"
          />
          <p className="text-xs font-bold text-white">Spotted a problem?</p>
          <p className="mt-1 text-[11.5px] leading-snug text-white/80">
            Tap here to report an issue or send feedback about this page.
          </p>
          <div className="mt-2 text-right">
            <button
              type="button"
              onClick={dismissCoach}
              className="text-[11.5px] font-bold text-brand-200 hover:text-white"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <ReportIssueDialog
        open={open}
        onClose={() => setOpen(false)}
        context={context}
        canBeContacted={canBeContacted}
        portal={portal}
      />
    </div>
  );
}
