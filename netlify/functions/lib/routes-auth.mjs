import crypto from 'node:crypto';
import {
  allowedEmail,
  bool,
  clean,
  generateTotpSecret,
  hashPassword,
  normalizeEmail,
  now,
  publicUser,
  sha256,
  uid,
  validatePassword,
  verifyPassword,
  verifyTotp,
} from './domain.mjs';
import { mutateAuth, readAuth } from './store.mjs';
import {
  authenticate,
  authStatePayload,
  clearSessionResponse,
  clientIp,
  createSession,
  enforceRateLimit,
  json,
  logoutSession,
  needUser,
  resetRateLimit,
  sessionResponse,
} from './security.mjs';
import { emailConfigured, resetLink, sendEmail, verificationLink } from './notify.mjs';
import { recordAudit } from './workspace.mjs';

const verificationRequired = () => process.env.EMAIL_VERIFICATION_REQUIRED !== 'false';

function newVerificationToken(auth, userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  auth.verificationTokens[sha256(raw)] = { userId, createdAt: now(), expiresAt: new Date(Date.now() + 24 * 3600e3).toISOString() };
  return raw;
}

function newResetToken(auth, userId) {
  const raw = crypto.randomBytes(32).toString('hex');
  auth.resetTokens[sha256(raw)] = { userId, createdAt: now(), expiresAt: new Date(Date.now() + 60 * 60e3).toISOString() };
  return raw;
}

async function deliverVerification(user, rawToken) {
  const link = verificationLink(rawToken, user.email);
  if (!link || !emailConfigured()) return false;
  await sendEmail({
    to: user.email,
    subject: 'Verify your Call Center Hub account',
    text: `Verify your email address to activate your account: ${link}`,
    html: `<p>Verify your email address to activate your Call Center Hub account.</p><p><a href="${link}">Verify email address</a></p>`,
  });
  return true;
}

async function deliverReset(user, rawToken) {
  const link = resetLink(rawToken, user.email);
  if (!link || !emailConfigured()) return false;
  await sendEmail({
    to: user.email,
    subject: 'Reset your Call Center Hub password',
    text: `Reset your password using this one-time link: ${link}`,
    html: `<p>Use this one-time link to reset your Call Center Hub password.</p><p><a href="${link}">Reset password</a></p><p>This link expires in 60 minutes.</p>`,
  });
  return true;
}

export async function handleAuth(req, path) {
  const ip = clientIp(req);

  if (req.method === 'POST' && path === 'auth/signup') {
    await enforceRateLimit('signup', ip, 6, 60 * 60e3, 60 * 60e3);
    const body = await req.json();
    if (clean(body.website, 100)) return json({ ok: true, message: 'Account created.' }, 201); // honeypot
    const name = clean(body.name, 120);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (name.length < 2 || !email.includes('@')) return json({ error: 'Enter a valid name and email.' }, 400);
    if (!allowedEmail(email)) return json({ error: 'This email domain is not allowed to register.' }, 403);
    if (!validatePassword(password)) return json({ error: 'Password must be at least 10 characters and include a letter and a number.' }, 400);

    let createdUser;
    let rawVerification = '';
    const { result } = await mutateAuth(auth => {
      const existing = auth.users.find(user => user.email === email);
      const isFirst = auth.users.filter(user => user.status !== 'invited').length === 0;
      const bootstrap = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || '');

      if (existing && existing.status !== 'invited') throw Object.assign(new Error('An account already exists for this email.'), { status: 409 });
      if (isFirst && bootstrap && email !== bootstrap) {
        throw Object.assign(new Error('The initial administrator account must use the configured bootstrap email.'), { status: 403 });
      }

      const role = isFirst ? 'admin' : (existing?.role || 'viewer');
      const emailVerifiedAt = isFirst ? now() : (verificationRequired() ? null : now());
      const status = isFirst ? 'active' : (bool(process.env.REQUIRE_ADMIN_APPROVAL) ? 'pending' : 'active');
      const user = existing || { id: uid(), email, createdAt: now(), groupIds: [] };
      Object.assign(user, {
        name,
        email,
        passwordHash: hashPassword(password),
        role,
        status,
        emailVerifiedAt,
        mfa: user.mfa || { enabled: false },
        groupIds: user.groupIds || [],
        lastLoginAt: null,
      });
      if (!existing) auth.users.push(user);
      if (existing) {
        existing.invitedAt = existing.invitedAt || existing.createdAt;
        existing.claimedAt = now();
      }
      if (!emailVerifiedAt) rawVerification = newVerificationToken(auth, user.id);
      createdUser = user;
      return { user, isFirst };
    });

    let delivered = false;
    if (rawVerification) delivered = await deliverVerification(createdUser, rawVerification).catch(() => false);
    await recordAudit('registered', 'users', createdUser.email, createdUser, createdUser.status === 'pending' ? 'Pending approval' : 'Account created');

    let message = 'Account created.';
    if (!createdUser.emailVerifiedAt) {
      message = delivered
        ? 'Account created. Check your email for a verification link.'
        : 'Account created. Email verification is required. An Admin can verify your email if email delivery is not configured.';
    } else if (createdUser.status === 'pending') {
      message = 'Account created and awaiting administrator approval.';
    } else {
      message = 'Account created. You can sign in.';
    }
    return json({ ok: true, status: createdUser.status, role: createdUser.role, emailVerified: Boolean(createdUser.emailVerifiedAt), message }, 201);
  }

  if (req.method === 'POST' && path === 'auth/verify-email') {
    const body = await req.json();
    const email = normalizeEmail(body.email);
    const rawToken = String(body.token || '');
    if (!email || !rawToken) return json({ error: 'Verification link is incomplete.' }, 400);
    const tokenHash = sha256(rawToken);
    const { result } = await mutateAuth(auth => {
      const token = auth.verificationTokens[tokenHash];
      const user = auth.users.find(item => item.email === email);
      if (!token || !user || token.userId !== user.id || new Date(token.expiresAt) < new Date()) {
        throw Object.assign(new Error('This verification link is invalid or expired.'), { status: 400 });
      }
      user.emailVerifiedAt = now();
      delete auth.verificationTokens[tokenHash];
      if (!bool(process.env.REQUIRE_ADMIN_APPROVAL) && user.status === 'pending') user.status = 'active';
      return user;
    });
    await recordAudit('verified email', 'users', result.email, result, 'Email verification completed');
    return json({ ok: true, message: result.status === 'active' ? 'Email verified. You can sign in.' : 'Email verified. Your account is awaiting administrator approval.' });
  }

  if (req.method === 'POST' && path === 'auth/resend-verification') {
    await enforceRateLimit('verify-resend', ip, 4, 60 * 60e3, 30 * 60e3);
    const body = await req.json();
    const email = normalizeEmail(body.email);
    let user;
    let raw = '';
    await mutateAuth(auth => {
      user = auth.users.find(item => item.email === email);
      if (!user || user.emailVerifiedAt) return;
      for (const [hash, token] of Object.entries(auth.verificationTokens)) if (token.userId === user.id) delete auth.verificationTokens[hash];
      raw = newVerificationToken(auth, user.id);
    });
    if (user && raw) await deliverVerification(user, raw).catch(() => false);
    return json({ ok: true, message: 'If that account needs verification and email delivery is configured, a new verification email has been sent.' });
  }

  if (req.method === 'POST' && path === 'auth/login') {
    const body = await req.json();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const rateIdentity = `${ip}:${email}`;
    await enforceRateLimit('login', rateIdentity, 5, 15 * 60e3, 30 * 60e3);
    const auth = await readAuth();
    const user = auth.users.find(item => item.email === email);
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) return json({ error: 'Incorrect email or password.' }, 401);
    if (verificationRequired() && !user.emailVerifiedAt) return json({ error: 'Verify your email address before signing in.', code: 'EMAIL_UNVERIFIED' }, 403);
    if (user.status === 'pending') return json({ error: 'Your account is awaiting administrator approval.' }, 403);
    if (user.status !== 'active') return json({ error: 'This account is not active.' }, 403);
    await resetRateLimit('login', rateIdentity);

    if (user.mfa?.enabled && user.mfa.secret) {
      const challenge = crypto.randomBytes(24).toString('hex');
      await mutateAuth(state => {
        state.mfaChallenges[sha256(challenge)] = { userId: user.id, createdAt: now(), expiresAt: new Date(Date.now() + 5 * 60e3).toISOString() };
      });
      return json({ mfaRequired: true, challenge, email: user.email });
    }

    const session = await createSession(user.id);
    await mutateAuth(state => {
      const current = state.users.find(item => item.id === user.id);
      if (current) current.lastLoginAt = now();
    });
    return sessionResponse({ ok: true, user: publicUser(user), expiresAt: session.expiresAt }, session.rawToken, session.csrfToken, session.expiresAt);
  }

  if (req.method === 'POST' && path === 'auth/mfa-login') {
    await enforceRateLimit('mfa', ip, 8, 10 * 60e3, 15 * 60e3);
    const body = await req.json();
    const challengeHash = sha256(body.challenge || '');
    let user;
    await mutateAuth(auth => {
      const challenge = auth.mfaChallenges[challengeHash];
      if (!challenge || new Date(challenge.expiresAt) < new Date()) throw Object.assign(new Error('MFA challenge expired. Sign in again.'), { status: 400 });
      user = auth.users.find(item => item.id === challenge.userId);
      if (!user?.mfa?.enabled || !verifyTotp(user.mfa.secret, body.code)) throw Object.assign(new Error('Incorrect authentication code.'), { status: 401 });
      delete auth.mfaChallenges[challengeHash];
      user.lastLoginAt = now();
    });
    const session = await createSession(user.id);
    return sessionResponse({ ok: true, user: publicUser(user), expiresAt: session.expiresAt }, session.rawToken, session.csrfToken, session.expiresAt);
  }

  if (req.method === 'POST' && path === 'auth/logout') {
    const { tokenHash } = await authenticate(req);
    await logoutSession(tokenHash);
    return clearSessionResponse();
  }

  if (req.method === 'POST' && path === 'auth/request-reset') {
    await enforceRateLimit('reset-request', ip, 5, 60 * 60e3, 30 * 60e3);
    const body = await req.json();
    const email = normalizeEmail(body.email);
    let user;
    let raw = '';
    await mutateAuth(auth => {
      user = auth.users.find(item => item.email === email);
      if (!user) return;
      for (const [hash, token] of Object.entries(auth.resetTokens)) if (token.userId === user.id) delete auth.resetTokens[hash];
      raw = newResetToken(auth, user.id);
      if (!emailConfigured() && !auth.passwordResetRequests.some(item => item.userId === user.id && item.status === 'open')) {
        auth.passwordResetRequests.unshift({ id: uid(), userId: user.id, email, status: 'open', createdAt: now() });
      }
    });
    if (user && raw) await deliverReset(user, raw).catch(() => false);
    return json({ ok: true, message: emailConfigured() ? 'If that account exists, a password-reset link has been sent.' : 'If that account exists, an administrator can now reset its password.' });
  }

  if (req.method === 'POST' && path === 'auth/reset-password') {
    await enforceRateLimit('reset-submit', ip, 6, 30 * 60e3, 30 * 60e3);
    const body = await req.json();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    if (!validatePassword(password)) return json({ error: 'Password must be at least 10 characters and include a letter and a number.' }, 400);
    const tokenHash = sha256(body.token || '');
    let user;
    await mutateAuth(auth => {
      const token = auth.resetTokens[tokenHash];
      user = auth.users.find(item => item.email === email);
      if (!token || !user || token.userId !== user.id || new Date(token.expiresAt) < new Date()) throw Object.assign(new Error('This reset link is invalid or expired.'), { status: 400 });
      user.passwordHash = hashPassword(password);
      for (const [sessionHash, session] of Object.entries(auth.sessions)) if (session.userId === user.id) delete auth.sessions[sessionHash];
      delete auth.resetTokens[tokenHash];
      for (const request of auth.passwordResetRequests) if (request.userId === user.id && request.status === 'open') {
        request.status = 'resolved';
        request.resolvedAt = now();
      }
    });
    await recordAudit('reset password', 'users', user.email, user, 'Self-service password reset');
    return json({ ok: true, message: 'Password updated. You can sign in.' });
  }

  if (path === 'auth/me' || path === 'me') {
    const { user } = await authenticate(req);
    needUser(user);
    return json(authStatePayload(user));
  }

  if (path === 'auth/mfa/setup' && req.method === 'POST') {
    const { user } = await authenticate(req, { requireCsrf: true });
    needUser(user);
    const secret = generateTotpSecret();
    await mutateAuth(auth => {
      const current = auth.users.find(item => item.id === user.id);
      current.mfa ||= {};
      current.mfa.pendingSecret = secret;
      current.mfa.pendingCreatedAt = now();
    });
    const issuer = 'Zipline Call Center Hub';
    const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6`;
    return json({ secret, uri });
  }

  if (path === 'auth/mfa/enable' && req.method === 'POST') {
    const { user } = await authenticate(req, { requireCsrf: true });
    needUser(user);
    const body = await req.json();
    await mutateAuth(auth => {
      const current = auth.users.find(item => item.id === user.id);
      const secret = current?.mfa?.pendingSecret;
      if (!secret || !verifyTotp(secret, body.code)) throw Object.assign(new Error('Incorrect authentication code.'), { status: 400 });
      current.mfa = { enabled: true, secret, enabledAt: now() };
    });
    await recordAudit('enabled MFA', 'users', user.email, user);
    return json({ ok: true });
  }

  if (path === 'auth/mfa/disable' && req.method === 'POST') {
    const { user } = await authenticate(req, { requireCsrf: true });
    needUser(user);
    const body = await req.json();
    await mutateAuth(auth => {
      const current = auth.users.find(item => item.id === user.id);
      if (!verifyPassword(String(body.password || ''), current.passwordHash)) throw Object.assign(new Error('Password is incorrect.'), { status: 401 });
      if (current.mfa?.enabled && !verifyTotp(current.mfa.secret, body.code)) throw Object.assign(new Error('Authentication code is incorrect.'), { status: 400 });
      current.mfa = { enabled: false };
    });
    await recordAudit('disabled MFA', 'users', user.email, user);
    return json({ ok: true });
  }

  return null;
}
