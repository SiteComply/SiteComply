import { cn } from '@/lib/cn';
import { RowLink } from '@/components/platform/RowLink';
import { Panel } from '@/components/platform/Panel';
import { pct } from '@/services/reports/complianceReport';

/**
 * Shared presentational building blocks for the Site Details tabs (Overview /
 * Workers / Worker Experience / Compliance / Documents). Extracted verbatim from
 * the former single-page Site Details so every tab renders identically — this is
 * a UX refactor only, with no behaviour change.
 */

/**
 * UX REFRESH PHASE 2 — `Section` is now the shared `Panel` primitive.
 *
 * It kept its own spelling of a panel (`p-5`, uppercase muted heading) while the
 * benchmark screen the brief points at used `p-4` and a plain dark heading. Two
 * treatments for the same idea, so panels in the site tabs and panels in Audit
 * Scoring read as belonging to different products. They are now one definition.
 *
 * The signature is unchanged, so all five site tabs adopt it without edits;
 * `actions` is newly available for the phases that will use it.
 */
export function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Panel title={title} actions={actions}>
      {children}
    </Panel>
  );
}

/**
 * One document-compliance row (Expired / Expiring soon): label + a count badge
 * that only takes its status colour when the count is non-zero. Whole row links
 * to the filtered list.
 */
export function DocIssueRow({
  href,
  label,
  count,
  badge,
}: {
  href: string;
  label: string;
  count: number;
  badge: string;
}) {
  return (
    <li>
      <RowLink
        href={href}
        trailing={
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
              count > 0 ? badge : 'bg-surface-sunken text-ink-subtle',
            )}
          >
            {count}
          </span>
        }
      >
        <span className="whitespace-nowrap text-sm font-medium text-ink">
          {label}
        </span>
      </RowLink>
    </li>
  );
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <div className="text-lg font-bold tabular-nums text-ink">{value}</div>
      <div className="text-xs text-ink-subtle">{label}</div>
    </div>
  );
}

export function Rate({
  label,
  n,
  total,
}: {
  label: string;
  n: number;
  total: number;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-ink">
        {pct(n, total)}%
      </dd>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-subtle">{children}</p>;
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'good' | 'warn' | 'muted';
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        tone === 'good' && 'bg-safe-50 text-safe-700',
        tone === 'warn' && 'bg-hivis-400/25 text-ink',
        tone === 'muted' &&
          'border border-line bg-surface-sunken text-ink-muted',
      )}
    >
      {label}
    </span>
  );
}
