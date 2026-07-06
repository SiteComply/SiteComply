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
export const ACCEPTED_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
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
    return { ok: false, error: 'That image type is not supported. Use PNG, JPEG, WEBP, SVG or GIF.' };
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
