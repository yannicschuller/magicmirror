import { translator, langOf } from '/shared/i18n.js';

const $ = (s) => document.querySelector(s);
let lang = langOf(navigator.language);
try { lang = localStorage.getItem('mm-admin-lang') || lang; } catch {}
const t = translator(lang);
document.documentElement.lang = lang;
document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));

const next = new URLSearchParams(location.search).get('next');
const target = next && /^\/(?!\/)/.test(next) ? next : '/admin/';

function showError(json) {
  const el = $('#error');
  el.textContent = t(json.error || 'Sign-in failed', json.params);
  el.hidden = false;
}

async function post(url, form) {
  const button = form.querySelector('button');
  button.disabled = true;
  $('#error').hidden = true;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return location.replace(target);
    showError(json);
  } catch {
    showError({ error: 'Server unreachable' });
  } finally {
    button.disabled = false;
  }
}

$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  post('/api/auth/login', e.target);
});
$('#setup').addEventListener('submit', (e) => {
  e.preventDefault();
  post('/api/auth/setup', e.target);
});

const info = await fetch('/api/auth/info', { cache: 'no-store' }).then((r) => r.json());
if (info.user) location.replace(target);
$('#subtitle').textContent = t(info.setup ? 'First start – set up your admin account' : 'Sign in to the admin panel');
$('#login').hidden = !info.local || info.setup;
$('#setup').hidden = !info.setup;
$('#sso').hidden = !info.oidc;
$('#sso').href = `/auth/login?next=${encodeURIComponent(target)}`;
$('#divider').hidden = !(info.oidc && info.local);
$('#disabled').hidden = info.local || info.oidc;
if (!info.local && info.oidc && !new URLSearchParams(location.search).has('error')) $('#sso').classList.add('primary');
