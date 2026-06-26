import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { LogoMark } from '@/components/brand/Logo';

/**
 * SiteComply landing / entry screen.
 *
 * The two journeys diverge here: workers head into the SMS-verified induction
 * flow; admins sign in with Microsoft. Both routes are placeholders in Stage 1
 * and are implemented in later stages.
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
            I&apos;m a worker — start check-in
          </Button>
        </Link>
        <Link href="/admin" className="block">
          <Button size="lg" variant="secondary" fullWidth>
            Admin sign-in (Microsoft)
          </Button>
        </Link>
      </div>

      <ul className="mt-8 grid gap-3">
        {[
          {
            title: 'Built for site',
            body: 'Large buttons, high contrast and minimal typing — usable outdoors, with gloves, on poor signal.',
          },
          {
            title: 'UK compliance ready',
            body: 'CSCS, RAMS, CDM 2015 and HSE guidance, with a UK GDPR consent step built in.',
          },
          {
            title: 'Real-time visibility',
            body: 'Admins see who is on site right now and can report on every check-in.',
          },
        ].map((feature) => (
          <li
            key={feature.title}
            className="rounded-xl border border-line bg-surface p-4 shadow-card"
          >
            <h2 className="text-sm font-semibold text-ink">{feature.title}</h2>
            <p className="mt-1 text-sm text-ink-subtle">{feature.body}</p>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
