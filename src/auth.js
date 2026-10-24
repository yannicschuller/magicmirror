import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { auth } from 'express-openid-connect';
import { DATA_DIR } from './config.js';

const env = (k, d = '') => (process.env[k] ?? d).trim();
const list = (k) => env(k).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

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

export function setupAuth(app) {
  if (!oidcEnabled) {
    console.warn('[auth] OIDC_ISSUER_URL / OIDC_CLIENT_ID fehlen – Admin-Panel ist gesperrt.');
    return;
  }
  const baseURL = env('BASE_URL', `http://localhost:${env('PORT', '8080')}`);
  const clientSecret = env('OIDC_CLIENT_SECRET');
  app.use(
    auth({
      issuerBaseURL: env('OIDC_ISSUER_URL'),
      baseURL,
      clientID: env('OIDC_CLIENT_ID'),
      ...(clientSecret ? { clientSecret } : { clientAuthMethod: 'none' }),
      secret: sessionSecret(),
      authRequired: false,
      attemptSilentLogin: false,
      idpLogout: env('OIDC_IDP_LOGOUT', 'false') === 'true',
      authorizationParams: { response_type: 'code', scope: env('OIDC_SCOPE', 'openid profile email') },
      routes: { login: '/auth/login', logout: '/auth/logout', callback: '/auth/callback', postLogoutRedirect: '/' },
      session: { name: 'mm_session', rolling: true, rollingDuration: 24 * 3600, absoluteDuration: 7 * 24 * 3600 },
    }),
  );
  console.log(`[auth] OIDC aktiv (Issuer ${env('OIDC_ISSUER_URL')}, Callback ${baseURL}/auth/callback)`);
}

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

// Guard for admin pages (redirect to login) and admin APIs (401/403 JSON).
export function requireAdmin({ api = false } = {}) {
  return (req, res, next) => {
    if (!oidcEnabled) {
      const msg = 'Admin-Panel deaktiviert: OIDC ist nicht konfiguriert (OIDC_ISSUER_URL, OIDC_CLIENT_ID).';
      return api ? res.status(503).json({ error: msg }) : res.status(503).type('text').send(msg);
    }
    if (!req.oidc.isAuthenticated()) {
      return api ? res.status(401).json({ error: 'Nicht angemeldet' }) : res.oidc.login({ returnTo: req.originalUrl });
    }
    if (!isAllowed(req.oidc.user)) {
      const msg = `Kein Zugriff für ${req.oidc.user.email || req.oidc.user.sub}.`;
      return api ? res.status(403).json({ error: msg }) : res.status(403).type('html').send(`<p>${msg.replace(/</g, '&lt;')}</p><p><a href="/auth/logout">Abmelden</a></p>`);
    }
    if (api && req.method !== 'GET') {
      // CSRF hardening: state-changing requests must come from our own origin.
      const origin = req.get('origin');
      const allowedHosts = [req.get('host'), req.get('x-forwarded-host'), env('BASE_URL') && new URL(env('BASE_URL')).host].filter(Boolean);
      if (origin && !allowedHosts.includes(new URL(origin).host)) return res.status(403).json({ error: 'Ungültige Herkunft' });
    }
    next();
  };
}
