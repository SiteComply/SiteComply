import { redirect } from 'next/navigation';

/**
 * Company induction modules moved into the Induction Videos area.
 *
 * KEPT AS A REDIRECT, not deleted. This URL shipped to production and is listed
 * in `SETTINGS_AREAS`, so a bookmark, a link in an email, or a Director who
 * learned the path must land on the screen rather than a 404. The page itself
 * now lives at /platform/dashboard/induction-videos/modules; see
 * `InductionVideoWorkspace` for why it moved.
 *
 * No gate here on purpose: the destination enforces its own, and duplicating it
 * would mean two places to keep in step.
 */
export default function MovedInductionModulesPage() {
  redirect('/platform/dashboard/induction-videos/modules');
}
