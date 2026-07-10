'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import {
  BrandedErrorScreen,
  AlertTriangleIcon,
} from '@/components/errors/BrandedErrorScreen';

/**
 * General application error boundary for unexpected failures anywhere below the
 * root layout. Presents a calm, branded recovery screen — no stack trace, message
 * or other technical detail is shown to the user.
 *
 * Developer diagnostics are preserved: Next.js already logs the full server-side
 * stack (keyed by `error.digest`), and the effect below mirrors the error to the
 * browser console. The digest is a non-sensitive hash, surfaced to the user only
 * as a reference code they can quote to support.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[SiteComply] Unhandled application error:', error);
  }, [error]);

  return (
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
  );
}
