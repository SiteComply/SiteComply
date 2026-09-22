'use client';

import { PanelCard } from '@/components/worker/PanelCard';
import type { BriefingScreen } from '@/services/induction/inductionBriefing';

/**
 * One site-briefing screen of the induction: information to read, laid out
 * with the same cards as the operative's Site information page, so what they
 * are briefed on here is recognisably what they can look up again later.
 * Nothing on it is answered.
 */
export function BriefingStep({ screen }: { screen: BriefingScreen }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Site briefing
        </p>
        <h2 className="text-xl font-bold leading-snug text-ink">{screen.heading}</h2>
        <p className="text-sm text-ink-muted">{screen.intro}</p>
      </div>

      {screen.blocks.map((b) => (
        <PanelCard key={b.key} icon={b.icon} tone={b.tone} title={b.title}>
          <div className="space-y-3 text-sm text-ink">
            {b.rows && (
              <dl className="space-y-1">
                {b.rows.map((r) => (
                  <div key={r.label}>
                    <dt className="inline font-semibold">{r.label}: </dt>
                    <dd className="inline whitespace-pre-line break-words">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {b.text && <p className="whitespace-pre-line break-words">{b.text}</p>}

            {b.people && (
              <ul className="space-y-2">
                {b.people.map((p) => (
                  <li key={`${p.role}-${p.name}`}>
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-ink-muted"> · {p.role}</span>
                    {p.phone && (
                      <>
                        {' · '}
                        <a className="font-semibold text-brand-700 underline" href={`tel:${p.phone.replace(/\s+/g, '')}`}>
                          {p.phone}
                        </a>
                      </>
                    )}
                    {p.location && <div className="text-ink-muted">{p.location}</div>}
                  </li>
                ))}
              </ul>
            )}

            {b.list && (
              <ul className="list-disc space-y-1 pl-5">
                {b.list.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}

            {b.entries && (
              <ul className="space-y-3">
                {b.entries.map((e) => (
                  <li key={e.title}>
                    <p className="font-semibold">{e.title}</p>
                    {e.text && <p className="whitespace-pre-line break-words text-ink-muted">{e.text}</p>}
                  </li>
                ))}
              </ul>
            )}

            {b.links && (
              <ul className="space-y-2">
                {b.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-brand-700 underline"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}

            {b.image && (
              <a href={b.image.src} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.image.src}
                  alt={b.image.alt}
                  className="w-full rounded-lg border border-line"
                />
                <span className="mt-1 block text-xs text-ink-muted">Tap to open full size</span>
              </a>
            )}
          </div>
        </PanelCard>
      ))}
    </div>
  );
}
