import crypto from 'node:crypto';
import { authStore, mutateAuth, rateStore, readAuth } from './store.mjs';
import { now, publicUser, sha256, sessionDays } from './domain.mjs';

const SESSION_COOKIE = 'ccc_session';
const CSRF_COOKIE = 'ccc_csrf';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

export function clientIp(req) {
  return (req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

export function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.get('cookie') || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Strict'}`);
  return parts.join('; ');
}

export function sessionResponse(payload, sessionToken, csrfToken, expiresAt, status = 200) {
  const headers = new Headers(JSON_HEADERS);
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, sessionToken, { httpOnly: true, maxAge: seconds }));
  headers.append('Set-Cookie', cookie(CSRF_COOKIE, csrfToken, { httpOnly: false, maxAge: seconds }));
  return new Response(JSON.stringify(payload), { status, headers });
}

export function clearSessionResponse(payload = { ok: true }) {
  const headers = new Headers(JSON_HEADERS);
  headers.append('Set-Cookie', cookie(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0 }));
  headers.append('Set-Cookie', cookie(CSRF_COOKIE, '', { httpOnly: false, maxAge: 0 }));
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

export async function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + sessionDays() * 864e5).toISOString();
  await mutateAuth(auth => {
    cleanupAuth(auth);
    auth.sessions[tokenHash] = { userId, csrfToken, createdAt: now(), expiresAt };
  });
  return { rawToken, csrfToken, expiresAt };
}

export function cleanupAuth(auth) {
  const timestamp = Date.now();
  for (const [token, session] of Object.entries(auth.sessions || {})) {
    if (new Date(session.expiresAt).getTime() < timestamp) delete auth.sessions[token];
  }
  for (const [token, record] of Object.entries(auth.verificationTokens || {})) {
    if (new Date(record.expiresAt).getTime() < timestamp) delete auth.verificationTokens[token];
  }
  for (const [token, record] of Object.entries(auth.resetTokens || {})) {
    if (new Date(record.expiresAt).getTime() < timestamp) delete auth.resetTokens[token];
  }
  for (const [token, record] of Object.entries(auth.mfaChallenges || {})) {
    if (new Date(record.expiresAt).getTime() < timestamp) delete auth.mfaChallenges[token];
  }
  for (const [token, record] of Object.entries(auth.quizSessions || {})) {
    if (new Date(record.expiresAt).getTime() < timestamp) delete auth.quizSessions[token];
  }
}

export async function authenticate(req, { requireCsrf = false } = {}) {
  const cookies = parseCookies(req);
  const rawToken = cookies[SESSION_COOKIE];
  if (!rawToken) return { auth: await readAuth(), user: null, session: null, tokenHash: null };
  const tokenHash = sha256(rawToken);
  const auth = await readAuth();
  cleanupAuth(auth);
  const session = auth.sessions?.[tokenHash];
  if (!session) return { auth, user: null, session: null, tokenHash: null };
  const user = auth.users.find(item => item.id === session.userId);
  if (!user || user.status !== 'active') return { auth, user: null, session: null, tokenHash: null };
  if (requireCsrf) {
    const header = req.headers.get('x-csrf-token') || '';
    const cookieValue = cookies[CSRF_COOKIE] || '';
    if (!header || !cookieValue || header !== cookieValue || header !== session.csrfToken) {
      throw Object.assign(new Error('Your security token expired. Refresh the page and try again.'), { status: 403 });
    }
  }
  return { auth, user, session, tokenHash };
}

export function needUser(user) {
  if (!user) throw Object.assign(new Error('Please sign in.'), { status: 401 });
}

export function needEditor(user) {
  needUser(user);
  if (!['editor', 'admin'].includes(user.role)) throw Object.assign(new Error('Editor access required.'), { status: 403 });
}

export function needAdmin(user) {
  needUser(user);
  if (user.role !== 'admin') throw Object.assign(new Error('Admin access required.'), { status: 403 });
}

export async function logoutSession(tokenHash) {
  if (!tokenHash) return;
  await mutateAuth(auth => {
    delete auth.sessions[tokenHash];
  });
}

export async function enforceRateLimit(scope, identity, limit, windowMs, lockoutMs = 0) {
  const store = rateStore();
  const key = `${scope}:${sha256(identity).slice(0, 40)}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stored = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const data = stored?.data ?? null;
    const etag = stored?.etag ?? null;
    const timestamp = Date.now();
    const record = data || { count: 0, windowStartedAt: timestamp, lockedUntil: 0 };
    if (record.lockedUntil > timestamp) {
      const seconds = Math.ceil((record.lockedUntil - timestamp) / 1000);
      throw Object.assign(new Error(`Too many attempts. Try again in ${seconds} seconds.`), { status: 429, retryAfter: seconds });
    }
    if (timestamp - record.windowStartedAt >= windowMs) {
      record.count = 0;
      record.windowStartedAt = timestamp;
    }
    record.count += 1;
    if (record.count > limit && lockoutMs) record.lockedUntil = timestamp + lockoutMs;
    const write = await store.setJSON(key, record, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (!write.modified) continue;
    if (record.count > limit) {
      const seconds = lockoutMs ? Math.ceil(lockoutMs / 1000) : Math.ceil((windowMs - (timestamp - record.windowStartedAt)) / 1000);
      throw Object.assign(new Error('Too many requests. Please try again later.'), { status: 429, retryAfter: seconds });
    }
    return { remaining: Math.max(0, limit - record.count) };
  }
  throw Object.assign(new Error('Rate-limit check conflicted. Please retry.'), { status: 409 });
}

export async function resetRateLimit(scope, identity) {
  const key = `${scope}:${sha256(identity).slice(0, 40)}`;
  await rateStore().delete(key);
}

export function authStatePayload(user) {
  return { user: publicUser(user) };
}
