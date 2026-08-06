import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

/**
 * Lightweight signed-token sessions.
 *
 * A session is a base64url JSON payload plus an HMAC-SHA256 signature, stored in
 * an httpOnly cookie. Dependency-free and sufficient for v1; swap for `jose`/JWT
 * or a server-side session store if requirements grow.
 *
 * The worker session simply records the SMS-verified mobile (and the workerId
 * once known) — proof the worker passed MFA. It is short-lived: long enough to
 * complete an induction, not a long-term login.
 */

const WORKER_COOKIE = 'sc_worker';
const WORKER_TTL_SECONDS = 60 * 60 * 2; // 2 hours

export interface WorkerSession {
  typ: 'worker';
  /** SMS-verified mobile in E.164 form. */
  mobile: string;
  /** Set once the worker record exists (recognised/created). */
  workerId?: string;
  iat: number;
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET must be set (>=16 chars) in production. See .env.example.',
    );
  }
  // Development-only fallback so the flow works before secrets are configured.
  return 'dev-only-insecure-session-secret-change-me';
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

function sign(payloadB64: string): string {
  return createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
}

/** Encode and sign a session payload into a token string. */
export function signSession<T extends object>(payload: T): string {
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Verify a token's signature and return its payload, or null if invalid. */
export function verifySession<T>(token: string | undefined): T | null {
  if (!token || !token.includes('.')) return null;
  const [payloadB64, signature] = token.split('.');
  const expected = sign(payloadB64);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

// --- Worker session helpers -------------------------------------------------

/**
 * `ttlSeconds` overrides the built-in default so the Director-configured worker
 * session timeout (Settings → Authentication & Access, via
 * getAuthRuntimeConfig) is honoured; omitting it preserves the legacy 2h TTL.
 * Same shape as createPlatformSessionToken, deliberately: this module stays
 * synchronous and free of database imports, so the caller reads the config and
 * passes the number in.
 */
export function createWorkerSessionToken(input: {
  mobile: string;
  workerId?: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl =
    input.ttlSeconds && input.ttlSeconds > 0
      ? input.ttlSeconds
      : WORKER_TTL_SECONDS;
  const session: WorkerSession = {
    typ: 'worker',
    mobile: input.mobile,
    workerId: input.workerId,
    iat: now,
    exp: now + ttl,
  };
  return signSession(session);
}

/** Read and validate the current worker session from cookies (or null). */
export function getWorkerSession(): WorkerSession | null {
  const token = cookies().get(WORKER_COOKIE)?.value;
  const session = verifySession<WorkerSession>(token);
  if (!session || session.typ !== 'worker') return null;
  if (session.exp * 1000 < Date.now()) return null;
  return session;
}

/** Set the worker session cookie (call from a Route Handler / Server Action). */
export function setWorkerSessionCookie(
  token: string,
  maxAgeSeconds?: number,
): void {
  cookies().set(WORKER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // The cookie must expire with the token it carries, or the browser keeps
    // sending a token the server will reject.
    maxAge:
      maxAgeSeconds && maxAgeSeconds > 0 ? maxAgeSeconds : WORKER_TTL_SECONDS,
  });
}

export function clearWorkerSessionCookie(): void {
  cookies().delete(WORKER_COOKIE);
}

// --- Pending OTP mobile -----------------------------------------------------

/**
 * A signed, short-lived cookie holding the normalised (E.164) mobile a code was
 * sent to, set when a worker requests an OTP and read back when they verify it.
 *
 * This is the server-side source of truth for "which number is this code for",
 * so verification never depends on the mobile still sitting in the check-in
 * page's React state — which is lost if that component remounts (e.g. a deploy
 * swaps the client bundle mid-flow). It is NOT a login: it only remembers the
 * destination number between the two OTP steps, and is cleared once the worker
 * session is established.
 */
const OTP_MOBILE_COOKIE = 'sc_otp_mobile';
// Comfortably longer than the OTP TTL so the number outlives the code itself.
const OTP_MOBILE_TTL_SECONDS = 60 * 15; // 15 minutes

interface OtpMobileToken {
  typ: 'otp';
  /** SMS destination in E.164 form. */
  mobile: string;
  iat: number;
  exp: number;
}

/** Remember the E.164 mobile a code was just sent to (call from a route). */
export function setWorkerOtpMobileCookie(mobile: string): void {
  const now = Math.floor(Date.now() / 1000);
  const token = signSession<OtpMobileToken>({
    typ: 'otp',
    mobile,
    iat: now,
    exp: now + OTP_MOBILE_TTL_SECONDS,
  });
  cookies().set(OTP_MOBILE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: OTP_MOBILE_TTL_SECONDS,
  });
}

/** The pending OTP mobile (E.164) if one is set and unexpired, else null. */
export function getWorkerOtpMobile(): string | null {
  const token = cookies().get(OTP_MOBILE_COOKIE)?.value;
  const payload = verifySession<OtpMobileToken>(token);
  if (!payload || payload.typ !== 'otp') return null;
  if (payload.exp * 1000 < Date.now()) return null;
  return payload.mobile || null;
}

export function clearWorkerOtpMobileCookie(): void {
  cookies().delete(OTP_MOBILE_COOKIE);
}

// --- Active worker site (SC-004) --------------------------------------------

/**
 * The site whose Worker Dashboard the worker is currently viewing, when they are
 * checked into more than one at once (SC-004). This is a NON-authoritative hint:
 * the value is always re-validated against the worker's own open check-ins
 * server-side (see workerDashboardService.getWorkerContext), so a tampered or
 * stale cookie can never surface a site the worker isn't checked into — it just
 * falls back to their most recent check-in. Scoped to the worker session's life.
 */
const ACTIVE_SITE_COOKIE = 'sc_worker_site';

export function setActiveWorkerSiteCookie(siteId: string): void {
  cookies().set(ACTIVE_SITE_COOKIE, siteId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: WORKER_TTL_SECONDS,
  });
}

export function getActiveWorkerSiteId(): string | null {
  return cookies().get(ACTIVE_SITE_COOKIE)?.value || null;
}

export function clearActiveWorkerSiteCookie(): void {
  cookies().delete(ACTIVE_SITE_COOKIE);
}

// --- Admin session helpers --------------------------------------------------

const ADMIN_COOKIE = 'sc_admin';
const ADMIN_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface AdminSession {
  typ: 'admin';
  adminId: string;
  email: string;
  name: string;
  role: string;
  iat: number;
  exp: number;
}

export function createAdminSessionToken(input: {
  adminId: string;
  email: string;
  name: string;
  role: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const session: AdminSession = {
    typ: 'admin',
    ...input,
    iat: now,
    exp: now + ADMIN_TTL_SECONDS,
  };
  return signSession(session);
}

/** Read and validate the current admin session from cookies (or null). */
export function getAdminSession(): AdminSession | null {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  const session = verifySession<AdminSession>(token);
  if (!session || session.typ !== 'admin') return null;
  if (session.exp * 1000 < Date.now()) return null;
  return session;
}

export function setAdminSessionCookie(token: string): void {
  cookies().set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_TTL_SECONDS,
  });
}

export function clearAdminSessionCookie(): void {
  cookies().delete(ADMIN_COOKIE);
}

// --- Platform user session helpers ------------------------------------------

const PLATFORM_COOKIE = 'sc_platform';
const PLATFORM_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface PlatformSession {
  typ: 'platform';
  /** PlatformUser id — the source of truth is re-read from the DB each request. */
  userId: string;
  iat: number;
  exp: number;
}

/**
 * Create a platform session token. `ttlSeconds` overrides the built-in default
 * so the admin-configured session timeout (Settings → Authentication, via
 * getAuthRuntimeConfig) is honoured; omitting it preserves the legacy 8h TTL.
 */
export function createPlatformSessionToken(input: {
  userId: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const ttl =
    input.ttlSeconds && input.ttlSeconds > 0
      ? input.ttlSeconds
      : PLATFORM_TTL_SECONDS;
  const session: PlatformSession = {
    typ: 'platform',
    userId: input.userId,
    iat: now,
    exp: now + ttl,
  };
  return signSession(session);
}

/** Read and validate the current platform session from cookies (or null). */
export function getPlatformSession(): PlatformSession | null {
  const token = cookies().get(PLATFORM_COOKIE)?.value;
  const session = verifySession<PlatformSession>(token);
  if (!session || session.typ !== 'platform') return null;
  if (session.exp * 1000 < Date.now()) return null;
  return session;
}

export function setPlatformSessionCookie(
  token: string,
  maxAgeSeconds?: number,
): void {
  cookies().set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge:
      maxAgeSeconds && maxAgeSeconds > 0 ? maxAgeSeconds : PLATFORM_TTL_SECONDS,
  });
}

export function clearPlatformSessionCookie(): void {
  cookies().delete(PLATFORM_COOKIE);
}
