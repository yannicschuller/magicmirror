// Keeps go2rtc's stream list in sync with the camera modules and proxies
// snapshots / the MSE websocket so the mirror only talks to this server.
import httpProxy from 'http-proxy';
import { fetchRaw } from './util.js';

export const GO2RTC_URL = (process.env.GO2RTC_URL || 'http://go2rtc:1984').replace(/\/+$/, '');
const PREFIX = 'mm_';

export function streamName(moduleId, idx) {
  return `${PREFIX}${moduleId}_${idx}`.replace(/[^\w]/g, '_');
}

export function desiredStreams(cfg) {
  const out = new Map();
  for (const m of cfg.modules) {
    if (m.type !== 'camera' || !m.enabled) continue;
    m.settings.streams.forEach((s, idx) => {
      if (s.enabled && s.url) out.set(streamName(m.id, idx), s.url.trim());
    });
  }
  return out;
}

let lastError = null;
// What we registered per stream name – go2rtc rewrites producer URLs once a
// stream is running, so we can't compare against its own view.
const synced = new Map();

async function go2rtc(method, query) {
  const res = await fetch(`${GO2RTC_URL}/api/streams?${new URLSearchParams(query)}`, { method, signal: AbortSignal.timeout(4000) });
  const text = await res.text();
  // With an inline config go2rtc can't persist streams and answers 400, but the
  // stream is created anyway.
  if (!res.ok && !/config file/i.test(text)) throw new Error(`go2rtc ${method} ${res.status}: ${text.trim()}`);
}

export async function syncStreams(cfg) {
  const wanted = desiredStreams(cfg);
  try {
    const existing = (await (await fetchRaw(`${GO2RTC_URL}/api/streams`, { timeout: 4000 })).json()) || {};
    for (const name of Object.keys(existing)) {
      if (name.startsWith(PREFIX) && !wanted.has(name)) {
        await go2rtc('DELETE', { src: name });
        synced.delete(name);
      }
    }
    for (const [name, src] of wanted) {
      if (existing[name] && synced.get(name) === src) continue;
      if (existing[name]) await go2rtc('DELETE', { src: name });
      await go2rtc('PUT', { name, src });
      synced.set(name, src);
    }
    if (lastError) console.log('[go2rtc] reachable again');
    lastError = null;
    return { ok: true, streams: wanted.size };
  } catch (err) {
    if (wanted.size && lastError !== err.message) console.warn(`[go2rtc] sync failed (${GO2RTC_URL}): ${err.message}`);
    lastError = wanted.size ? err.message : null;
    return { ok: !wanted.size, error: err.message };
  }
}

export function go2rtcStatus() {
  return lastError ? { ok: false, error: lastError } : { ok: true };
}

const proxy = httpProxy.createProxyServer({ target: GO2RTC_URL, ws: true, changeOrigin: true });
// go2rtc rejects websockets whose Origin differs from its own host.
proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'));
proxy.on('error', (err, req, res) => {
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502);
    res.end('go2rtc nicht erreichbar');
  } else if (res && typeof res.destroy === 'function') {
    res.destroy();
  }
});

export function mountGo2rtc(app, server, getConfig) {
  const known = (name) => desiredStreams(getConfig()).has(name);

  for (const file of ['video-stream.js', 'video-rtc.js']) {
    app.get(`/go2rtc/${file}`, async (req, res) => {
      try {
        const upstream = await fetchRaw(`${GO2RTC_URL}/${file}`, { timeout: 5000 });
        res.type('application/javascript').set('Cache-Control', 'public, max-age=3600').send(await upstream.text());
      } catch (err) {
        res.status(502).send(`// go2rtc nicht erreichbar: ${err.message}`);
      }
    });
  }

  app.get('/go2rtc/frame/:name', async (req, res) => {
    if (!known(req.params.name)) return res.sendStatus(404);
    try {
      const upstream = await fetchRaw(`${GO2RTC_URL}/api/frame.jpeg?src=${encodeURIComponent(req.params.name)}`, { timeout: 15000 });
      const jpeg = Buffer.from(await upstream.arrayBuffer());
      if (!jpeg.length) return res.status(502).send('Kein Bild von der Kamera');
      res.type('image/jpeg').set('Cache-Control', 'no-store').send(jpeg);
    } catch (err) {
      res.status(502).send(err.message);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/go2rtc/api/ws') return;
    const src = url.searchParams.get('src');
    if (!src || !known(src)) return socket.destroy();
    req.url = `/api/ws?src=${encodeURIComponent(src)}`;
    proxy.ws(req, socket, head);
  });
}
