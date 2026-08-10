import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import {
  uploadDocumentBlob,
  downloadDocumentBlob,
  deleteDocumentBlob,
} from '@/services/documents/blobStorage';

/**
 * Singleton company profile + branding store (Admin → Settings → Company).
 * Mirrors the other settings stores (SMS / AI / Auth / Notifications): a single
 * row holds the company name, support contacts and branding, plus a pointer to
 * the logo blob. The logo bytes reuse the existing private Documents blob
 * container (under a `branding/` prefix) — only the path + content type are
 * stored here, and the image is streamed back through a serving route.
 *
 * No secrets, so nothing is encrypted; all text values are safe for the client.
 */

const CONFIG_ID = 'company';

/** Product defaults used when the company hasn't set a value. */
export const COMPANY_DEFAULTS = {
  companyName: 'SiteComply',
  primaryColor: '#38B54A',
  accentColor: '#00AEEF',
} as const;

// Accepted logo image types + size cap (smaller than documents — logos are small).
// SVG is deliberately excluded: it can carry scripts, and the logo is served on a
// PUBLIC route, so an admin-uploaded SVG would be a stored-XSS vector. Only raster
// formats are accepted; the serve route additionally sends X-Content-Type-Options:
// nosniff and forces any non-raster content to download.
export const ACCEPTED_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

const NAME_MAX = 120;
const TAGLINE_MAX = 160;
const PHONE_MAX = 40;
const EMAIL_MAX = 160;

async function readRow() {
  return prisma.companyConfig.findUnique({ where: { id: CONFIG_ID } });
}

export interface CompanyConfigView {
  companyName: string;
  supportEmail: string;
  supportPhone: string;
  primaryColor: string;
  accentColor: string;
  tagline: string;
  hasLogo: boolean;
  logoContentType: string | null;
  /** Millisecond timestamp for cache-busting the logo <img> src. */
  logoVersion: number | null;
  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SaveCompanyConfigInput {
  companyName?: string;
  supportEmail?: string;
  supportPhone?: string;
  primaryColor?: string;
  accentColor?: string;
  tagline?: string;
}

/** Admin-safe view — current values, falling back to product defaults for display. */
export async function getCompanyConfigForAdmin(): Promise<CompanyConfigView> {
  const row = await readRow();
  return {
    companyName: row?.companyName ?? COMPANY_DEFAULTS.companyName,
    supportEmail: row?.supportEmail ?? '',
    supportPhone: row?.supportPhone ?? '',
    primaryColor: row?.primaryColor ?? COMPANY_DEFAULTS.primaryColor,
    accentColor: row?.accentColor ?? COMPANY_DEFAULTS.accentColor,
    tagline: row?.tagline ?? '',
    hasLogo: !!row?.logoBlobPath,
    logoContentType: row?.logoContentType ?? null,
    logoVersion: row?.logoUpdatedAt ? row.logoUpdatedAt.getTime() : null,
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PHONE_RE = /^[0-9+().\-\s]+$/;

/** Normalise a hex colour to a `#rrggbb` (or `#rgb`) form, or null if invalid. */
function normaliseHex(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return null;
  const withHash = v.startsWith('#') ? v : `#${v}`;
  return HEX_RE.test(withHash) ? withHash.toLowerCase() : 'invalid';
}

export async function saveCompanyConfig(
  input: SaveCompanyConfigInput,
  admin: { adminId: string; name: string },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const text = (v?: string) => (v ?? '').trim();

  const companyName = text(input.companyName);
  if (companyName.length > NAME_MAX) errors.companyName = `Keep the name under ${NAME_MAX} characters.`;

  const supportEmail = text(input.supportEmail);
  if (supportEmail && (supportEmail.length > EMAIL_MAX || !EMAIL_RE.test(supportEmail)))
    errors.supportEmail = 'Enter a valid email address.';

  const supportPhone = text(input.supportPhone);
  if (supportPhone && (supportPhone.length > PHONE_MAX || !PHONE_RE.test(supportPhone)))
    errors.supportPhone = 'Enter a valid phone number.';

  const tagline = text(input.tagline);
  if (tagline.length > TAGLINE_MAX) errors.tagline = `Keep the tagline under ${TAGLINE_MAX} characters.`;

  const primaryColor = normaliseHex(text(input.primaryColor));
  if (primaryColor === 'invalid') errors.primaryColor = 'Enter a hex colour like #38B54A.';
  const accentColor = normaliseHex(text(input.accentColor));
  if (accentColor === 'invalid') errors.accentColor = 'Enter a hex colour like #00AEEF.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const data = {
    companyName: companyName || null,
    supportEmail: supportEmail || null,
    supportPhone: supportPhone || null,
    tagline: tagline || null,
    primaryColor: primaryColor as string | null,
    accentColor: accentColor as string | null,
    updatedByAdminId: admin.adminId,
    updatedByName: admin.name,
  };

  await prisma.companyConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });
  return { ok: true };
}

/** Validate an uploaded logo file's size and content type. */
export function validateLogoFile(
  file: { size: number; type: string } | null,
): { ok: true } | { ok: false; error: string } {
  if (!file || file.size === 0) return { ok: false, error: 'Please choose an image to upload.' };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: 'That image is too large (max 2 MB).' };
  if (!ACCEPTED_LOGO_MIME_TYPES.includes(file.type as never))
    return { ok: false, error: 'That image type is not supported. Use PNG, JPEG, WEBP or GIF.' };
  return { ok: true };
}

function buildLogoBlobPath(fileName: string): string {
  const safe = (fileName || 'logo').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-60);
  return `branding/${randomUUID()}-${safe}`;
}

/**
 * Upload a new logo to blob storage and point the company config at it. The
 * previous logo blob (if any) is deleted best-effort so images don't accumulate.
 */
export async function setCompanyLogo(
  file: { buffer: Buffer; fileName: string; mimeType: string },
  admin: { adminId: string; name: string },
): Promise<void> {
  const previous = (await readRow())?.logoBlobPath ?? null;
  const blobPath = buildLogoBlobPath(file.fileName);
  await uploadDocumentBlob(blobPath, file.buffer, file.mimeType);

  await prisma.companyConfig.upsert({
    where: { id: CONFIG_ID },
    update: {
      logoBlobPath: blobPath,
      logoContentType: file.mimeType,
      logoUpdatedAt: new Date(),
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
    create: {
      id: CONFIG_ID,
      logoBlobPath: blobPath,
      logoContentType: file.mimeType,
      logoUpdatedAt: new Date(),
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
  });

  if (previous && previous !== blobPath) await deleteDocumentBlob(previous);
}

/** Remove the company logo (delete the blob + clear the pointer). */
export async function clearCompanyLogo(admin: {
  adminId: string;
  name: string;
}): Promise<void> {
  const row = await readRow();
  if (!row?.logoBlobPath) return;
  await deleteDocumentBlob(row.logoBlobPath);
  await prisma.companyConfig.update({
    where: { id: CONFIG_ID },
    data: {
      logoBlobPath: null,
      logoContentType: null,
      logoUpdatedAt: null,
      updatedByAdminId: admin.adminId,
      updatedByName: admin.name,
    },
  });
}

/** Fetch the current logo's bytes + content type for the serving route (or null). */
export async function getCompanyLogo(): Promise<{ bytes: Buffer; contentType: string } | null> {
  const row = await readRow();
  if (!row?.logoBlobPath) return null;
  const bytes = await downloadDocumentBlob(row.logoBlobPath);
  if (!bytes) return null;
  return { bytes, contentType: row.logoContentType || 'application/octet-stream' };
}

export interface CompanyBranding {
  companyName: string;
  supportEmail: string | null;
  supportPhone: string | null;
  primaryColor: string;
  accentColor: string;
  tagline: string | null;
  hasLogo: boolean;
}

/**
 * The effective company branding (DB over product defaults). Future branding
 * surfaces (login page, emails, headers) read this so they honour admin changes
 * with no code changes here.
 */
export async function getCompanyBranding(): Promise<CompanyBranding> {
  const row = await readRow();
  return {
    companyName: row?.companyName ?? COMPANY_DEFAULTS.companyName,
    supportEmail: row?.supportEmail ?? null,
    supportPhone: row?.supportPhone ?? null,
    primaryColor: row?.primaryColor ?? COMPANY_DEFAULTS.primaryColor,
    accentColor: row?.accentColor ?? COMPANY_DEFAULTS.accentColor,
    tagline: row?.tagline ?? null,
    hasLogo: !!row?.logoBlobPath,
  };
}

/* -------------------------------------------------------------------------- */
/* Platform (Director) surface — the OWNER of company profile & branding       */
/* -------------------------------------------------------------------------- */

/**
 * Settings → Company profile & branding, in the PLATFORM portal.
 *
 * ONE ROW, ONE EDITOR. These are organisation-level business settings, so the
 * Platform portal owns them outright and the Admin Centre keeps a read-only
 * view as the platform operator's fallback. That is deliberately a different
 * split from Authentication & Access, where the Admin Centre retains the
 * infrastructure fields — there is no infrastructure/policy seam in company
 * branding to split along, and two full editors of one row is exactly the
 * duplicate source of truth this section exists to remove.
 *
 * WHAT THIS IS NOT. It never supplies the CDM duty holders on a project.
 * CdmDutyHolders records the client, principal designer and principal
 * contractor APPOINTED TO THAT PROJECT — legal appointments that vary per job.
 * An organisation-level contact flowing into those fields would be a legal
 * misstatement, so nothing here is read by that path.
 */
export interface PlatformCompanyProfileView {
  /** Company profile. */
  companyName: string;
  registrationNumber: string;
  vatNumber: string;
  primaryContactName: string;
  primaryEmail: string;
  primaryPhone: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  addressTown: string;
  addressPostcode: string;
  /** Branding. */
  tagline: string;
  primaryColor: string;
  accentColor: string;
  hasLogo: boolean;
  hasPrintLogo: boolean;
  logoVersion: number | null;
  printLogoVersion: number | null;
  /** Document defaults. */
  disclaimer: string;
  reportFooter: string;
  /** Close-out pack branding. */
  packIncludeCompanyInfo: boolean;
  packIncludeLogo: boolean;
  packIncludePrintLogo: boolean;
  packIncludeStandardDetails: boolean;
  /** Support contact — shown for context; distinct from the primary contact. */
  supportEmail: string;
  supportPhone: string;

  configured: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

/** The fields a Director may change. Anything not here is not writable. */
export interface SavePlatformCompanyProfileInput {
  companyName?: string;
  registrationNumber?: string;
  vatNumber?: string;
  primaryContactName?: string;
  primaryEmail?: string;
  primaryPhone?: string;
  website?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressTown?: string;
  addressPostcode?: string;
  tagline?: string;
  primaryColor?: string;
  accentColor?: string;
  disclaimer?: string;
  reportFooter?: string;
  packIncludeCompanyInfo?: boolean;
  packIncludeLogo?: boolean;
  packIncludePrintLogo?: boolean;
  packIncludeStandardDetails?: boolean;
}

const URL_MAX = 200;
const REG_MAX = 40;
const ADDRESS_MAX = 120;
const LONG_TEXT_MAX = 2000;

export async function getPlatformCompanyProfile(): Promise<PlatformCompanyProfileView> {
  const row = await readRow();
  const t = (v: string | null | undefined) => v ?? '';
  return {
    companyName: row?.companyName ?? COMPANY_DEFAULTS.companyName,
    registrationNumber: t(row?.registrationNumber),
    vatNumber: t(row?.vatNumber),
    primaryContactName: t(row?.primaryContactName),
    primaryEmail: t(row?.primaryEmail),
    primaryPhone: t(row?.primaryPhone),
    website: t(row?.website),
    addressLine1: t(row?.addressLine1),
    addressLine2: t(row?.addressLine2),
    addressTown: t(row?.addressTown),
    addressPostcode: t(row?.addressPostcode),
    tagline: t(row?.tagline),
    primaryColor: row?.primaryColor ?? COMPANY_DEFAULTS.primaryColor,
    accentColor: row?.accentColor ?? COMPANY_DEFAULTS.accentColor,
    hasLogo: !!row?.logoBlobPath,
    hasPrintLogo: !!row?.printLogoBlobPath,
    logoVersion: row?.logoUpdatedAt ? row.logoUpdatedAt.getTime() : null,
    printLogoVersion: row?.printLogoUpdatedAt
      ? row.printLogoUpdatedAt.getTime()
      : null,
    disclaimer: t(row?.disclaimer),
    reportFooter: t(row?.reportFooter),
    // Default TRUE when no row exists, matching the migration defaults and
    // what packs render today.
    packIncludeCompanyInfo: row?.packIncludeCompanyInfo ?? true,
    packIncludeLogo: row?.packIncludeLogo ?? true,
    packIncludePrintLogo: row?.packIncludePrintLogo ?? true,
    packIncludeStandardDetails: row?.packIncludeStandardDetails ?? true,
    supportEmail: t(row?.supportEmail),
    supportPhone: t(row?.supportPhone),
    configured: !!row,
    updatedByName: row?.updatedByName ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function savePlatformCompanyProfile(
  input: SavePlatformCompanyProfileInput,
  user: { userId: string; name: string },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  // ABSENT IS NOT BLANK.
  //
  // `undefined` means the request never mentioned this field and the stored
  // value must survive. `''` means the user cleared the box and it must be
  // nulled. The two were previously collapsed — `(v ?? '').trim()` turned an
  // absent field into an empty string, which was then written as null — so a
  // request carrying one section erased every field it did not mention, and an
  // empty request erased the whole profile while reporting success.
  //
  // Every value below is therefore `string | undefined`, and `store()` maps
  // that to what Prisma needs: undefined is OMITTED from the update, so the
  // column keeps its value (and takes the schema default on create), while a
  // supplied-but-empty value becomes null.
  const text = (v?: string) => (v === undefined ? undefined : v.trim());
  const store = (v: string | undefined) => (v === undefined ? undefined : v || null);
  const len = (v?: string) => v?.length ?? 0;

  const companyName = text(input.companyName);
  if (len(companyName) > NAME_MAX)
    errors.companyName = `Keep the name under ${NAME_MAX} characters.`;

  const primaryEmail = text(input.primaryEmail);
  if (primaryEmail && (primaryEmail.length > EMAIL_MAX || !EMAIL_RE.test(primaryEmail)))
    errors.primaryEmail = 'Enter a valid email address.';

  const primaryPhone = text(input.primaryPhone);
  if (primaryPhone && (primaryPhone.length > PHONE_MAX || !PHONE_RE.test(primaryPhone)))
    errors.primaryPhone = 'Enter a valid phone number.';

  // Accepts a bare domain and stores it as typed. Deliberately not coerced to
  // https:// — rewriting what someone entered into their own company record is
  // the kind of helpfulness that later reads as data they did not supply.
  const website = text(input.website);
  if (len(website) > URL_MAX) errors.website = `Keep the website under ${URL_MAX} characters.`;

  const registrationNumber = text(input.registrationNumber);
  if (len(registrationNumber) > REG_MAX)
    errors.registrationNumber = `Keep the registration number under ${REG_MAX} characters.`;
  const vatNumber = text(input.vatNumber);
  if (len(vatNumber) > REG_MAX)
    errors.vatNumber = `Keep the VAT number under ${REG_MAX} characters.`;

  const primaryContactName = text(input.primaryContactName);
  if (len(primaryContactName) > NAME_MAX)
    errors.primaryContactName = `Keep the contact name under ${NAME_MAX} characters.`;

  const addr = {
    addressLine1: text(input.addressLine1),
    addressLine2: text(input.addressLine2),
    addressTown: text(input.addressTown),
    addressPostcode: text(input.addressPostcode),
  };
  for (const [k, v] of Object.entries(addr)) {
    if (len(v) > ADDRESS_MAX) errors[k] = `Keep this under ${ADDRESS_MAX} characters.`;
  }

  const tagline = text(input.tagline);
  if (len(tagline) > TAGLINE_MAX)
    errors.tagline = `Keep the tagline under ${TAGLINE_MAX} characters.`;

  const disclaimer = text(input.disclaimer);
  if (len(disclaimer) > LONG_TEXT_MAX)
    errors.disclaimer = `Keep the disclaimer under ${LONG_TEXT_MAX} characters.`;
  const reportFooter = text(input.reportFooter);
  if (len(reportFooter) > LONG_TEXT_MAX)
    errors.reportFooter = `Keep the footer under ${LONG_TEXT_MAX} characters.`;

  // Guarded at the call site so the shared normaliseHex keeps its contract.
  const primaryColor =
    input.primaryColor === undefined ? undefined : normaliseHex(input.primaryColor);
  if (primaryColor === 'invalid') errors.primaryColor = 'Enter a hex colour like #38B54A.';
  const accentColor =
    input.accentColor === undefined ? undefined : normaliseHex(input.accentColor);
  if (accentColor === 'invalid') errors.accentColor = 'Enter a hex colour like #00AEEF.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // NOTE: supportEmail / supportPhone are NOT written here. They already appear
  // on close-out packs and are a different fact from the primary contact;
  // silently overwriting them from this screen would change what is printed.
  const data = {
    companyName: store(companyName),
    registrationNumber: store(registrationNumber),
    vatNumber: store(vatNumber),
    primaryContactName: store(primaryContactName),
    primaryEmail: store(primaryEmail),
    primaryPhone: store(primaryPhone),
    website: store(website),
    addressLine1: store(addr.addressLine1),
    addressLine2: store(addr.addressLine2),
    addressTown: store(addr.addressTown),
    addressPostcode: store(addr.addressPostcode),
    tagline: store(tagline),
    primaryColor: primaryColor as string | null | undefined,
    accentColor: accentColor as string | null | undefined,
    disclaimer: store(disclaimer),
    reportFooter: store(reportFooter),
    // Passed through untouched: absent stays undefined, so an omitted toggle
    // keeps its stored value instead of being forced back on. `@default(true)`
    // in the schema still supplies the default on create.
    packIncludeCompanyInfo: input.packIncludeCompanyInfo,
    packIncludeLogo: input.packIncludeLogo,
    packIncludePrintLogo: input.packIncludePrintLogo,
    packIncludeStandardDetails: input.packIncludeStandardDetails,
    updatedByUserId: user.userId,
    updatedByName: user.name,
  };

  await prisma.companyConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });
  return { ok: true };
}

/**
 * Logo upload / removal / serving for EITHER logo, from the Platform portal.
 *
 * `kind` selects the column trio rather than duplicating three near-identical
 * functions — the screen logo and the print logo differ only in which pointer
 * they write, and two copies of this would drift the moment one gained a
 * validation rule the other did not.
 */
export type CompanyLogoKind = 'screen' | 'print';

const LOGO_COLUMNS = {
  screen: {
    path: 'logoBlobPath',
    type: 'logoContentType',
    at: 'logoUpdatedAt',
  },
  print: {
    path: 'printLogoBlobPath',
    type: 'printLogoContentType',
    at: 'printLogoUpdatedAt',
  },
} as const;

export async function setPlatformCompanyLogo(
  kind: CompanyLogoKind,
  file: { buffer: Buffer; fileName: string; mimeType: string },
  user: { userId: string; name: string },
): Promise<void> {
  const cols = LOGO_COLUMNS[kind];
  const row = await readRow();
  const previous = (row?.[cols.path] as string | null) ?? null;
  const blobPath = buildLogoBlobPath(file.fileName);
  await uploadDocumentBlob(blobPath, file.buffer, file.mimeType);

  const data = {
    [cols.path]: blobPath,
    [cols.type]: file.mimeType,
    [cols.at]: new Date(),
    updatedByUserId: user.userId,
    updatedByName: user.name,
  } as Record<string, unknown>;

  await prisma.companyConfig.upsert({
    where: { id: CONFIG_ID },
    update: data,
    create: { id: CONFIG_ID, ...data },
  });

  if (previous && previous !== blobPath) await deleteDocumentBlob(previous);
}

export async function clearPlatformCompanyLogo(
  kind: CompanyLogoKind,
  user: { userId: string; name: string },
): Promise<void> {
  const cols = LOGO_COLUMNS[kind];
  const row = await readRow();
  const current = (row?.[cols.path] as string | null) ?? null;
  if (!current) return;
  await deleteDocumentBlob(current);
  await prisma.companyConfig.update({
    where: { id: CONFIG_ID },
    data: {
      [cols.path]: null,
      [cols.type]: null,
      [cols.at]: null,
      updatedByUserId: user.userId,
      updatedByName: user.name,
    } as Record<string, unknown>,
  });
}

/** Bytes + content type for the print logo's serving route (or null). */
export async function getCompanyPrintLogo(): Promise<{
  bytes: Buffer;
  contentType: string;
} | null> {
  const row = await readRow();
  if (!row?.printLogoBlobPath) return null;
  const bytes = await downloadDocumentBlob(row.printLogoBlobPath);
  if (!bytes) return null;
  return {
    bytes,
    contentType: row.printLogoContentType || 'application/octet-stream',
  };
}
