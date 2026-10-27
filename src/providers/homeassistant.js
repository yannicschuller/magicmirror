import { createHash } from 'node:crypto';
import { translator, langOf } from '../../public/shared/i18n.js';
import { cached, fetchJson } from '../util.js';

// Binary sensor device classes → [label when on, label when off].
const BINARY_LABELS = {
  door: ['Open', 'Closed'],
  garage_door: ['Open', 'Closed'],
  opening: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  lock: ['Unlocked', 'Locked'],
  motion: ['Detected', 'Not detected'],
  occupancy: ['Detected', 'Not detected'],
  presence: ['At home', 'Away'],
  moisture: ['Wet', 'Dry'],
  smoke: ['Detected', 'Not detected'],
  gas: ['Detected', 'Not detected'],
  carbon_monoxide: ['Detected', 'Not detected'],
  problem: ['Problem', 'OK'],
  safety: ['Unsafe', 'Safe'],
  battery: ['Low', 'Normal'],
  battery_charging: ['Charging', 'Not charging'],
  plug: ['Plugged in', 'Unplugged'],
  power: ['On', 'Off'],
  connectivity: ['Connected', 'Disconnected'],
  light: ['Light detected', 'No light'],
  running: ['Running', 'Not running'],
};

// Plain (non-binary) states shared by many domains.
const STATE_LABELS = {
  on: 'On',
  off: 'Off',
  open: 'Open',
  opening: 'Opening',
  closed: 'Closed',
  closing: 'Closing',
  locked: 'Locked',
  unlocked: 'Unlocked',
  locking: 'Locking',
  unlocking: 'Unlocking',
  jammed: 'Jammed',
  home: 'At home',
  not_home: 'Away',
  playing: 'Playing',
  paused: 'Paused',
  idle: 'Idle',
  standby: 'Standby',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

const ACTIVE = new Set(['on', 'open', 'opening', 'unlocked', 'unlocking', 'jammed', 'home', 'playing']);
const INACTIVE = new Set(['off', 'closed', 'closing', 'locked', 'locking', 'not_home', 'idle', 'paused', 'standby']);

export function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('No Home Assistant URL configured');
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error('Invalid Home Assistant URL');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed');
  return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`;
}

// Picks an icon from domain / device class when the user chose "auto".
export function autoIcon(domain, deviceClass) {
  switch (deviceClass) {
    case 'temperature': return 'thermometer';
    case 'humidity': case 'moisture': return 'humidity';
    case 'window': return 'window';
    case 'door': case 'garage_door': case 'opening': return 'door';
    case 'power': case 'energy': case 'current': case 'voltage': case 'apparent_power': return 'bolt';
    case 'battery': case 'battery_charging': return 'battery';
    case 'lock': return 'lock';
    case 'irradiance': case 'illuminance': return 'sun';
    case 'plug': case 'outlet': return 'plug';
    default: break;
  }
  if (domain === 'lock') return 'lock';
  if (domain === 'light') return 'light';
  if (domain === 'switch') return 'plug';
  if (domain === 'sun') return 'sun';
  return 'generic';
}

const decimalsOf = (s) => (String(s).split('.')[1] || '').length;

// Turns one HA state object (or undefined when missing) into the renderer entry.
export function describe(item, st, t = (s) => s) {
  const id = String(item.entity || '').trim();
  const domain = id.split('.')[0];
  if (!st) {
    return { id, label: item.label || id, icon: item.icon === 'auto' ? 'generic' : item.icon, state: t('Not found'), raw: null, missing: true, active: false, inactive: false };
  }
  const attr = st.attributes || {};
  const deviceClass = attr.device_class || null;
  const raw = String(st.state);
  const out = {
    id,
    label: item.label || attr.friendly_name || id,
    icon: !item.icon || item.icon === 'auto' ? autoIcon(domain, deviceClass) : item.icon,
    device_class: deviceClass,
    domain,
    raw,
    unit: attr.unit_of_measurement || '',
    changed: st.last_changed || null,
    available: raw !== 'unavailable' && raw !== 'unknown',
    active: false,
    inactive: false,
  };
  if (!out.available) {
    out.state = t(STATE_LABELS[raw]);
    out.unit = '';
    return out;
  }
  const n = raw.trim() === '' ? NaN : Number(raw);
  if (Number.isFinite(n) && domain !== 'binary_sensor') {
    out.value = n;
    out.decimals = item.decimals && item.decimals !== 'auto' ? Number(item.decimals) : Math.min(decimalsOf(raw), 1);
    out.active = n !== 0;
    out.inactive = n === 0;
    return out;
  }
  out.active = ACTIVE.has(raw);
  out.inactive = INACTIVE.has(raw);
  if (domain === 'binary_sensor' && BINARY_LABELS[deviceClass] && (raw === 'on' || raw === 'off')) {
    out.state = t(BINARY_LABELS[deviceClass][raw === 'on' ? 0 : 1]);
  } else if (STATE_LABELS[raw]) {
    out.state = t(STATE_LABELS[raw]);
  } else {
    out.state = raw;
  }
  return out;
}


export function visible(entry, showWhen) {
  if (showWhen === 'on') return entry.active;
  if (showWhen === 'off') return entry.inactive;
  return true;
}

// ---- Conditions and color thresholds (pure helpers) ---------------------------------

// Accepts "1000", " 18,5 " … – empty or non-numeric → NaN (= not set).
export const toNumber = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
};

const sameState = (raw, value) => {
  const a = String(raw).trim().toLowerCase();
  const b = String(value ?? '').trim().toLowerCase();
  if (a === b) return true;
  const x = toNumber(a), y = toNumber(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};

// Does one HA state object (undefined = entity missing) satisfy "<op> <value>"?
// A missing entity never satisfies a condition, so the dependent entity stays hidden.
export function checkCondition(st, op, value) {
  if (!st) return false;
  const raw = String(st.state ?? '');
  const n = toNumber(raw);
  switch (op) {
    case 'not_equals': return !sameState(raw, value);
    case 'above': return Number.isFinite(n) && Number.isFinite(toNumber(value)) && n > toNumber(value);
    case 'below': return Number.isFinite(n) && Number.isFinite(toNumber(value)) && n < toNumber(value);
    case 'on': return ACTIVE.has(raw) || (Number.isFinite(n) && n !== 0);
    case 'off': return INACTIVE.has(raw) || n === 0;
    default: return sameState(raw, value);
  }
}

// No condition entity configured → always true (old configs).
export function conditionHolds(lookup, entity, op, value) {
  const id = String(entity || '').trim();
  if (!id) return true;
  return checkCondition(lookup(id), op, value);
}

export function isWarn(value, warnAbove, warnBelow) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const hi = toNumber(warnAbove), lo = toNumber(warnBelow);
  return (Number.isFinite(hi) && value > hi) || (Number.isFinite(lo) && value < lo);
}

// Every entity id a module needs: the shown ones plus all condition entities.
export function entityIdsOf(settings) {
  const ids = new Set();
  const add = (v) => { const id = String(v || '').trim(); if (id) ids.add(id); };
  for (const e of settings.entities || []) {
    if (!e) continue;
    add(e.entity);
    if (String(e.entity || '').trim()) add(e.conditionEntity);
  }
  if (ids.size) add(settings.moduleConditionEntity);
  return [...ids];
}

// Only the parts of a state we use – a big installation has thousands of entities.
function slim(s) {
  const a = s.attributes || {};
  return {
    state: s.state,
    last_changed: s.last_changed,
    attributes: { friendly_name: a.friendly_name, unit_of_measurement: a.unit_of_measurement, device_class: a.device_class },
  };
}

const tokenHash = (token) => createHash('sha256').update(token).digest('hex').slice(0, 12);

async function loadStates(base, token) {
  return cached(`homeassistant:${base}:${tokenHash(token)}`, 15, async () => {
    let list;
    try {
      list = await fetchJson(`${base}/api/states`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
    } catch (err) {
      if (/HTTP 401|HTTP 403/.test(err.message)) throw new Error('Home Assistant rejected the access token');
      if (/HTTP \d+/.test(err.message)) throw err;
      throw new Error(`Home Assistant not reachable (${new URL(base).host})`);
    }
    if (!Array.isArray(list)) throw new Error('Unexpected response from Home Assistant');
    const map = new Map();
    for (const s of list) if (s && s.entity_id) map.set(s.entity_id, slim(s));
    return map;
  });
}

// ---- Live updates via the Home Assistant WebSocket API ------------------------------
// One connection per (url, token). subscribe_entities (HA ≥ 2022.4) delivers the
// configured entities in compressed form; older versions fall back to get_states +
// state_changed events. When a watched entity changes, the mirrors get an SSE
// "refresh" for the affected modules (throttled per module).

const OPTS = { throttleMs: 2000, minDelay: 1000, maxDelay: 60000, authFailDelay: 300000, pingMs: 30000, timeoutMs: 15000 };
const conns = new Map(); // key → HaConnection
const lastSent = new Map(); // module id → ms
const pending = new Map(); // module id → timer
let broadcastFn = null;

function refreshModule(id) {
  if (pending.has(id) || !broadcastFn) return;
  const wait = (lastSent.get(id) || 0) + OPTS.throttleMs - Date.now();
  const send = () => {
    pending.delete(id);
    lastSent.set(id, Date.now());
    try { broadcastFn('refresh', { module: id }); } catch (err) { console.warn('[homeassistant] broadcast', err.message); }
  };
  if (wait <= 0) return send();
  const timer = setTimeout(send, wait);
  timer.unref?.();
  pending.set(id, timer);
}

const tsIso = (sec) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : undefined);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class HaConnection {
  constructor(base, token) {
    this.base = base;
    this.token = token;
    this.url = `${base.replace(/^http/, 'ws')}/api/websocket`;
    this.watch = new Map(); // entity id → Set(module id)
    this.states = new Map();
    this.ready = false;
    this.ws = null;
    this.attempt = 0;
    this.timer = null;
    this.stopped = false;
    this.error = null;
  }

  // Which entities to watch for which modules; resubscribes when the set changes.
  setTargets(watch) {
    const before = [...this.watch.keys()].sort().join('\n');
    this.watch = watch;
    if (before === [...watch.keys()].sort().join('\n') && (this.ws || this.timer)) return;
    this.restart();
  }

  covers(ids) {
    return this.ready && ids.every((id) => this.watch.has(id));
  }

  restart() {
    this.drop();
    this.attempt = 0;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.drop();
  }

  drop() {
    clearTimeout(this.timer);
    clearInterval(this.ping);
    this.timer = null;
    this.ready = false;
    const ws = this.ws;
    this.ws = null;
    if (ws) try { ws.close(); } catch { /* already closed */ }
  }

  scheduleReconnect(delay) {
    if (this.stopped || this.timer) return;
    const ms = delay ?? Math.min(OPTS.maxDelay, OPTS.minDelay * 2 ** this.attempt++);
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, ms);
    this.timer.unref?.();
  }

  connect() {
    if (this.stopped || !this.watch.size) return;
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.error = err.message;
      return this.scheduleReconnect();
    }
    this.ws = ws;
    this.nextId = 1;
    this.lastMsg = Date.now();
    const authTimeout = setTimeout(() => ws === this.ws && !this.ready && this.fail(ws, 'timeout'), OPTS.timeoutMs);
    authTimeout.unref?.();
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      this.lastMsg = Date.now();
      let msgs;
      try { msgs = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString()); } catch { return; }
      for (const m of Array.isArray(msgs) ? msgs : [msgs]) this.handle(ws, m);
    };
    ws.onclose = () => {
      clearTimeout(authTimeout);
      if (ws !== this.ws) return;
      this.ws = null;
      this.ready = false;
      clearInterval(this.ping);
      this.scheduleReconnect(this.authFailed ? OPTS.authFailDelay : undefined);
    };
    ws.onerror = () => {}; // followed by close
  }

  fail(ws, reason) {
    this.error = reason;
    try { ws.close(); } catch { /* ignore */ }
  }

  send(ws, msg) {
    const id = this.nextId++;
    ws.send(JSON.stringify({ id, ...msg }));
    return id;
  }

  handle(ws, m) {
    switch (m.type) {
      case 'auth_required':
        ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
        return;
      case 'auth_invalid':
        this.authFailed = true;
        return this.fail(ws, 'Home Assistant rejected the access token');
      case 'auth_ok':
        this.authFailed = false;
        this.attempt = 0;
        this.error = null;
        this.fresh = true;
        this.subId = this.send(ws, { type: 'subscribe_entities', entity_ids: [...this.watch.keys()] });
        this.ping = setInterval(() => {
          if (Date.now() - this.lastMsg > OPTS.pingMs * 2.5) return this.fail(ws, 'no pong');
          try { this.send(ws, { type: 'ping' }); } catch { /* closing */ }
        }, OPTS.pingMs);
        this.ping.unref?.();
        return;
      case 'result':
        if (m.id === this.subId && !m.success) {
          // Older Home Assistant without subscribe_entities.
          this.subId = null;
          this.statesId = this.send(ws, { type: 'get_states' });
          this.eventsId = this.send(ws, { type: 'subscribe_events', event_type: 'state_changed' });
        } else if (m.id === this.statesId && m.success && Array.isArray(m.result)) {
          this.replaceAll(Object.fromEntries(m.result.filter((s) => s && this.watch.has(s.entity_id)).map((s) => [s.entity_id, slim(s)])));
        }
        return;
      case 'event':
        if (m.id === this.subId && m.event) this.onEntities(m.event);
        else if (m.id === this.eventsId && m.event?.data) {
          const { entity_id: id, new_state: ns } = m.event.data;
          if (this.watch.has(id) && this.ready) this.set(id, ns ? slim(ns) : undefined);
        }
        return;
      default:
    }
  }

  // subscribe_entities: {a: added/full, c: {id: {'+': {...}, '-': {a: [...]}}}, r: [removed]}
  onEntities(ev) {
    if (ev.a) {
      const full = {};
      for (const [id, c] of Object.entries(ev.a)) {
        full[id] = slim({ state: c.s, last_changed: tsIso(c.lc ?? c.lu), attributes: c.a });
      }
      if (this.fresh) return this.replaceAll(full);
      for (const [id, s] of Object.entries(full)) this.set(id, s);
    }
    for (const [id, diff] of Object.entries(ev.c || {})) {
      const old = this.states.get(id);
      if (!old) continue;
      const next = { ...old, attributes: { ...old.attributes } };
      const add = diff['+'] || {};
      if ('s' in add) next.state = add.s;
      if (add.lc !== undefined) next.last_changed = tsIso(add.lc);
      else if ('s' in add && add.lu !== undefined) next.last_changed = tsIso(add.lu);
      if (add.a) Object.assign(next.attributes, slim({ attributes: { ...next.attributes, ...add.a } }).attributes);
      for (const k of diff['-']?.a || []) delete next.attributes[k];
      this.set(id, next);
    }
    for (const id of ev.r || []) this.set(id, undefined);
  }

  // First snapshot after (re)connecting: entities absent from it are gone.
  replaceAll(full) {
    this.fresh = false;
    for (const id of this.states.keys()) if (!(id in full)) this.set(id, undefined);
    for (const [id, s] of Object.entries(full)) this.set(id, s);
    this.ready = true;
  }

  set(id, st) {
    const old = this.states.get(id);
    if (st) this.states.set(id, st);
    else this.states.delete(id);
    if (!same(old, st)) for (const mod of this.watch.get(id) || []) refreshModule(mod);
  }
}

// Brings the live connections in line with the configuration.
export function syncHaLive(cfg) {
  const want = new Map();
  for (const mod of cfg?.modules || []) {
    if (mod.type !== 'homeassistant' || mod.enabled === false) continue;
    const s = mod.settings || {};
    if (s.live === false) continue;
    let base;
    try { base = normalizeUrl(s.url); } catch { continue; }
    const token = String(s.token || '').trim();
    const ids = entityIdsOf(s);
    if (!token || !ids.length) continue;
    const key = `${base}|${tokenHash(token)}`;
    if (!want.has(key)) want.set(key, { base, token, watch: new Map() });
    const { watch } = want.get(key);
    for (const id of ids) {
      if (!watch.has(id)) watch.set(id, new Set());
      watch.get(id).add(mod.id);
    }
  }
  for (const [key, c] of conns) if (!want.has(key)) { c.stop(); conns.delete(key); }
  for (const [key, w] of want) {
    if (!conns.has(key)) conns.set(key, new HaConnection(w.base, w.token));
    conns.get(key).setTargets(w.watch);
  }
}

// Called once by the server: (getConfig, broadcast(event, data), onConfigChange?).
export function startHaLive(getConfig, broadcast, onConfigChange, opts = {}) {
  broadcastFn = broadcast;
  Object.assign(OPTS, opts);
  if (typeof globalThis.WebSocket !== 'function') {
    console.warn('[homeassistant] no WebSocket client available – live updates disabled, polling instead');
    return { sync() {}, stop() {} };
  }
  syncHaLive(getConfig());
  onConfigChange?.(() => syncHaLive(getConfig()));
  return { sync: () => syncHaLive(getConfig()), stop: stopHaLive };
}

export function stopHaLive() {
  for (const c of conns.values()) c.stop();
  conns.clear();
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  lastSent.clear();
}

// Status for tests / diagnostics (no secrets).
export function haLiveStatus() {
  return [...conns.values()].map((c) => ({ url: c.url, ready: c.ready, entities: [...c.watch.keys()], error: c.error }));
}

function liveStates(base, token, ids) {
  const c = conns.get(`${base}|${tokenHash(token)}`);
  return c && c.covers(ids) ? c.states : null;
}

export async function provider(settings, cfg) {
  const t = translator(langOf(cfg.general.locale));
  const base = normalizeUrl(settings.url);
  const token = String(settings.token || '').trim();
  if (!token) throw new Error('No access token configured');
  const items = (settings.entities || []).filter((e) => e && String(e.entity || '').trim());
  if (!items.length) return { entities: [], configured: 0 };
  const live = settings.live !== false ? liveStates(base, token, entityIdsOf(settings)) : null;
  const states = live || (await loadStates(base, token));
  const get = (id) => states.get(String(id).trim());
  if (!conditionHolds(get, settings.moduleConditionEntity, settings.moduleConditionOperator, settings.moduleConditionValue)) {
    return { entities: [], configured: items.length, hidden: true, live: !!live };
  }
  const entities = items
    .map((item) => ({ item, entry: describe(item, get(item.entity), t) }))
    .filter(({ item, entry }) => (entry.missing || visible(entry, item.showWhen))
      && conditionHolds(get, item.conditionEntity, item.conditionOperator, item.conditionValue))
    .map(({ item, entry }) => (isWarn(entry.value, item.warnAbove, item.warnBelow) ? { ...entry, warn: true } : entry));
  return { entities, configured: items.length, live: !!live };
}
