'use client';

import { useState } from 'react';
import { ReportIssueDialog, type ReportContext } from '@/components/ui/ReportIssueDialog';

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
 * Making the icon understood without a visible label rests on three layers:
 *   1. the visible label, wherever it fits (375px and up);
 *   2. `aria-label`, at every width, carrying the full phrase;
 *   3. `title`, for desktop mouse users — not the mechanism, because TOOLTIPS
 *      NEED HOVER and the widths that hide the label are exactly the ones with
 *      no pointer.
 *
 * THERE WAS A FOURTH: a one-time coach mark ("Spotted a problem?"), a dark
 * panel under the button on first visit per portal per device. Removed
 * deliberately — every user saw it once per portal to be told what a control
 * they had not asked about does, and that interruption was judged to cost more
 * than it taught.
 *
 * KNOWN AND ACCEPTED CONSEQUENCE: below 375px the label is hidden and `title`
 * needs a pointer, so for a SIGHTED TOUCH user at those widths the icon is now
 * unexplained. `aria-label` still covers screen readers at every width. If that
 * gap ever needs closing, close it by showing the LABEL at all widths — which
 * means solving the portal-badge clipping at 320px that caused it to be hidden
 * in the first place — not by bringing the popup back.
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

  function openDialog() {
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
