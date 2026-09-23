import type { PlatformRoleValue } from '@/services/platformUsers/platformUserConstants';

/**
 * Who may work on induction videos.
 *
 * KEPT OUT OF THE MODULE MATRIX ON PURPOSE. The matrix answers "may this role
 * view/create/edit/export this module"; approval here is a distinct act with a
 * distinct list, the way audit sign-off already is. Writing it as a verb on a
 * module would let a future edit to "edit" quietly grant approval.
 *
 * The owner's decision: Directors and Site Managers approve and publish.
 * Project Managers may prepare and edit a script but not approve it, which
 * mirrors how they can prepare an audit but not sign it off.
 */
const MANAGE_ROLES: PlatformRoleValue[] = [
  'DIRECTOR',
  'PROJECT_MANAGER',
  'SITE_MANAGER',
  'PRINCIPAL_CONTRACTOR',
];

const APPROVE_ROLES: PlatformRoleValue[] = ['DIRECTOR', 'SITE_MANAGER'];

export function canManageInductionVideos(role: PlatformRoleValue): boolean {
  return MANAGE_ROLES.includes(role);
}

export function canApproveInductionVideo(role: PlatformRoleValue): boolean {
  return APPROVE_ROLES.includes(role);
}

/** For the UI, so a button is never offered to a role the service refuses. */
export const INDUCTION_VIDEO_APPROVE_ROLES = APPROVE_ROLES;
