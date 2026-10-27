// Admin authentication: local accounts (username + password, default) and
// optional OpenID Connect. Both can be active at the same time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { auth } from 'express-openid-connect';
import { DATA_DIR } from './config.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const list = (k) => env(k).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COOKIE = 'mm_auth';
const SESSION_DAYS = 7;

function sessionSecret() {
  if (env('SESSION_SECRET')) return env('SESSION_SECRET');
  // Persist a generated secret so sessions survive restarts.
  const file = path.join(DATA_DIR, '.session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export const oidcEnabled = Boolean(env('OIDC_ISSUER_URL') && env('OIDC_CLIENT_ID'));
export const localEnabled = env('LOCAL_LOGIN', 'true') !== 'false';
const SECRET = sessionSecret();

// ---- local accounts -------------------------------------------------------------
function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')).users || [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(actual, expected);
}

export function validateCredentials(username, password) {
  if (!/^[\w.@-]{2,64}$/.test(username || '')) return 'Username: 2–64 characters (letters, digits, . _ - @)';
  if (typeof password !== 'string' || password.length < 8) return 'Password: at least 8 characters';
  return null;
}

export function setPassword(username, password) {
  const users = readUsers().filter((u) => u.username.toLowerCase() !== username.toLowerCase());
  users.push({ username, hash: hashPassword(password), updatedAt: new Date().toISOString() });
  writeUsers(users);
}

export const hasLocalUsers = () => readUsers().length > 0;

// Optional bootstrap from the environment (ADMIN_USERNAME / ADMIN_PASSWORD),
// only used while no account exists yet.
function bootstrapFromEnv() {
  if (!localEnabled || hasLocalUsers() || !env('ADMIN_PASSWORD')) return;
  const username = env('ADMIN_USERNAME', 'admin');
  const err = validateCredentials(username, env('ADMIN_PASSWORD'));
  if (err) return console.warn(`[auth] ADMIN_PASSWORD ignored – ${err}`);
  setPassword(username, env('ADMIN_PASSWORD'));
  console.log(`[auth] created admin account "${username}" from ADMIN_PASSWORD – you can remove it from .env now`);
}

// First-run setup: whoever opens /login first needs this code from the server log.
let setupCode = null;
function announceSetup() {
  if (!localEnabled || hasLocalUsers()) return;
  setupCode = env('SETUP_CODE') || crypto.randomBytes(4).toString('hex').toUpperCase();
  console.log(`[auth] no admin account yet – open /login and use setup code ${setupCode} (or run: docker compose exec magicmirror node src/cli.js passwd admin)`);
}

// ---- signed session cookie ------------------------------------------------------
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
// Binding the session to the password hash logs out other sessions on password change.
const fingerprint = (user) => sign(user.hash).slice(0, 12);

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSession(req, res, user) {
  const payload = Buffer.from(JSON.stringify({ u: user.username, f: fingerprint(user), exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
  const secure = req.secure ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

function clearSession(res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function localUser(req) {
  if (!localEnabled) return null;
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || sig.length !== sign(payload).length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(payload)))) return null;
  try {
    const { u, f, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const user = readUsers().find((x) => x.username === u);
    if (!user || exp < Date.now() || f !== fingerprint(user)) return null;
    return user;
  } catch {
    return null;
  }
}

// ---- brute-force protection -------------------------------------------------------
const failures = new Map();
function lockedFor(ip) {
  const f = failures.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.count - 5)) * 1000;
  failures.set(ip, f);
}

function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  const allowedHosts = [req.get('host'), req.get('x-forwarded-host'), env('BASE_URL') && new URL(env('BASE_URL')).host].filter(Boolean);
  try {
    return allowedHosts.includes(new URL(origin).host);
  } catch {
    return false;
  }
}

// ---- OIDC ---------------------------------------------------------------------------
function isAllowed(user) {
  const emails = list('OIDC_ALLOWED_EMAILS');
  const groups = list('OIDC_ALLOWED_GROUPS');
  if (!emails.length && !groups.length) return true;
  if (emails.length && user.email && emails.includes(String(user.email).toLowerCase())) return true;
  if (groups.length) {
    const claim = user[env('OIDC_GROUPS_CLAIM', 'groups')];
    const userGroups = (Array.isArray(claim) ? claim : claim ? [claim] : []).map((g) => String(g).toLowerCase());
    if (userGroups.some((g) => groups.includes(g))) return true;
  }
  return false;
}

// Who is signed in? { name, email, method } or null; `denied` for OIDC users outside the allow-list.
function currentUser(req) {
  const local = localUser(req);
  if (local) return { name: local.username, email: '', method: 'local' };
  if (oidcEnabled && req.oidc?.isAuthenticated()) {
    const u = req.oidc.user;
    const user = { name: u.name || u.preferred_username || u.email || u.sub, email: u.email || '', method: 'oidc' };
    return isAllowed(u) ? user : { ...user, denied: true };
  }
  return null;
}

export function setupAuth(app) {
  bootstrapFromEnv();
  announceSetup();
  if (oidcEnabled) {
    const baseURL = env('BASE_URL', `http://localhost:${env('PORT', '8080')}`);
    const clientSecret = env('OIDC_CLIENT_SECRET');
    app.use(
      auth({
        issuerBaseURL: env('OIDC_ISSUER_URL'),
        baseURL,
        clientID: env('OIDC_CLIENT_ID'),
        ...(clientSecret ? { clientSecret } : { clientAuthMethod: 'none' }),
        secret: SECRET,
        authRequired: false,
        attemptSilentLogin: false,
        idpLogout: env('OIDC_IDP_LOGOUT', 'false') === 'true',
        authorizationParams: { response_type: 'code', scope: env('OIDC_SCOPE', 'openid profile email') },
        routes: { login: false, logout: false, callback: '/auth/callback', postLogoutRedirect: '/login' },
        session: { name: 'mm_session', rolling: true, rollingDuration: 24 * 3600, absoluteDuration: SESSION_DAYS * 24 * 3600 },
      }),
    );
    app.get('/auth/login', (req, res) => res.oidc.login({ returnTo: safeNext(req.query.next) }));
    console.log(`[auth] OIDC enabled (issuer ${env('OIDC_ISSUER_URL')}, callback ${baseURL}/auth/callback)`);
  }
  if (!oidcEnabled && !localEnabled) console.warn('[auth] LOCAL_LOGIN=false and no OIDC configured – admin panel is locked.');

  app.get('/auth/logout', (req, res) => {
    clearSession(res);
    if (oidcEnabled && req.oidc?.isAuthenticated()) return res.oidc.logout({ returnTo: '/login' });
    res.redirect('/login');
  });

  const api = express.Router();
  api.use(express.json({ limit: '10kb' }));
  api.use((req, res, next) => (req.method === 'GET' || sameOrigin(req) ? next() : res.status(403).json({ error: 'Invalid origin' })));

  api.get('/info', (req, res) => {
    const user = currentUser(req);
    res.json({ oidc: oidcEnabled, local: localEnabled, setup: Boolean(setupCode) && !hasLocalUsers(), user: user && !user.denied ? user : null });
  });

  api.post('/login', (req, res) => {
    if (!localEnabled) return res.status(404).json({ error: 'Password login is disabled' });
    const wait = lockedFor(req.ip);
    if (wait) return res.status(429).json({ error: 'Too many attempts – try again in {s} s', params: { s: wait } });
    const { username = '', password = '' } = req.body || {};
    const user = readUsers().find((u) => u.username.toLowerCase() === String(username).toLowerCase());
    // Always run scrypt so response times do not reveal unknown usernames.
    const ok = verifyPassword(String(password), user?.hash || hashPassword('dummy-password'));
    if (!user || !ok) {
      recordFailure(req.ip);
      console.warn(`[auth] failed login for "${String(username).slice(0, 64)}" from ${req.ip}`);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    failures.delete(req.ip);
    setSession(req, res, user);
    res.json({ ok: true });
  });

  api.post('/setup', (req, res) => {
    if (!localEnabled || hasLocalUsers() || !setupCode) return res.status(409).json({ error: 'An admin account already exists' });
    const wait = lockedFor(req.ip);
    if (wait) return res.status(429).json({ error: 'Too many attempts – try again in {s} s', params: { s: wait } });
    const { code = '', username = '', password = '' } = req.body || {};
    if (String(code).trim().toUpperCase() !== setupCode) {
      recordFailure(req.ip);
      return res.status(403).json({ error: 'Wrong setup code – see the server log' });
    }
    const err = validateCredentials(username, password);
    if (err) return res.status(400).json({ error: err });
    setPassword(username, password);
    setupCode = null;
    console.log(`[auth] admin account "${username}" created via setup`);
    setSession(req, res, readUsers().find((u) => u.username === username));
    res.json({ ok: true });
  });

  app.use('/api/auth', api);
}

const safeNext = (next) => (typeof next === 'string' && /^\/(?!\/)/.test(next) ? next : '/admin/');

// Guard for admin pages (redirect to /login) and admin APIs (401/403 JSON).
export function requireAdmin({ api = false } = {}) {
  return (req, res, next) => {
    if (!oidcEnabled && !localEnabled) {
      const msg = 'Admin panel disabled: enable LOCAL_LOGIN or configure OIDC.';
      return api ? res.status(503).json({ error: msg }) : res.status(503).type('text').send(msg);
    }
    const user = currentUser(req);
    if (!user) {
      return api ? res.status(401).json({ error: 'Not signed in' }) : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    if (user.denied) {
      const msg = `No access for ${user.email || user.name}.`;
      return api ? res.status(403).json({ error: msg }) : res.status(403).type('html').send(`<p>${msg.replace(/</g, '&lt;')}</p><p><a href="/auth/logout">Sign out</a></p>`);
    }
    // CSRF hardening: state-changing requests must come from our own origin.
    if (api && req.method !== 'GET' && !sameOrigin(req)) return res.status(403).json({ error: 'Invalid origin' });
    req.adminUser = user;
    next();
  };
}

// Change the signed-in local user's password (admin API).
export function changePassword(req, res) {
  if (req.adminUser?.method !== 'local') return res.status(400).json({ error: 'Only local accounts have a password' });
  const { current = '', password = '' } = req.body || {};
  const user = readUsers().find((u) => u.username === req.adminUser.name);
  if (!user || !verifyPassword(String(current), user.hash)) return res.status(403).json({ error: 'Current password is wrong' });
  const err = validateCredentials(user.username, password);
  if (err) return res.status(400).json({ error: err });
  setPassword(user.username, password);
  setSession(req, res, readUsers().find((u) => u.username === user.username));
  res.json({ ok: true });
}
