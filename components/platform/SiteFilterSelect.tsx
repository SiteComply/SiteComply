'use client';

/**
 * Site filter dropdown for a register that already lists records across sites.
 *
 * Deliberately a plain <select> driving a URL parameter, not a filter panel:
 * the surrounding filters are links that set query params, so this keeps the
 * whole filter state in the URL — shareable, bookmarkable, and restored by the
 * back button. Same control and wording as the Compliance Calendar's site
 * filter ("All Sites", `?site=`), so the two read as one product.
 *
 * Props are plain data only — a server component cannot pass a function across
 * the client boundary, so the href is composed here from `basePath` and the
 * params to preserve.
 */
export function SiteFilterSelect({
  sites,
  selectedSiteId,
  basePath,
  preserveParams = {},
  label = 'Filter by site',
}: {
  sites: { id: string; name: string }[];
  selectedSiteId: string | null;
  basePath: string;
  /** Other filter params to carry across, e.g. { status: 'on-site' }. */
  preserveParams?: Record<string, string | undefined>;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={selectedSiteId ?? ''}
      onChange={(e) => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(preserveParams)) {
          if (v) params.set(k, v);
        }
        if (e.target.value) params.set('site', e.target.value);
        const q = params.toString();
        window.location.href = q ? `${basePath}?${q}` : basePath;
      }}
      className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
    >
      <option value="">All Sites</option>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
