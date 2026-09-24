'use client';

import { Button } from '@/components/ui/Button';

/**
 * Opens the browser print dialog (print-to-PDF). Hidden in print.
 *
 * ONE USE LEFT, AND IT IS THE LEGITIMATE ONE: the construction phase plan's
 * DRAFT view, where printing is a quiet convenience beside a real downloadable
 * document rather than the way the plan is produced.
 *
 * Everything else that used this now has a server-rendered PDF — the permit,
 * the induction record, the issued CPP revision and the close-out pack. Before
 * adding a third caller, ask whether the thing being printed is a document. If
 * it is, it needs its own PDF: a browser print stamps the reader's own page
 * title, URL and timestamp onto it, and no stylesheet can reach them.
 */
export function PrintButton({
  label = 'Print / download',
  variant = 'secondary',
  fullWidth = true,
}: {
  label?: string;
  variant?: 'secondary' | 'ghost';
  fullWidth?: boolean;
}) {
  return (
    <div className="print:hidden">
      <Button
        variant={variant}
        size="md"
        fullWidth={fullWidth}
        onClick={() => window.print()}
      >
        {label}
      </Button>
    </div>
  );
}
