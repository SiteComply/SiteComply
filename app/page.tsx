import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/brand/Logo';

/**
 * SiteComply landing / entry screen.
 *
 * The journeys diverge here: workers head into the SMS-verified induction flow,
 * platform users sign in to their SiteComply account (email or mobile), and
 * admins sign in with Microsoft. Routes are built out across later stages.
 */
export default function HomePage() {
  return (
    <AppShell>
      <section className="flex flex-col items-center gap-6 py-8 text-center">
        <LogoMark size={72} />
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight text-ink">
            Site induction &amp; check-in, sorted in under two minutes
          </h1>
          <p className="mx-auto max-w-md text-base text-ink-muted">
            Replace paper sign-in sheets with a fast, digital site induction.
            Confirm your health &amp; safety checks, PPE and site rules, then
            check in — all from your phone.
          </p>
        </div>
      </section>

      <div className="grid gap-3">
        <Link href="/check-in" className="block">
          <Button size="lg" fullWidth>
            I&apos;m an operative — start check-in
          </Button>
        </Link>
        <Link href="/platform" className="block">
          <Button size="lg" variant="brand" fullWidth>
            Platform Login
          </Button>
        </Link>
        <Link href="/admin" className="block">
          <Button size="lg" variant="secondary" fullWidth>
            Admin sign-in
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
