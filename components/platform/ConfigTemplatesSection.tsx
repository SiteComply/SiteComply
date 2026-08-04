import Link from 'next/link';
import { ConfigTemplateLibrary } from '@/components/platform/ConfigTemplateLibrary';
import {
  requirePlatformViewer,
  assertModuleView,
} from '@/services/platformUsers/platformAccess';
import {
  permits,
  canManageSiteConfigTemplates,
} from '@/services/platformUsers/platformPermissions';
import {
  listAllConfigTemplates,
  listMandatoryPolicy,
  getConfigTemplate,
} from '@/services/siteServices/siteConfigTemplateService';
import { listServiceCatalog } from '@/services/siteServices/siteServiceAvailability';

/**
 * SC-021 Phase 2 — shared configuration templates and company requirements.
 *
 * Lives under Settings because this is GOVERNANCE — defining an organisation
 * standard — not scheduling and not site records. Applying a template is a
 * different job with a different owner and cadence, and stays embedded in the
 * site experience; only authoring and company requirements live here.
 *
 * An organisation-wide artefact must not be administered from inside one
 * arbitrary site: deleting a shared template from within a single site would
 * read as a site action while affecting every future project.
 *
 * Viewing still needs `sites:view`, deliberately UNCHANGED by the move: every
 * role holds both `sites:view` and `audits:view`, so switching the gate would
 * alter nothing in practice while still being an edit to permission code. The
 * mismatch between the URL's section and the gate's module is intentional, not
 * an oversight.
 *
 * Managing a shared template is Director/Project Manager; setting a company
 * requirement is Director only. Each gate is enforced in the service and the
 * API too — this page only decides what to show.
 */
export async function ConfigTemplatesSection() {
  const viewer = await requirePlatformViewer();
  assertModuleView(viewer, 'sites');

  const [templates, policy, catalogue] = await Promise.all([
    listAllConfigTemplates(),
    viewer.role === 'DIRECTOR' ? listMandatoryPolicy() : Promise.resolve([]),
    // The catalogue lets a template be authored here directly, rather than only
    // by copying a site that already happens to be configured correctly.
    listServiceCatalog(),
  ]);

  // Full item sets, so an existing template can be EDITED in place rather than
  // only activated, deactivated or deleted.
  const details = await Promise.all(
    templates.map((t) => getConfigTemplate(t.id)),
  );
  const itemsByTemplate: Record<
    string,
    { kind: string; refId: string; enabled: boolean }[]
  > = {};
  for (const d of details) {
    if (d) {
      itemsByTemplate[d.id] = d.items.map((i) => ({
        kind: i.kind,
        refId: i.refId,
        enabled: i.enabled,
      }));
    }
  }

  return (
    <>
      <ConfigTemplateLibrary
        templates={templates}
        canManage={canManageSiteConfigTemplates(viewer.role)}
        policy={policy}
        canSetPolicy={viewer.role === 'DIRECTOR'}
        catalogue={catalogue}
        itemsByTemplate={itemsByTemplate}
      />

      {permits(viewer.role, 'sites', 'edit') ? (
        <p className="mt-6 text-sm text-ink-subtle">
          To create a template, open a site’s{' '}
          <Link
            href="/platform/dashboard/sites"
            className="font-semibold text-brand-700 hover:underline"
          >
            Compliance tab
          </Link>
          , set which permits and inspections apply, then choose “Save this site
          as a template”.
        </p>
      ) : null}
    </>
  );
}
