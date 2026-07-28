'use client';

import { Button } from '@/components/ui/Button';

/** A button that opens the browser print dialog (print-to-PDF). Hidden in print. */
export function PrintButton({
  label = 'Print / download',
}: {
  label?: string;
}) {
  return (
    <div className="print:hidden">
      <Button variant="secondary" fullWidth onClick={() => window.print()}>
        {label}
      </Button>
    </div>
  );
}
