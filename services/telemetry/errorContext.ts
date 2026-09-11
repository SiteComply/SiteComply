import { ErrorEventPortal } from '@prisma/client';
import { getWorkerSession, getAdminSession } from '@/lib/session';
import { getPlatformViewer } from '@/services/platformUsers/platformAccess';

/**
 * Who and where, for an automatically captured error.
 *
 * Kept apart from the writer so both capture paths — a failing API route and a
 * browser posting a crash — attribute identity the same way. The reporting
 * feature learned this the hard way: when each portal resolved its own user,
 * a worker's feedback was filed against whichever platform user happened to
 * have a session, and the fix was one resolver used everywhere.
 */

/** Which portal a path belongs to. The only signal available server-side. */
export function portalFromPath(path: string | null | undefined): ErrorEventPortal {
  const p = (path ?? '').split('?')[0] ?? '';
  if (p.startsWith('/api/system') || p.startsWith('/api/scheduler')) {
    return ErrorEventPortal.SYSTEM;
  }
  if (p.startsWith('/platform') || p.startsWith('/api/platform')) {
    return ErrorEventPortal.PLATFORM;
  }
  if (p.startsWith('/admin') || p.startsWith('/api/admin')) {
    return ErrorEventPortal.ADMIN;
  }
  if (
    p.startsWith('/worker') ||
    p.startsWith('/check-in') ||
    p.startsWith('/api/worker')
  ) {
    return ErrorEventPortal.WORKER;
  }
  return ErrorEventPortal.PUBLIC;
}

export interface ErrorActor {
  userRef: string | null;
  userName: string | null;
  userRole: string | null;
  userOrg: string | null;
}

const ANON: ErrorActor = {
  userRef: null,
  userName: null,
  userRole: null,
  userOrg: null,
};

/**
 * Resolve the actor from whichever session the portal uses.
 *
 * Reads only the portal's OWN cookie. Falling back across portals would
 * attribute an operative's crash to a platform user who merely had a session
 * open in the same browser — worse than recording nobody.
 *
 * Never throws: an unreadable session must not stop the error being recorded.
 */
export async function resolveActor(
  portal: ErrorEventPortal,
): Promise<ErrorActor> {
  try {
    if (portal === ErrorEventPortal.PLATFORM) {
      const v = await getPlatformViewer();
      return v
        ? {
            userRef: `platform:${v.id}`,
            userName: v.name,
            userRole: v.role,
            userOrg: null,
          }
        : ANON;
    }
    if (portal === ErrorEventPortal.ADMIN) {
      const s = getAdminSession();
      return s
        ? {
            userRef: `admin:${s.adminId}`,
            userName: s.name ?? null,
            userRole: s.role ?? 'Admin',
            userOrg: null,
          }
        : ANON;
    }
    if (portal === ErrorEventPortal.WORKER) {
      const s = getWorkerSession();
      return s
        ? {
            // The mobile is personal data, so it is never stored here — and the
            // fallback that reached for it when workerId was unset would have
            // written one into every pre-registration crash. No id means no ref;
            // the portal, page and timestamp still identify the failure.
            userRef: s.workerId ? `worker:${s.workerId}` : null,
            userName: null,
            userRole: 'Operative',
            userOrg: null,
          }
        : ANON;
    }
    return ANON;
  } catch {
    return ANON;
  }
}

/**
 * Which deploy this happened on — the first thing worth knowing.
 *
 * Re-exported rather than reimplemented. The first version here read
 * `process.env.NEXT_BUILD_ID`, which Next does not set — the identical mistake
 * the reporting feature already made and fixed, and it silently stored null on
 * every record. The working one reads `.next/BUILD_ID` off disk.
 */
export { currentBuildId } from '@/services/reports/reportService';
