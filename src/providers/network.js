// Internet & network: online status and latency (TCP connect time – Node has
// no ICMP API and the container has no ping binary), DNS check, optional
// speed test against Cloudflare (speed.cloudflare.com), optional public IP
// (Cloudflare trace) and presence of devices at home (TCP probe or Home
// Assistant person/device_tracker entities).
import net from 'node:net';
import dns from 'node:dns';
import { createHash } from 'node:crypto';
import { translator, langOf } from '../../public/shared/i18n.js';
import { cached, fetchJson, fetchRaw, fetchText } from '../util.js';
import { normalizeUrl } from './homeassistant.js';

// Errors carry their message id so provider() can translate them.
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}

const hash = (...parts) => createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16);
const HISTORY = 40;
const SPEED_URL = 'https://speed.cloudflare.com';
const TRACE_URL = 'https://1.1.1.1/cdn-cgi/trace';
// iOS sync (62078), AirPlay (7000), web, SSH, Chromecast (8009), SMB.
export const PROBE_PORTS = [62078, 7000, 80, 443, 22, 8009, 445, 8080];

// ---- latency ---------------------------------------------------------------------

// "1.1.1.1:443, [2606:4700::1111]:443, example.com" → [{ host, port, label }]
export function parseTargets(text, defaultPort = 443) {
  const out = [];
  for (const raw of String(text || '').split(/[,\s]+/)) {
    const s = raw.trim();
    if (!s) continue;
    let host = s;
    let port = defaultPort;
    const v6 = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (v6) {
      host = v6[1];
      if (v6[2]) port = Number(v6[2]);
    } else if (net.isIPv6(s)) {
      host = s;
    } else {
      const m = s.match(/^([^:]+):(\d+)$/);
      if (m) [host, port] = [m[1], Number(m[2])];
    }
    if (!host || !(port > 0 && port < 65536)) continue;
    out.push({ host, port, label: s });
  }
  return out.slice(0, 8);
}

// Resolves to { ok, ms, code }. A refused connection still proves the host
// answered, so `refused` is reported separately.
export function tcpConnect(host, port, timeout = 2000) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const sock = net.connect({ host, port });
    let done = false;
    const finish = (ok, code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ ok, code, ms: Number(process.hrtime.bigint() - start) / 1e6 });
    };
    const timer = setTimeout(() => finish(false, 'ETIMEDOUT'), timeout);
    sock.once('connect', () => finish(true, 'CONNECTED'));
    sock.once('error', (err) => finish(false, err.code || 'ERROR'));
  });
}

export function median(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// results: [{ label, samples: [ms | null] }] → overall stats.
export function latencyStats(results) {
  const all = results.flatMap((r) => r.samples);
  const ok = all.filter((x) => x !== null);
  const targets = results.map((r) => {
    const m = median(r.samples);
    return { label: r.label, ok: m !== null, ms: m === null ? null : Math.round(m * 10) / 10 };
  });
  const latency = median(ok);
  return {
    latency: latency === null ? null : Math.round(latency * 10) / 10,
    reachable: targets.filter((x) => x.ok).length,
    total: targets.length,
    loss: all.length ? Math.round(((all.length - ok.length) / all.length) * 100) / 100 : 0,
    targets,
  };
}

// Overall status + colour level.
export function classify({ latency, reachable, total, dnsOk }, warnMs, badMs) {
  if (!total || !reachable) return { status: 'offline', level: 'severe' };
  if (dnsOk === false) return { status: 'dns', level: 'severe' };
  if (latency !== null && badMs > 0 && latency >= badMs) return { status: 'slow', level: 'severe' };
  if (latency !== null && warnMs > 0 && latency >= warnMs) return { status: 'slow', level: 'warn' };
  if (reachable < total) return { status: 'degraded', level: 'warn' };
  return { status: 'ok', level: 'ok' };
}

async function measureTarget(target, samples, timeout) {
  let host = target.host;
  if (!net.isIP(host)) {
    // Resolve once so the samples measure the connection, not DNS.
    try {
      host = (await dns.promises.lookup(host)).address;
    } catch {
      return { label: target.label, samples: Array(samples).fill(null) };
    }
  }
  const out = [];
  for (let i = 0; i < samples; i++) {
    const r = await tcpConnect(host, target.port, timeout);
    out.push(r.ok ? r.ms : null);
  }
  return { label: target.label, samples: out };
}

export async function measureLatency(targets, samples = 3, timeout = 2000) {
  return latencyStats(await Promise.all(targets.map((t) => measureTarget(t, samples, timeout))));
}

export async function checkDns(host, timeout = 3000) {
  const resolver = new dns.promises.Resolver({ timeout, tries: 1 });
  const start = process.hrtime.bigint();
  try {
    await resolver.resolve(host);
    return { host, ok: true, ms: Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10 };
  } catch (err) {
    // NXDOMAIN etc. still means a DNS server answered.
    const answered = ['ENOTFOUND', 'ENODATA'].includes(err.code);
    return { host, ok: answered, ms: null, code: err.code };
  }
}

// ---- speed test -------------------------------------------------------------------

export const mbps = (bytes, ms) => (bytes > 0 && ms > 0 ? Math.round(((bytes * 8) / (ms / 1000) / 1e6) * 10) / 10 : null);

export async function downloadSpeed(bytes, base = SPEED_URL) {
  const res = await fetchRaw(`${base}/__down?bytes=${bytes}`, { timeout: 120000 });
  // Time from the first response byte – excludes TLS handshake and server delay.
  const start = performance.now();
  let got = 0;
  for await (const chunk of res.body) got += chunk.length;
  return mbps(got, performance.now() - start);
}

export async function uploadSpeed(bytes, base = SPEED_URL) {
  const body = Buffer.alloc(bytes);
  // A tiny request first, so the upload reuses a warm connection.
  await fetchRaw(`${base}/__up`, { method: 'POST', body: Buffer.alloc(1), timeout: 15000 }).then((r) => r.arrayBuffer());
  const start = performance.now();
  const res = await fetchRaw(`${base}/__up`, { method: 'POST', body, timeout: 120000, headers: { 'Content-Type': 'application/octet-stream' } });
  await res.arrayBuffer();
  return mbps(bytes, performance.now() - start);
}

// Only one speed test at a time, server-wide; results live in memory.
const speedState = new Map();
let speedRunning = null;
const RETRY_AFTER_FAIL = 30 * 60 * 1000;

export function speedDue(state, intervalHours, now = Date.now()) {
  if (!state) return true;
  if (state.error && now - state.attempt < RETRY_AFTER_FAIL) return false;
  if (!state.result) return now - (state.attempt || 0) >= RETRY_AFTER_FAIL;
  return now - state.result.at >= intervalHours * 3600 * 1000;
}

function runSpeedTest(key, sizeMb, upload, base) {
  const bytes = Math.round(Math.min(50, Math.max(1, sizeMb)) * 1e6);
  const state = speedState.get(key) || {};
  state.attempt = Date.now();
  speedState.set(key, state);
  speedRunning = (async () => {
    try {
      const down = await downloadSpeed(bytes, base);
      const up = upload ? await uploadSpeed(Math.min(bytes, 10e6), base) : null;
      state.result = { down, up, at: new Date().toISOString(), mb: bytes / 1e6 };
      state.error = null;
    } catch (err) {
      state.error = err.message;
      console.warn(`[network] speed test failed: ${err.message}`);
    } finally {
      speedRunning = null;
    }
  })();
  return speedRunning;
}

// ---- public IP -------------------------------------------------------------------

// Cloudflare trace ("key=value" lines) → object.
export function parseTrace(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

async function publicIp() {
  return cached('network:trace', 1800, async () => {
    const tr = parseTrace(await fetchText(TRACE_URL, { timeout: 8000 }));
    if (!tr.ip) throw new Error('No IP in Cloudflare trace');
    return { ip: tr.ip, loc: tr.loc || '', colo: tr.colo || '' };
  });
}

// ---- presence --------------------------------------------------------------------

// Host up = any port accepts or actively refuses the connection.
export async function probeHost(host, ports = PROBE_PORTS, timeout = 1500) {
  if (!host) return false;
  return new Promise((resolve) => {
    let pending = ports.length;
    if (!pending) return resolve(false);
    let settled = false;
    for (const port of ports) {
      tcpConnect(host, port, timeout).then((r) => {
        if (settled) return;
        if (r.ok || r.code === 'ECONNREFUSED') {
          settled = true;
          resolve(true);
        } else if (--pending === 0) {
          settled = true;
          resolve(false);
        }
      });
    }
  });
}

// Keeps a device "home" for a grace period after it was last seen, since
// sleeping phones don't always answer.
const lastSeen = new Map();

export function applyGrace(key, up, graceMin, now = Date.now(), seen = lastSeen) {
  if (up) seen.set(key, now);
  const t = seen.get(key);
  return { home: !!t && now - t <= graceMin * 60000, lastSeen: t ? new Date(t).toISOString() : null };
}

async function probeDevices(devices, graceMin, scope) {
  const list = devices.filter((d) => String(d.host || '').trim()).slice(0, 20);
  const ups = await Promise.all(
    list.map((d) => {
      const port = Number(d.port) || 0;
      return probeHost(String(d.host).trim(), port ? [port] : PROBE_PORTS);
    }),
  );
  return list.map((d, i) => {
    const host = String(d.host).trim();
    const g = applyGrace(`${scope}:${host}`, ups[i], graceMin);
    return { name: String(d.name || '').trim() || host, ...g };
  });
}

// Home Assistant state → { home, where }
export function haPresence(state) {
  const s = String(state?.state || '');
  if (s === 'home') return { home: true, where: '' };
  if (!s || s === 'not_home' || s === 'unknown' || s === 'unavailable') return { home: false, where: '' };
  return { home: false, where: s }; // a zone name
}

async function haDevices(settings) {
  let base;
  try {
    base = normalizeUrl(settings.haUrl);
  } catch {
    throw fail('Home Assistant URL or token missing');
  }
  const token = String(settings.haToken || '').trim();
  if (!token) throw fail('Home Assistant URL or token missing');
  const entries = (settings.haEntities || []).filter((e) => /^(person|device_tracker)\.\w+$/.test(String(e.entity || '').trim())).slice(0, 20);
  return cached(`network:ha:${hash(base, token, entries.map((e) => `${e.entity}=${e.name}`).join(','))}`, 30, async () => {
    let states;
    try {
      states = await fetchJson(`${base}/api/states`, { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 });
    } catch (err) {
      if (/HTTP 40[13]\b/.test(err.message)) throw fail('Home Assistant rejected the access token');
      throw fail('Home Assistant not reachable ({reason})', { reason: err.cause?.code || err.message });
    }
    const map = new Map((Array.isArray(states) ? states : []).map((s) => [s.entity_id, s]));
    return entries.map((e) => {
      const id = e.entity.trim();
      const st = map.get(id);
      const zone = haPresence(st);
      return { name: String(e.name || '').trim() || st?.attributes?.friendly_name || id, ...zone, lastSeen: st?.last_changed || null };
    });
  });
}

// ---- provider --------------------------------------------------------------------

const history = new Map();

export async function provider(settings, cfg, mod, opts = {}) {
  const t = translator(langOf(cfg?.general?.locale));
  const scope = mod?.id || hash(settings.targets, settings.devices?.length);
  const samples = Math.min(10, Math.max(1, Number(settings.samples) || 3));
  const targets = parseTargets(settings.targets);
  const ttl = Math.max(15, (Number(settings.refreshSeconds) || 60) - 10);
  const dnsHost = String(settings.dnsHost || '').trim();

  const base = await cached(`network:lat:${scope}:${hash(settings.targets, samples, dnsHost)}`, ttl, async () => {
    const [lat, dnsRes] = await Promise.all([measureLatency(targets, samples), dnsHost ? checkDns(dnsHost) : null]);
    const h = history.get(scope) || [];
    h.push(lat.reachable ? lat.latency : null);
    while (h.length > HISTORY) h.shift();
    history.set(scope, h);
    return { ...lat, dns: dnsRes, measuredAt: new Date().toISOString() };
  });

  const warnMs = Number(settings.warnMs) || 0;
  const badMs = Number(settings.badMs) || 0;
  const { status, level } = classify({ ...base, dnsOk: base.dns ? base.dns.ok : undefined }, warnMs, badMs);
  const out = { ...base, status, level, warnMs, badMs, history: [...(history.get(scope) || [])] };

  if (settings.speedTest) {
    const key = `${scope}:${settings.speedSize}:${settings.speedUpload ? 1 : 0}`;
    const state = speedState.get(key);
    if (status !== 'offline' && !speedRunning && speedDue(state, Math.max(1, Number(settings.speedInterval) || 6))) {
      const run = runSpeedTest(key, Number(settings.speedSize) || 10, !!settings.speedUpload, opts.speedBase);
      if (opts.awaitSpeed) await run;
    }
    const s = speedState.get(key) || {};
    out.speed = s.result || null;
    out.speedRunning = !!speedRunning;
    out.speedError = s.error && !s.result ? s.error : null;
  }

  if (settings.publicIp) {
    try {
      out.publicIp = await publicIp();
    } catch {
      out.publicIp = null;
    }
  }

  if (settings.presence === 'probe') {
    out.devices = await cached(`network:probe:${scope}:${hash(JSON.stringify(settings.devices || []), settings.graceMinutes)}`, 25, () =>
      probeDevices(settings.devices || [], Math.max(0, Number(settings.graceMinutes) || 0), scope),
    );
  } else if (settings.presence === 'homeassistant') {
    try {
      out.devices = await haDevices(settings);
    } catch (err) {
      out.devices = [];
      out.presenceError = err.msgId ? t(err.msgId, err.params) : err.message;
    }
  }
  return out;
}

export const network = provider;
