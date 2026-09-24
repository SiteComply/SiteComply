import { redirect } from 'next/navigation';

/**
 * Company induction modules are not a setting; they are part of the induction
 * video product. This URL existed only briefly, but it existed in production, so
 * it redirects rather than 404s — the same courtesy the Platform's old Settings
 * path gets.
 *
 * No gate here on purpose: the destination enforces its own.
 */
export default function MovedAdminInductionModulesPage() {
  redirect('/admin/induction-videos/modules');
}
