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

async function loadStates(base, token) {
  const tokenKey = createHash('sha256').update(token).digest('hex').slice(0, 12);
  return cached(`homeassistant:${base}:${tokenKey}`, 15, async () => {
    let list;
    try {
      list = await fetchJson(`${base}/api/states`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
    } catch (err) {
      if (/HTTP 401|HTTP 403/.test(err.message)) throw new Error('Home Assistant rejected the access token');
      if (/HTTP \d+/.test(err.message)) throw err;
      throw new Error(`Home Assistant not reachable (${new URL(base).host})`);
    }
    if (!Array.isArray(list)) throw new Error('Unexpected response from Home Assistant');
    // Keep only what we need – a big installation returns thousands of states.
    const map = new Map();
    for (const s of list) {
      if (!s || !s.entity_id) continue;
      const a = s.attributes || {};
      map.set(s.entity_id, {
        state: s.state,
        last_changed: s.last_changed,
        attributes: { friendly_name: a.friendly_name, unit_of_measurement: a.unit_of_measurement, device_class: a.device_class },
      });
    }
    return map;
  });
}

export async function provider(settings, cfg) {
  const t = translator(langOf(cfg.general.locale));
  const base = normalizeUrl(settings.url);
  const token = String(settings.token || '').trim();
  if (!token) throw new Error('No access token configured');
  const items = (settings.entities || []).filter((e) => e && String(e.entity || '').trim());
  if (!items.length) return { entities: [], configured: 0 };
  const states = await loadStates(base, token);
  const entities = items
    .map((item) => ({ item, entry: describe(item, states.get(String(item.entity).trim()), t) }))
    .filter(({ item, entry }) => entry.missing || visible(entry, item.showWhen))
    .map(({ entry }) => entry);
  return { entities, configured: items.length };
}
