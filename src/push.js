// Push endpoint for data the mirror cannot fetch itself – e.g. Apple Reminders,
// sent by an Apple Shortcuts automation:
//   POST /api/push/tasks   Authorization: Bearer <token from the tasks module>
// Body: plain text (one reminder per line, optionally "title | due | priority")
// or JSON (array of strings/objects, or { items: [...] }).
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { DATA_DIR } from './config.js';

const PUSH_DIR = path.join(DATA_DIR, 'push');
const MAX_ITEMS = 500;
const memory = new Map();

const file = (moduleId) => path.join(PUSH_DIR, `tasks-${moduleId.replace(/[^\w-]/g, '_')}.json`);

const PRIORITY_WORDS = { high: 3, hoch: 3, '!!!': 3, medium: 2, mittel: 2, '!!': 2, low: 1, niedrig: 1, '!': 1, none: 0, keine: 0 };

function parsePriority(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  // Apple/iCalendar priorities: 1 = high … 9 = low, 0 = none.
  if (Number.isFinite(n)) return n <= 0 ? 0 : n <= 4 ? 3 : n === 5 ? 2 : n <= 9 ? 1 : 0;
  return PRIORITY_WORDS[String(v).trim().toLowerCase()] ?? 0;
}

// "2026-10-28" → all-day; ISO date-time (as produced by "Format Date → ISO 8601") → instant.
function parseDue(v) {
  const s = String(v ?? '').trim();
  if (!s) return { due: null, allDay: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { due: s, allDay: true };
  const t = Date.parse(s);
  return Number.isFinite(t) ? { due: new Date(t).toISOString(), allDay: false } : { due: null, allDay: false };
}

const truthy = (v) => v === true || /^(true|yes|ja|1)$/i.test(String(v ?? '').trim());

function normalize(entry) {
  if (typeof entry === 'string') entry = { title: entry };
  if (!entry || typeof entry !== 'object') return null;
  if (truthy(entry.done ?? entry.completed ?? entry.isCompleted)) return null;
  const title = String(entry.title ?? entry.name ?? entry.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!title) return null;
  return { title, ...parseDue(entry.due ?? entry.dueDate ?? entry.date), priority: parsePriority(entry.priority) };
}

export function parseReminders(body) {
  let list;
  if (typeof body === 'string') {
    const text = body.trim();
    if (text.startsWith('[') || text.startsWith('{')) {
      try {
        return parseReminders(JSON.parse(text));
      } catch {
        // not JSON after all – treat as text
      }
    }
    // One reminder per line; optional "title | due | priority" (tab works too).
    list = text.split(/\r?\n/).map((line) => {
      const [title, due, priority] = line.split(/\s*[|\t]\s*/);
      return { title: title.replace(/^\s*[-•*◦○☐]\s*/, ''), due, priority };
    });
  } else if (Array.isArray(body)) {
    list = body;
  } else if (body && typeof body === 'object') {
    list = body.items ?? body.reminders ?? [];
  } else {
    list = [];
  }
  return list.map(normalize).filter(Boolean).slice(0, MAX_ITEMS);
}

function tokenMatches(given, expected) {
  if (!given || !expected) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function readPushedTasks(moduleId) {
  if (memory.has(moduleId)) return memory.get(moduleId);
  try {
    const data = JSON.parse(await fs.readFile(file(moduleId), 'utf8'));
    memory.set(moduleId, data);
    return data;
  } catch {
    return null;
  }
}

export function pushRouter(getConfig, onPush = () => {}) {
  const router = express.Router();
  router.use(express.text({ type: ['text/*', 'application/x-www-form-urlencoded'], limit: '256kb' }));
  router.use(express.json({ limit: '256kb' }));
  // Shortcuts may send the reminders as a file upload (octet-stream).
  router.use(express.text({ type: () => true, limit: '256kb' }));

  router.post('/tasks', async (req, res) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token;
    const mods = getConfig().modules.filter((m) => m.type === 'tasks' && m.settings.source === 'shortcuts' && tokenMatches(token, m.settings.pushToken));
    if (!mods.length) return res.status(401).json({ ok: false, error: 'Invalid token' });
    const items = parseReminders(req.body);
    const data = { receivedAt: new Date().toISOString(), items };
    await fs.mkdir(PUSH_DIR, { recursive: true });
    for (const m of mods) {
      memory.set(m.id, data);
      await fs.writeFile(file(m.id), JSON.stringify(data));
      onPush(m.id);
    }
    res.json({ ok: true, received: items.length });
  });
  return router;
}
