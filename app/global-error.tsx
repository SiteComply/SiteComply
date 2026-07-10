'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import {
  BrandedErrorScreen,
  AlertTriangleIcon,
} from '@/components/errors/BrandedErrorScreen';
// The root layout has failed, so its stylesheet import no longer applies here —
// re-import the design tokens and base styles this boundary renders with.
import './globals.css';

/**
 * Last-resort boundary for errors thrown by the root layout itself. It replaces
 * the entire document, so it must supply its own <html>/<body>. Kept intentionally
 * minimal and self-contained; the full error is logged for developers while the
 * user sees only a branded, reassuring recovery screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[SiteComply] Critical application error:', error);
  }, [error]);

  return (
    <html lang="en-GB">
      <body>
        <BrandedErrorScreen
          tone="danger"
          eyebrow="Something went wrong"
          title="We’ve hit an unexpected problem"
          description="This one’s on us, not you. The issue has been logged for our team. You can try again, or head back to a safe place."
          icon={<AlertTriangleIcon />}
          reference={error.digest}
        >
          <Button size="lg" variant="brand" fullWidth onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/" className="block">
            <Button size="lg" variant="secondary" fullWidth>
              Back to home
            </Button>
          </Link>
        </BrandedErrorScreen>
      </body>
    </html>
  );
}
