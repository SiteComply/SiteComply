import Link from 'next/link';
import type { ModuleRow } from '@/services/inductionModules/moduleRows';

/**
 * RETIRED COMPANY MODULES — kept, reachable, and out of the working catalogue.
 *
 * ── WHY IT IS A PLACE AND NOT A CHECKBOX ──────────────────────────────────
 *
 * Retired modules used to sit in the main list behind "Show retired". By the owner's
 * decision Company Modules is the ACTIVE catalogue - what can actually reach a new
 * induction - so a first-time user should not have to work out which rows count.
 * History, restoration and backwards compatibility still matter, so nothing is
 * deleted; it moves here.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SHOW ────────────────────────────────────
 *
 * A retirement date. `setModuleActive` records no event, so the only date available is
 * `updatedAt`, which moves when anybody changes a setting. A date that is wrong half
 * the time is worse than no date, so the archive shows what it can stand behind: the
 * wording's own history, which IS recorded, on the module's page.
 *
 * A Server Component: no state, no handlers, nothing shipped to the browser.
 * Restoring happens on the module's own page, where the consequence is spelled out.
 */
export function ModulesArchive({
  modules,
  backHref,
  basePath,
}: {
  modules: ModuleRow[];
  /** The active catalogue this archive belongs to. */
  backHref: string;
  /** Where a module's own page lives, e.g. …/induction-videos/modules. */
  basePath: string;
}) {
  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-xs font-semibold text-brand-700 hover:underline">
        ← Company modules
      </Link>

      <header className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold text-ink">Retired modules</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Kept for the record and left out of every induction. A published induction still
          holds the wording it was approved with, so nothing an operative was told has
          changed. Open one to read its history or bring it back.
        </p>
      </header>

      {modules.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-sm text-ink-muted shadow-card">
          <span className="font-semibold text-ink">Nothing is retired.</span> Every company
          module is in the active catalogue.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-sunken">
                <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                  Module
                </th>
                <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                  Subject
                </th>
                <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                  Wording it kept
                </th>
                <th scope="col" className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-subtle">
                  If brought back
                </th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m.id} className="border-t border-line align-top">
                  <td className="px-4 py-3">
                    <Link
                      href={`${basePath}/${m.id}`}
                      className="text-sm font-bold text-brand-700 hover:underline"
                    >
                      {m.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-ink-subtle">{m.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink-muted">{m.category}</td>
                  <td className="px-4 py-3 text-sm text-ink-muted">
                    {m.issued
                      ? `Revision ${m.issued.version}, issued ${m.issued.issuedOn}`
                      : m.draft
                        ? `Draft revision ${m.draft.version} — never issued`
                        : 'Nothing was ever written'}
                    {m.revisionCount > 1 && (
                      <div className="text-xs text-ink-subtle">
                        {m.revisionCount} revisions kept
                      </div>
                    )}
                  </td>
                  {/*
                    * WHAT RESTORING WOULD DO, said here rather than discovered
                    * afterwards. A module retired while still flagged mandatory would
                    * return to EVERY site at once, which is worth seeing before
                    * somebody presses the button on its page.
                    */}
                  <td className="px-4 py-3 text-sm">
                    {m.mandatory ? (
                      <span className="font-semibold text-danger-700">
                        Every site, immediately
                      </span>
                    ) : m.defaultIncluded ? (
                      <span className="text-ink-muted">On by default for new projects</span>
                    ) : (
                      <span className="text-ink-muted">Off until a project opts in</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-line px-4 py-2 text-xs text-ink-subtle">
            {modules.length} retired · restoring happens on a module’s own page, where the
            consequence is stated
          </div>
        </div>
      )}
    </div>
  );
}
