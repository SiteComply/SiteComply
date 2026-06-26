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

export function createWorkerSessionToken(input: {
  mobile: string;
  workerId?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const session: WorkerSession = {
    typ: 'worker',
    mobile: input.mobile,
    workerId: input.workerId,
    iat: now,
    exp: now + WORKER_TTL_SECONDS,
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
export function setWorkerSessionCookie(token: string): void {
  cookies().set(WORKER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: WORKER_TTL_SECONDS,
  });
}

export function clearWorkerSessionCookie(): void {
  cookies().delete(WORKER_COOKIE);
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
