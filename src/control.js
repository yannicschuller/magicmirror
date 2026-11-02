// Control API for home automation (Homey, Apple Shortcuts, Home Assistant …):
//   GET or POST /api/control/<command>   Authorization: Bearer <token>   (or ?token=<token>)
// Commands: screen/on|off|night|auto, page/next|prev|hold|resume|<page id or name>,
// notify, reload, power/shutdown|reboot, status. The token is set in the admin (General → System);
// without one the API is off.
// Also runs the daily shutdown / restart from the settings.
import crypto from 'node:crypto';
import express from 'express';
import { dateKey } from './util.js';

const SCREEN = { on: 'on', off: 'off', night: 'night', auto: null };
const minutesOf = (q) => Math.min(24 * 60, Math.max(0, Number(q.minutes) || 0));

function tokenOk(given, expected) {
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function controlRouter({ getConfig, getDisplay, setDisplayOverride, broadcast, clientCount, power, notify }) {
  const r = express.Router();
  r.use(express.json({ limit: '16kb' }));

  r.use((req, res, next) => {
    const expected = getConfig().general.controlToken;
    if (!expected) return res.status(404).json({ ok: false, error: 'The control API is off – set a token in the admin (General → System)' });
    const header = String(req.get('authorization') || '');
    const given = header.match(/^Bearer\s+(.+)$/i)?.[1] || req.query.token;
    if (!tokenOk(given, expected)) return res.status(401).json({ ok: false, error: 'Invalid token' });
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.all('/status', (req, res) => {
    const cfg = getConfig();
    const d = getDisplay(cfg);
    res.json({ ok: true, screen: d.mode, override: d.override,  mirrors: clientCount(), pages: cfg.pages.map((p) => ({ id: p.id, name: p.name })) });
  });

  r.all('/screen/:mode', (req, res) => {
    const { mode } = req.params;
    if (!(mode in SCREEN)) return res.status(400).json({ ok: false, error: 'Use on, off, night or auto' });
    setDisplayOverride(SCREEN[mode], minutesOf(req.query));
    res.json({ ok: true, display: getDisplay(getConfig()) });
  });

  r.all('/page/:target', (req, res) => {
    const { target } = req.params;
    if (['next', 'prev', 'hold', 'resume'].includes(target)) {
      broadcast('nav', { action: target, minutes: minutesOf(req.query) || (target === 'hold' ? 60 : 0) });
      return res.json({ ok: true, mirrors: clientCount() });
    }
    const want = target.toLowerCase();
    const page = getConfig().pages.find((p) => p.id.toLowerCase() === want || String(p.name || '').toLowerCase() === want);
    if (!page) return res.status(404).json({ ok: false, error: 'Page not found' });
    broadcast('page', { page: page.id });
    res.json({ ok: true, page: page.id, mirrors: clientCount() });
  });

  // Notification card: ?title=…&message=…&level=info|success|warn|alert&duration=15&wake=true
  // (or the same as JSON body).
  r.all('/notify', (req, res) => {
    const n = notify({ ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) });
    if (!n) return res.status(400).json({ ok: false, error: 'title or message is required' });
    res.json({ ok: true, id: n.id, mirrors: clientCount() });
  });

  r.all('/reload', (req, res) => {
    broadcast('reload');
    res.json({ ok: true, mirrors: clientCount() });
  });

  r.all('/power/:action', async (req, res) => {
    const { action } = req.params;
    if (!['shutdown', 'reboot'].includes(action)) return res.status(400).json({ ok: false, error: 'Use shutdown or reboot' });
    try {
      res.json(await power(action));
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  r.use((req, res) => res.status(404).json({ ok: false, error: 'Unknown command' }));
  return r;
}

// "23:30" → minutes after midnight, or null.
export function parseTime(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}

// Which scheduled power action is due now (once per day each), or null.
export function duePowerAction(general, now, done) {
  const tz = general.timezone || 'Europe/Berlin';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  const minute = +parts.hour * 60 + +parts.minute;
  const day = dateKey(now, tz);
  for (const [key, action] of [['shutdownAt', 'shutdown'], ['rebootAt', 'reboot']]) {
    const at = parseTime(general[key]);
    // a window of 5 minutes, so a busy moment does not skip the day
    if (at !== null && minute >= at && minute < at + 5 && done[action] !== day) return { action, day };
  }
  return null;
}

export function startPowerSchedule(getConfig, power) {
  const done = {};
  // nothing right after a start: a restart at 04:30 must not repeat when the Pi is back at 04:31
  const started = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - started < 6 * 60000) return;
    const due = duePowerAction(getConfig().general, new Date(), done);
    if (!due) return;
    done[due.action] = due.day;
    console.log(`[power] scheduled ${due.action}`);
    try {
      await power(due.action);
    } catch (err) {
      console.warn(`[power] ${err.message}`);
    }
  }, 30000);
  timer.unref();
}
