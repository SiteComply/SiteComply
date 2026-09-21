'use client';

import { Button } from '@/components/ui/Button';

/**
 * Opens the browser print dialog (print-to-PDF). Hidden in print.
 *
 * The defaults are the ORIGINAL ones — a full-width secondary button — because
 * the close-out pack and the client share page both rely on them and neither
 * was part of this change. The CPP passes quieter props: there, printing is a
 * secondary convenience beside a real downloadable document, not the way the
 * plan is produced.
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
