import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';

export const metadata = {
  title: 'Privacy notice — SiteComply',
};

/**
 * UK GDPR / Data Protection Act 2018 privacy notice.
 *
 * A concise, plain-English notice covering what personal data SiteComply
 * processes for site compliance, the lawful bases, retention, sharing and the
 * worker's rights (including erasure). Written to be readable on a phone.
 */
export default function PrivacyPage() {
  return (
    <AppShell>
      <article className="space-y-6 py-2">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-ink">Privacy notice</h1>
          <p className="text-sm text-ink-subtle">
            How SiteComply handles your personal data, in line with the UK GDPR
            and the Data Protection Act 2018.
          </p>
        </header>

        <Section title="Who is responsible for your data">
          <p>
            The construction site operator (the principal contractor or their
            appointed duty holder under CDM 2015) is the data controller for
            your check-in. SiteComply provides the software that records it on
            their behalf.
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc space-y-1 pl-5">
            <li>Your name and the company you work for.</li>
            <li>Your mobile number (used to verify it’s you by SMS code).</li>
            <li>
              Optionally, your CSCS card number, type and expiry where you
              choose to provide them.
            </li>
            <li>
              Your answers to the site induction and compliance checklist, and
              the date and time you check in and out.
            </li>
          </ul>
          <p>
            We collect only what is needed to run a safe, compliant site. We do
            not use your details for marketing.
          </p>
        </Section>

        <Section title="Why we can use it (lawful bases)">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Legal obligation</strong> — to meet health &amp; safety
              and CDM 2015 duties, including knowing who is on site in an
              emergency.
            </li>
            <li>
              <strong>Consent</strong> — which you give at check-in, and can
              withdraw by asking the site administrator.
            </li>
          </ul>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep your check-in records only as long as needed for site safety
            and compliance, and to meet the operator’s legal record-keeping
            duties. After that they are deleted or anonymised.
          </p>
        </Section>

        <Section title="Who we share it with">
          <p>
            Your details are visible to the site’s authorised administrators. We
            use a UK/EU SMS provider to send your verification code. We do not
            sell your data.
          </p>
        </Section>

        <Section title="Your rights">
          <p>You have the right to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>ask what personal data we hold about you and get a copy;</li>
            <li>have inaccurate details corrected;</li>
            <li>
              have your personal data erased (we may keep an anonymised record
              where we must retain proof of a safe induction);
            </li>
            <li>withdraw your consent.</li>
          </ul>
          <p>
            To exercise any of these, speak to the site administrator, who can
            access or erase your personal data from the SiteComply dashboard.
            You can also complain to the Information Commissioner’s Office (ICO)
            at <span className="font-medium text-ink">ico.org.uk</span>.
          </p>
        </Section>

        <div className="pt-2">
          <Link href="/" className="text-sm font-semibold text-brand-700">
            ← Back to SiteComply
          </Link>
        </div>
      </article>
    </AppShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 text-sm text-ink-muted">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
