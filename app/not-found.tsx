import Link from 'next/link';
import type { Metadata } from 'next';
import { Button } from '@/components/ui/Button';
import {
  BrandedErrorScreen,
  SearchIcon,
} from '@/components/errors/BrandedErrorScreen';

export const metadata: Metadata = {
  title: 'Page not found — SiteComply',
};

/**
 * App-wide 404. Serves both mistyped URLs and every explicit `notFound()` in the
 * app (e.g. a check-in or worker that isn't in the viewer's scope), so the copy is
 * deliberately neutral — it never confirms whether a record exists.
 */
export default function NotFound() {
  return (
    <BrandedErrorScreen
      tone="brand"
      eyebrow="Error 404"
      title="We can’t find that page"
      description="The page you’re looking for may have been moved, renamed, or is no longer available. Let’s get you back to somewhere useful."
      icon={<SearchIcon />}
    >
      <Link href="/" className="block">
        <Button size="lg" variant="brand" fullWidth>
          Back to home
        </Button>
      </Link>
    </BrandedErrorScreen>
  );
}
