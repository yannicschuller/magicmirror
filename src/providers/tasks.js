// Open to-dos from Todoist (unified API v1), a Home Assistant to-do entity or
// a CalDAV task collection. Every source is normalised to
//   { title, due: 'YYYY-MM-DD' | ISO instant | null, allDay, priority: 0–3 }
// where priority 3 is the most urgent.
import { createHash } from 'node:crypto';
import { fetchJson, fetchRaw, cached, dateKey } from '../util.js';
import { translator, langOf } from '../../public/shared/i18n.js';
import { readPushedTasks } from '../push.js';

// Errors carry their message id so provider() can translate them.
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}

const TTL = 60;
const hash = (...parts) => createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16);

// ---- time helpers --------------------------------------------------------------

// Offset (ms) of a time zone at a given instant.
function tzOffset(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

// Wall-clock time in a time zone → ISO instant.
export function zonedToIso(y, mo, d, h, mi, s, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz); // second pass for DST edges
  return new Date(t).toISOString();
}

// Generic due value: 'YYYY-MM-DD', ISO with Z/offset, or floating local time.
export function normalizeDue(value, timeZone) {
  if (!value) return { due: null, allDay: false };
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { due: s, allDay: true };
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!m) return { due: null, allDay: false };
  if (m[7]) {
    const t = Date.parse(s.replace(' ', 'T'));
    return Number.isFinite(t) ? { due: new Date(t).toISOString(), allDay: false } : { due: null, allDay: false };
  }
  return { due: zonedToIso(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), timeZone), allDay: false };
}

export function isOverdue(item, now, timeZone) {
  if (!item.due) return false;
  if (item.allDay) return item.due < dateKey(now, timeZone);
  return Date.parse(item.due) < now.getTime();
}

// ---- Todoist ----------------------------------------------------------------------

const TODOIST = 'https://api.todoist.com/api/v1';

async function todoistPaged(base, path, params, token) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const u = new URL(base + path);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    u.searchParams.set('limit', '200');
    if (cursor) u.searchParams.set('cursor', cursor);
    let data;
    try {
      data = await fetchJson(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      if (/HTTP 40[13]\b/.test(err.message)) throw fail('Todoist rejected the API token');
      throw err;
    }
    const list = Array.isArray(data) ? data : data.results || [];
    out.push(...list);
    cursor = Array.isArray(data) ? null : data.next_cursor;
    if (!cursor) break;
  }
  return out;
}

export async function todoistTasks(settings, timeZone, base = TODOIST) {
  const token = settings.todoistToken.trim();
  if (!token) throw fail('No Todoist API token configured');
  let projectId = '';
  const wanted = settings.todoistProject.trim();
  if (wanted) {
    const projects = await cached(`tasks:todoist-projects:${hash(base, token)}`, 3600, () => todoistPaged(base, '/projects', {}, token));
    const p = projects.find((x) => String(x.id) === wanted) || projects.find((x) => String(x.name).toLowerCase() === wanted.toLowerCase());
    if (!p) throw fail('Todoist project "{name}" not found', { name: wanted });
    projectId = String(p.id);
  }
  const filter = settings.todoistFilter.trim();
  let tasks = filter
    ? await todoistPaged(base, '/tasks/filter', { query: filter }, token)
    : await todoistPaged(base, '/tasks', { project_id: projectId }, token);
  if (filter && projectId) tasks = tasks.filter((t) => String(t.project_id) === projectId);
  return tasks
    .filter((t) => !t.checked && !t.is_deleted && !t.is_completed)
    .sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0))
    .map((t) => {
      const d = t.due ? normalizeDue(t.due.datetime || t.due.date, t.due.timezone || timeZone) : { due: null, allDay: false };
      return { title: String(t.content || '').trim(), ...d, priority: Math.max(0, Math.min(3, (Number(t.priority) || 1) - 1)) };
    });
}

// ---- Home Assistant ----------------------------------------------------------------

export async function haTasks(settings, timeZone) {
  const base = settings.haUrl.trim().replace(/\/+$/, '');
  const token = settings.haToken.trim();
  const entity = settings.haEntity.trim();
  if (!base || !token) throw fail('Home Assistant URL or token missing');
  if (!/^todo\.\w+$/.test(entity)) throw fail('Invalid to-do entity (e.g. todo.shopping_list)');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
  let res;
  try {
    res = await fetch(`${base}/api/services/todo/get_items?return_response`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ entity_id: entity, status: 'needs_action' }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw fail('Home Assistant not reachable ({reason})', { reason: err.cause?.code || err.message });
  }
  if (res.status === 401) throw fail('Home Assistant rejected the token (401)');
  if (res.ok) {
    const data = await res.json();
    const resp = data.service_response || data; // older/other shapes
    const list = resp?.[entity]?.items;
    if (!Array.isArray(list)) throw fail('No to-do items for {entity} in the Home Assistant response', { entity });
    return list
      .filter((i) => !i.status || i.status === 'needs_action')
      .map((i) => ({ title: String(i.summary || '').trim(), ...normalizeDue(i.due, timeZone), priority: 0 }));
  }
  // Fallback for Home Assistant versions without service responses: the
  // legacy shopping list API (only for the built-in shopping list).
  if (entity === 'todo.shopping_list') {
    try {
      const list = await fetchJson(`${base}/api/shopping_list`, { headers });
      if (Array.isArray(list)) return list.filter((i) => !i.complete).map((i) => ({ title: String(i.name || '').trim(), due: null, allDay: false, priority: 0 }));
    } catch {
      /* report the original error below */
    }
  }
  throw new Error(`HTTP ${res.status} from Home Assistant (todo.get_items)`);
}

// ---- CalDAV ----------------------------------------------------------------------------

// The strict query asks the server to skip tasks with a COMPLETED timestamp (a
// STATUS text-match would also drop tasks without any STATUS property); the
// STATUS/percentage check happens client-side either way.
const REPORT_BODY = (strict) => `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO">${strict ? '\n        <c:prop-filter name="COMPLETED"><c:is-not-defined/></c:prop-filter>' : ''}
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

const xmlDecode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

export function extractCalendarData(xml) {
  const out = [];
  const re = /<(?:[\w.-]+:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?calendar-data>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(xmlDecode(m[1]));
  return out;
}

const icsUnescape = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

// Parse all VTODOs of an iCalendar text (without recurrence expansion).
export function parseVtodos(ics, timeZone) {
  const lines = ics.replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const todos = [];
  let cur = null;
  let depth = 0; // nested components such as VALARM
  for (const line of lines) {
    if (/^BEGIN:VTODO$/i.test(line)) { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (/^END:VTODO$/i.test(line)) { todos.push(cur); cur = null; continue; }
    if (/^BEGIN:/i.test(line)) { depth++; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue;
    const m = line.match(/^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    const params = m[2];
    const value = m[3];
    if (name === 'SUMMARY') cur.summary = icsUnescape(value);
    else if (name === 'STATUS') cur.status = value.trim().toUpperCase();
    else if (name === 'PRIORITY') cur.priority = parseInt(value, 10) || 0;
    else if (name === 'COMPLETED') cur.completed = true;
    else if (name === 'PERCENT-COMPLETE') cur.percent = parseInt(value, 10) || 0;
    else if (name === 'DUE') {
      const tzid = params.match(/TZID=("?)([^;:"]+)\1/i)?.[2];
      const d = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
      if (d) {
        if (!d[4]) cur.due = { due: `${d[1]}-${d[2]}-${d[3]}`, allDay: true };
        else if (d[7]) cur.due = { due: new Date(Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6])).toISOString(), allDay: false };
        else cur.due = { due: zonedToIso(+d[1], +d[2], +d[3], +d[4], +d[5], +d[6], tzid || timeZone), allDay: false };
      }
    }
  }
  return todos;
}

// RFC 5545: 1–4 high, 5 medium, 6–9 low, 0 undefined.
const icsPriority = (p) => (!p ? 0 : p <= 4 ? 3 : p === 5 ? 2 : 1);

export async function caldavTasks(settings, timeZone) {
  const url = settings.caldavUrl.trim();
  if (!url) throw fail('No CalDAV URL configured');
  const headers = { 'Content-Type': 'application/xml; charset=utf-8', Depth: '1' };
  if (settings.caldavUser || settings.caldavPassword) {
    headers.Authorization = 'Basic ' + Buffer.from(`${settings.caldavUser}:${settings.caldavPassword}`).toString('base64');
  }
  const report = (strict) => fetchRaw(url, { method: 'REPORT', headers, body: REPORT_BODY(strict) });
  let res;
  try {
    res = await report(true);
  } catch (err) {
    if (/HTTP 40[13]/.test(err.message)) throw fail('CalDAV login failed – check username and password');
    // Some servers do not support is-not-defined/text-match filters.
    if (/HTTP (400|403|415|422|500|501)/.test(err.message)) res = await report(false);
    else throw err;
  }
  const xml = await res.text();
  const todos = extractCalendarData(xml).flatMap((ics) => parseVtodos(ics, timeZone));
  return todos
    .filter((t) => !t.completed && t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && (t.percent ?? 0) < 100)
    .map((t) => ({ title: t.summary || '', ...(t.due || { due: null, allDay: false }), priority: icsPriority(t.priority) }));
}

// ---- provider ------------------------------------------------------------------------------

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dueKey = (i) => (i.due ? (i.allDay ? `${i.due}T99` : i.due) : '~'); // all-day after timed tasks of the same day

export function sortItems(items, mode) {
  const list = items.map((i, idx) => ({ ...i, idx }));
  if (mode === 'due') {
    list.sort((a, b) => cmp(dueKey(a), dueKey(b)) || b.priority - a.priority || a.idx - b.idx);
  } else if (mode === 'priority') {
    list.sort((a, b) => b.priority - a.priority || cmp(dueKey(a), dueKey(b)) || a.idx - b.idx);
  }
  return list.map(({ idx, ...i }) => i);
}

// "Due within the next n days" (n = 0: no filter). Overdue tasks always pass; tasks without
// a due date only with includeNoDue.
export function filterDue(items, days, includeNoDue, now, timeZone) {
  if (!(days > 0)) return items;
  const lastDay = dateKey(new Date(now.getTime() + days * 86400000), timeZone);
  return items.filter((i) => (i.due ? (i.allDay ? i.due : dateKey(new Date(i.due), timeZone)) <= lastDay : includeNoDue !== false));
}

export async function provider(settings, cfg, mod) {
  const tz = cfg.general.timezone || 'Europe/Berlin';
  let key;
  let load;
  let receivedAt = null;
  if (settings.source === 'shortcuts') {
    // Pushed by an Apple Shortcuts automation – no cache, the file is the source.
    key = null;
    load = async () => {
      const pushed = mod && (await readPushedTasks(mod.id));
      if (!pushed) throw fail('No reminders received yet – run your Shortcut once');
      receivedAt = pushed.receivedAt;
      return pushed.items;
    };
  } else if (settings.source === 'homeassistant') {
    key = hash('ha', settings.haUrl, settings.haToken, settings.haEntity);
    load = () => haTasks(settings, tz);
  } else if (settings.source === 'caldav') {
    key = hash('caldav', settings.caldavUrl, settings.caldavUser, settings.caldavPassword);
    load = () => caldavTasks(settings, tz);
  } else {
    key = hash('todoist', settings.todoistToken, settings.todoistProject, settings.todoistFilter);
    load = () => todoistTasks(settings, tz);
  }
  let all;
  try {
    all = (key ? await cached(`tasks:${key}:${tz}`, TTL, load) : await load()).filter((i) => i.title);
  } catch (err) {
    if (err.msgId) throw new Error(translator(langOf(cfg.general.locale))(err.msgId, err.params));
    throw err;
  }
  const now = new Date();
  all = filterDue(all, settings.dueWithinDays, settings.includeNoDue, now, tz);
  const items = sortItems(all, settings.sort)
    .slice(0, settings.maxItems)
    .map((i) => ({ ...i, overdue: isOverdue(i, now, tz) }));
  const stale = Boolean(receivedAt && settings.staleHours > 0 && Date.now() - Date.parse(receivedAt) > settings.staleHours * 3600000);
  return { items, total: all.length, receivedAt, stale };
}
