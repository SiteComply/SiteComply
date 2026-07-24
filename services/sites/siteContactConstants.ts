/**
 * Client-safe Site Contacts constants (SC-003). Kept free of any Prisma / server
 * imports (mirrors ../bulletins/bulletinConstants) so the management form and the
 * server-side validator share one set of limits.
 */

export const CONTACT_ROLE_MAX = 60;
export const CONTACT_NAME_MAX = 80;
export const CONTACT_PHONE_MAX = 30;
