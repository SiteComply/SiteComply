import { NextResponse } from 'next/server';
import { getAdminSession, type AdminSession } from '@/lib/session';

/**
 * Admin role-based authorisation.
 *
 * The admin tier has three roles (Prisma `AdminRole`): OWNER > ADMIN > VIEWER.
 * VIEWER is read-only — it may view admin pages but must not change any
 * configuration. Historically every admin route only checked that *a* session
 * existed, so a VIEWER could mutate settings; `requireAdminRole` is the single
 * reusable guard that closes that gap.
 */

export type AdminRoleName = 'OWNER' | 'ADMIN' | 'VIEWER';

/** Roles permitted to change configuration/state. VIEWER is deliberately excluded. */
export const ADMIN_WRITE_ROLES: AdminRoleName[] = ['OWNER', 'ADMIN'];

/** Pure predicate — true when the role may change settings. Fail-closed on unknown. */
export function adminCanManage(role: string | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Route guard: require a signed-in admin whose role is in `allowed`.
 * Returns the session on success, or a ready-to-return JSON error response —
 * 401 when not signed in, 403 when signed in without a permitted role.
 *
 *   const auth = requireAdminRole(ADMIN_WRITE_ROLES);
 *   if (!auth.ok) return auth.response;
 *   const admin = auth.admin; // AdminSession
 */
export function requireAdminRole(
  allowed: AdminRoleName[],
): { ok: true; admin: AdminSession } | { ok: false; response: NextResponse } {
  const admin = getAdminSession();
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 }),
    };
  }
  if (!allowed.includes(admin.role as AdminRoleName)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Your admin role is read-only and cannot make this change.' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, admin };
}
