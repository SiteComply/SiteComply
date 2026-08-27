import { redirect } from 'next/navigation';
import Link from 'next/link';
import { WorkerShell } from '@/components/worker/WorkerShell';
import { WorkerPageHeader, PanelCard } from '@/components/worker/PanelCard';
import { WorkerIcon } from '@/components/worker/icons';
import { formatDateTimeUK } from '@/lib/datetime';
import { countUnreadBulletinsForWorker } from '@/services/bulletins/bulletinService';
import { requireWorkerContext } from '@/services/workerDashboard/workerDashboardService';
import { getWorkerSiteInformation } from '@/services/sites/siteInformationService';

export const dynamic = 'force-dynamic';

/**
 * Worker Dashboard → Site information (SC-008).
 *
 * A dedicated, always-accessible page (reached from the persistent worker nav)
 * showing everything a worker needs about the site they're checked into: address
 * and site manager, emergency details, welfare, working hours, site-specific
 * hazards, site rules, the site map and the latest notice. It reads live data on
 * every request (force-dynamic), so a manager's edits appear immediately with no
 * need to re-induct. Sections render only when they have content, so the page is
 * never padded with empty shells.
 */
export default async function WorkerSiteInformationPage() {
  const { worker, submission, site, panels, openCheckIns, activeSiteId } =
    await requireWorkerContext();
  if (!panels.SITE_INFORMATION) redirect('/worker/dashboard');

  const [unread, data] = await Promise.all([
    countUnreadBulletinsForWorker(site.id, worker.id),
    getWorkerSiteInformation(site.id),
  ]);

  const { emergency, info } = data ?? {
    emergency: {
      fireAssemblyPoint: null,
      firstAiderName: null,
      firstAiderNumber: null,
      firstAiderLocation: null,
      nearestHospital: null,
      emergencyNumber: null,
    },
    info: {
      workingHours: null,
      siteRules: null,
      welfareFacilities: null,
      siteHazards: null,
      emergencyProcedures: null,
      hasSiteMap: false,
      siteMapFileName: null,
      updatedByName: null,
      updatedAt: null,
    },
  };

  const directionsHref =
    data?.latitude != null && data?.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${data.latitude},${data.longitude}`
      : null;
  const firstAider = [emergency.firstAiderName, emergency.firstAiderLocation]
    .filter(Boolean)
    .join(' · ');

  return (
    <WorkerShell
      submissionId={submission.id}
      siteName={site.name}
      checkedInAt={submission.checkedInAt}
      panels={panels}
      sites={openCheckIns}
      activeSiteId={activeSiteId}
      unreadBulletins={unread}
    >
      <WorkerPageHeader
        title="Site information"
        description="Everything for the site you’re checked into. Kept up to date by your site team."
      />

      <div className="space-y-3">
        {/* Address */}
        <PanelCard icon="building" tone="brand" title="Site address">
          <p>{data?.address || `${site.name}`}</p>
          <p className="mt-1 text-ink-subtle">
            Site reference: {site.jobReference}
          </p>
          {directionsHref && (
            <ActionLink href={directionsHref} external>
              Get directions
            </ActionLink>
          )}
        </PanelCard>

        {/* Site manager */}
        {data?.siteManager?.name && (
          <PanelCard icon="user" tone="brand" title="Site manager">
            <p className="font-semibold text-ink">{data.siteManager.name}</p>
            {data.siteManager.phone && (
              <>
                <p className="text-ink-muted">{data.siteManager.phone}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionButton href={`tel:${tel(data.siteManager.phone)}`}>
                    Call
                  </ActionButton>
                  <ActionButton
                    href={`sms:${tel(data.siteManager.phone)}`}
                    variant="secondary"
                  >
                    Message
                  </ActionButton>
                </div>
              </>
            )}
          </PanelCard>
        )}

        {/* First aider */}
        {emergency.firstAiderName && (
          <PanelCard icon="firstaid" tone="safe" title="First aider">
            <p className="font-semibold text-ink">{firstAider}</p>
            {emergency.firstAiderNumber && (
              <div className="mt-2">
                <ActionButton href={`tel:${tel(emergency.firstAiderNumber)}`}>
                  Call {emergency.firstAiderNumber}
                </ActionButton>
              </div>
            )}
          </PanelCard>
        )}

        {/* Emergency contact */}
        <PanelCard
          icon="phone"
          tone="danger"
          title="Emergency contact"
          href="/worker/emergency"
          linkLabel="Emergency information"
        >
          <p className="font-semibold text-ink">
            {emergency.emergencyNumber || '999'}
          </p>
          {emergency.nearestHospital && (
            <p className="mt-1 text-ink-muted">
              Nearest A&amp;E: {emergency.nearestHospital}
            </p>
          )}
          <div className="mt-2">
            <ActionButton
              href={`tel:${tel(emergency.emergencyNumber || '999')}`}
              variant="danger"
            >
              Call emergency number
            </ActionButton>
          </div>
        </PanelCard>

        {/* Fire assembly point */}
        {emergency.fireAssemblyPoint && (
          <PanelCard icon="fire" tone="hivis" title="Fire assembly point">
            <p className="font-semibold text-ink">
              {emergency.fireAssemblyPoint}
            </p>
            <p className="mt-1">
              In the event of an alarm, proceed to the assembly point and report
              to the fire marshal.
            </p>
            {directionsHref && (
              <ActionLink href={directionsHref} external>
                Get directions
              </ActionLink>
            )}
          </PanelCard>
        )}

        {/* Emergency procedures */}
        {info.emergencyProcedures && (
          <PanelCard icon="alert" tone="danger" title="Emergency procedures">
            <LongText value={info.emergencyProcedures} />
          </PanelCard>
        )}

        {/* Welfare facilities */}
        {info.welfareFacilities && (
          <PanelCard icon="shield" tone="teal" title="Welfare facilities">
            <LongText value={info.welfareFacilities} />
          </PanelCard>
        )}

        {/* Working hours */}
        {info.workingHours && (
          <PanelCard icon="clock" tone="brand" title="Working hours">
            <LongText value={info.workingHours} />
          </PanelCard>
        )}

        {/* Site-specific hazards */}
        {info.siteHazards && (
          <PanelCard icon="alert" tone="hivis" title="Site-specific hazards">
            <LongText value={info.siteHazards} />
          </PanelCard>
        )}

        {/* Site rules */}
        {info.siteRules && (
          <PanelCard icon="clipboard" tone="brand" title="Site rules">
            <LongText value={info.siteRules} />
          </PanelCard>
        )}

        {/* Site map */}
        {info.hasSiteMap && (
          <PanelCard icon="doc" tone="brand" title="Site map">
            <p className="mb-2 text-ink-subtle">
              Tap the map to view full size.
            </p>
            <a
              href="/api/worker/site-map"
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border border-line"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/api/worker/site-map"
                alt="Site map"
                className="h-auto w-full"
              />
            </a>
          </PanelCard>
        )}

        {/* Latest site notice */}
        {data?.latestNotice && (
          <PanelCard
            icon="megaphone"
            tone="hivis"
            title="Latest site notice"
            href="/worker/bulletins"
            linkLabel="All notices"
          >
            {data.latestNotice.title && (
              <p className="font-semibold text-ink">
                {data.latestNotice.title}
              </p>
            )}
            <LongText value={data.latestNotice.body} />
            <p className="mt-2 text-xs text-ink-subtle">
              {formatDateTimeUK(data.latestNotice.publishedAt)}
            </p>
          </PanelCard>
        )}

        {/* Safety reminder (matches the REV-1 footer note) */}
        <div className="flex items-start gap-2.5 rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-muted">
          <span className="mt-0.5 shrink-0 text-brand-700">
            <WorkerIcon name="shield" className="h-4 w-4" />
          </span>
          <p>
            This information is provided for your safety. Please make yourself
            familiar with all site information and rules while on site.
          </p>
        </div>
      </div>
    </WorkerShell>
  );
}

/** Render free text with line breaks preserved (no rich text in v1). */
function LongText({ value }: { value: string }) {
  return <p className="whitespace-pre-line break-words">{value}</p>;
}

function ActionButton({
  href,
  children,
  variant = 'primary',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const styles =
    variant === 'danger'
      ? 'bg-danger-600 text-white'
      : variant === 'secondary'
        ? 'border border-line bg-surface text-ink'
        : 'bg-brand-600 text-white';
  return (
    <a
      href={href}
      className={`touch-target inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold ${styles}`}
    >
      {children}
    </a>
  );
}

function ActionLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const cls =
    'mt-2 inline-block text-sm font-semibold text-brand-700 hover:underline';
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children} →
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children} →
    </Link>
  );
}

/** Normalise a phone number for tel:/sms: links (strip spaces & punctuation). */
function tel(phone: string): string {
  return phone.replace(/[^+0-9]/g, '');
}
