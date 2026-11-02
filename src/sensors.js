// Presence and ambient light from Home Assistant: screen off when nobody has been there
// for a while (on again at once), brightness following a lux sensor. Polls the two entity
// states every few seconds (two tiny requests) and tells the mirrors when the result changes.
import { normalizeUrl } from './providers/homeassistant.js';

const POLL_MS = 3000;
let state = { absent: false, brightness: null, error: null };
let lastPresent = Date.now();
let timer = null;

export const sensorState = () => state;

// Home Assistant connection: own settings, or the first Home Assistant module's.
export function haConnection(cfg) {
  const g = cfg.general;
  if (String(g.sensorHaToken || '').trim()) return { url: g.sensorHaUrl, token: g.sensorHaToken };
  const m = cfg.modules.find((x) => x.type === 'homeassistant' && x.settings?.token);
  return m ? { url: m.settings.url, token: m.settings.token } : null;
}

const PRESENT = new Set(['on', 'home', 'detected', 'occupied', 'open', 'playing', 'true']);
export const isPresent = (s) => PRESENT.has(String(s ?? '').toLowerCase());

// lux → brightness 0–1: logarithmic between "dark" and "bright" (the eye works that way)
export function luxBrightness(lux, g) {
  const v = Number(lux);
  if (!Number.isFinite(v)) return null;
  const dark = Math.max(0.1, Number(g.luxDark) || 5);
  const bright = Math.max(dark * 1.5, Number(g.luxBright) || 300);
  const min = Math.min(100, Math.max(0, Number(g.luxMinBrightness ?? 25))) / 100;
  if (v <= dark) return min;
  if (v >= bright) return 1;
  const f = Math.log(v / dark) / Math.log(bright / dark);
  return Math.round((min + (1 - min) * f) * 100) / 100;
}

async function entityState(base, token, id) {
  const res = await fetch(`${base}/api/states/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  if (res.status === 401) throw new Error('Home Assistant: invalid token');
  if (res.status === 404) throw new Error(`Home Assistant: ${id} not found`);
  if (!res.ok) throw new Error(`Home Assistant: HTTP ${res.status}`);
  return (await res.json()).state;
}

export async function pollOnce(cfg, now = Date.now()) {
  const g = cfg.general;
  const presenceId = String(g.presenceEntity || '').trim();
  const luxId = String(g.luxEntity || '').trim();
  const next = { absent: false, brightness: null, error: null };
  if (presenceId || luxId) {
    const conn = haConnection(cfg);
    try {
      if (!conn) throw new Error('Home Assistant: no connection configured');
      const base = normalizeUrl(conn.url);
      const token = String(conn.token).trim();
      if (presenceId) {
        if (isPresent(await entityState(base, token, presenceId))) lastPresent = now;
        next.absent = now - lastPresent > Math.max(1, Number(g.presenceOffMinutes) || 10) * 60000;
      }
      if (luxId) next.brightness = luxBrightness(await entityState(base, token, luxId), g);
    } catch (err) {
      // keep the screen on when the sensor is unreachable – never dark by mistake
      next.error = err.message;
      next.brightness = state.brightness;
    }
  } else lastPresent = now;
  return next;
}

export function startSensors(getConfig, onChange) {
  if (timer) return;
  const tick = async () => {
    const next = await pollOnce(getConfig()).catch((err) => ({ absent: false, brightness: null, error: err.message }));
    // small lux changes are not worth a broadcast
    const changed = next.absent !== state.absent || (next.brightness === null) !== (state.brightness === null)
      || Math.abs((next.brightness ?? 1) - (state.brightness ?? 1)) >= 0.05 || next.error !== state.error;
    if (next.error && next.error !== state.error) console.warn(`[sensors] ${next.error}`);
    if (changed) {
      state = next;
      onChange(state);
    }
    timer = setTimeout(tick, POLL_MS);
    timer.unref?.();
  };
  tick();
}

export function _resetSensors() {
  clearTimeout(timer);
  timer = null;
  state = { absent: false, brightness: null, error: null };
  lastPresent = Date.now();
}
