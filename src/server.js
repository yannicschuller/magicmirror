import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import { VERSION, BUILD } from './version.js';
import { systemInfo } from './system.js';
import { getDisplay, setDisplayOverride } from './display.js';
import { recordSuccess, recordFailure, healthReport } from './health.js';
import { pushRouter } from './push.js';
import { searchPlaces } from './providers/route.js';
import { langOf } from '../public/shared/i18n.js';
import { loadConfig, getConfig, saveConfig, onConfigChange, listHistory, readHistory, DEFAULT_LOCALE_ENV } from './config.js';
import { setupAuth, requireAdmin, changePassword, oidcEnabled, localEnabled } from './auth.js';
import { sseHandler, broadcast, clientCount } from './events.js';
import { mountGo2rtc, syncStreams, streamName, go2rtcStatus } from './go2rtc.js';
import { cached, fetchJson } from './util.js';
import { MODULE_TYPES, publicConfig, defaultConfig, normalizeConfig } from '../public/shared/modules.js';
import { weather, weatherHints, ambientWeather } from './providers/weather.js';
import { provider as news } from './providers/news.js';
import { provider as homeassistant, startHaLive } from './providers/homeassistant.js';
import { provider as tasks } from './providers/tasks.js';
import { provider as fuel } from './providers/fuel.js';
import { provider as football } from './providers/football.js';
import { calendar } from './providers/calendar.js';
import { provider as countdown } from './providers/countdown.js';
import { provider as parcels } from './providers/parcels.js';
import { provider as airpollen } from './providers/airpollen.js';
import { provider as bikes } from './providers/bikes.js';
import { provider as nightsky } from './providers/nightsky.js';
import { provider as pistatus } from './providers/pistatus.js';
import { provider as network } from './providers/network.js';
import { provider as github } from './providers/github.js';
import { waste, wasteAdminRouter } from './providers/waste.js';
import { f1 } from './providers/f1.js';
import { transit, searchStops } from './providers/transit.js';
import { flights } from './providers/flights.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);

const providers = {
  weather,
  weather_hints: weatherHints,
  news,
  homeassistant,
  tasks,
  fuel,
  football,
  countdown,
  parcels,
  airpollen,
  bikes,
  nightsky,
  pistatus,
  network,
  github,
  calendar,
  waste,
  f1,
  transit,
  flights,
  camera: async (settings, cfg, mod) => ({
    streams: settings.streams
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => s.enabled && s.url)
      .map(({ s, idx }) => ({ name: s.name, src: streamName(mod.id, idx) })),
  }),
};

await loadConfig();
const app = express();
const server = http.createServer(app);
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? true : process.env.TRUST_PROXY);

// Power-saving mode: compressed responses (less to transfer and parse on a slow network/SD).
// Not for the live event stream – compression would hold its messages back.
const compress = compression({ filter: (req, res) => !req.path.startsWith('/api/events') && !req.path.startsWith('/go2rtc') && compression.filter(req, res) });
app.use((req, res, next) => (getConfig()?.general?.ecoMode ? compress(req, res, next) : next()));

app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION, commit: BUILD.shortCommit, clients: clientCount(), oidc: oidcEnabled, localLogin: localEnabled, go2rtc: go2rtcStatus() }));

setupAuth(app);

// ---- Mirror (public, read-only) -------------------------------------------
app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules/leaflet/dist'), { maxAge: '7d' }));
app.use('/vendor/inter', express.static(path.join(root, 'node_modules/@fontsource/inter'), { maxAge: '7d' }));
app.use('/shared', express.static(path.join(root, 'public/shared')));
app.use('/brand', express.static(path.join(root, 'public/brand'), { maxAge: '7d' }));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/brand/favicon.svg'));
app.use('/', express.static(path.join(root, 'public/mirror'), { index: 'index.html' }));

app.get('/api/display', (req, res) => res.set('Cache-Control', 'no-store').json(getDisplay(getConfig())));

app.get('/api/ambient', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json({ ok: true, ...(await ambientWeather(getConfig())) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});
app.get('/api/config', (req, res) => res.set('Cache-Control', 'no-store').json(publicConfig(getConfig())));
app.get('/api/events', sseHandler);

app.get('/api/module/:id/data', async (req, res) => {
  const cfg = getConfig();
  const mod = cfg.modules.find((m) => m.id === req.params.id);
  if (!mod) return res.status(404).json({ error: 'Module not found' });
  const provider = providers[mod.type];
  if (!provider) return res.json({});
  try {
    const data = await provider(mod.settings, cfg, mod);
    recordSuccess(mod.id, data);
    res.set('Cache-Control', 'no-store').json({ ok: true, fetchedAt: new Date().toISOString(), data });
  } catch (err) {
    recordFailure(mod.id, err.message);
    console.warn(`[module ${mod.type}/${mod.id}] ${err.message}`);
    res.status(502).json({ ok: false, error: err.message });
  }
});

mountGo2rtc(app, server, getConfig);

// ---- Admin (local login or OIDC) --------------------------------------------
const admin = express.Router();
admin.use(express.json({ limit: '5mb' }));

admin.get('/me', (req, res) => res.json({ ...req.adminUser, version: VERSION, build: BUILD }));
admin.post('/password', changePassword);
admin.get('/config', (req, res) => res.set('Cache-Control', 'no-store').json(getConfig()));
admin.put('/config', async (req, res) => {
  if (!req.body || !Array.isArray(req.body.modules)) return res.status(400).json({ error: 'Invalid configuration' });
  try {
    res.json(await saveConfig(req.body));
  } catch (err) {
    res.status(500).json({ error: `Saving failed: ${err.message}` });
  }
});

admin.get('/history', async (req, res) => res.json(await listHistory()));
admin.get('/history/:id', async (req, res) => {
  const cfg = await readHistory(req.params.id);
  return cfg ? res.json(cfg) : res.status(404).json({ error: 'Not found' });
});
admin.post('/history/:id/restore', async (req, res) => {
  const cfg = await readHistory(req.params.id);
  if (!cfg) return res.status(404).json({ error: 'Not found' });
  try {
    res.json(await saveConfig(cfg));
  } catch (err) {
    res.status(500).json({ error: `Saving failed: ${err.message}` });
  }
});

admin.get('/export', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res
    .set('Content-Disposition', `attachment; filename="magicmirror-config-${stamp}.json"`)
    .json({ app: 'magicmirror', exportVersion: 1, exportedAt: new Date().toISOString(), config: getConfig() });
});
admin.post('/import', async (req, res) => {
  const body = req.body || {};
  const cfg = body.app === 'magicmirror' && body.config ? body.config : body;
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.modules) || !Array.isArray(cfg.pages)) {
    return res.status(400).json({ error: 'File does not contain a valid Magic Mirror configuration' });
  }
  try {
    res.json(await saveConfig(cfg));
  } catch (err) {
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

admin.post('/reset', async (req, res) => {
  try {
    res.json(await saveConfig(defaultConfig(getConfig()?.general.locale || DEFAULT_LOCALE_ENV)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

admin.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    // Towns: Open-Meteo. Addresses (contain a digit) or no town found: OpenStreetMap (Nominatim).
    const data = await cached(`geo:${q}`, 86400, () =>
      fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '10', language: 'de' })}`),
    ).catch(() => ({}));
    const towns = (data.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, timezone: r.timezone }));
    let places = [];
    if (/\d/.test(q) || !towns.length) {
      places = await searchPlaces(q, { near: getConfig().general.location, lang: langOf(getConfig().general.locale) }).catch(() => []);
    }
    res.json(/\d/.test(q) ? [...places, ...towns] : [...towns, ...places]);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Waste collection by town/address: /api/admin/waste/{search,params,options,fetch} → wastecollect sidecar
admin.use('/waste', wasteAdminRouter());

admin.post('/transit/search', async (req, res) => {
  const { settings = {}, q = '' } = req.body || {};
  if (String(q).trim().length < 2) return res.json([]);
  try {
    res.json(await searchStops(settings, String(q).trim()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Admin preview: data for a module as it is being edited (not saved yet).
admin.post('/preview-data', async (req, res) => {
  const cfg = getConfig();
  const posted = req.body?.module;
  if (!posted || typeof posted !== 'object') return res.status(400).json({ ok: false, error: 'Invalid module' });
  const mod = normalizeConfig({ ...cfg, modules: [posted] }).modules[0];
  const provider = mod && providers[mod.type];
  if (!provider) return res.json({ ok: true, data: {} });
  try {
    res.json({ ok: true, fetchedAt: new Date().toISOString(), data: await provider(mod.settings, cfg, mod) });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

admin.get('/health', (req, res) => res.json(healthReport(getConfig())));
admin.get('/display', (req, res) => res.json(getDisplay(getConfig())));
admin.post('/display', (req, res) => {
  const { mode = null, minutes = 0 } = req.body || {};
  setDisplayOverride(mode, Math.min(24 * 60, Math.max(0, Number(minutes) || 0)));
  res.json(getDisplay(getConfig()));
});

admin.post('/command', (req, res) => {
  const { type, page } = req.body || {};
  if (type === 'reload') broadcast('reload');
  else if (type === 'page') broadcast('page', { page });
  else if (['next', 'prev', 'hold', 'resume'].includes(type)) broadcast('nav', { action: type, minutes: Math.min(24 * 60, Math.max(0, Number(req.body.minutes) || 0)) });
  else return res.status(400).json({ error: 'Unknown command' });
  res.json({ ok: true, clients: clientCount() });
});

// Updates: proxied to the updater container (compose profile "autoupdate").
const UPDATER_URL = (process.env.UPDATER_URL || 'http://updater:8099').replace(/\/+$/, '');
async function updater(cmd, timeout = 10000) {
  const res = await fetch(`${UPDATER_URL}/cgi-bin/${cmd}`, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`Updater: HTTP ${res.status}`);
  return res.json();
}
// Last answer of the updater: while an update keeps Docker busy the updater can answer late –
// then the admin panel keeps seeing "running" instead of "no updater".
let lastUpdaterStatus = null;
admin.get('/update', async (req, res) => {
  try {
    lastUpdaterStatus = { at: Date.now(), status: await updater('status', 4000) };
    res.json({ available: true, version: VERSION, build: BUILD, ...lastUpdaterStatus.status });
  } catch {
    const recent = lastUpdaterStatus && Date.now() - lastUpdaterStatus.at < 30 * 60000;
    if (recent) res.json({ available: true, stale: true, version: VERSION, build: BUILD, ...lastUpdaterStatus.status });
    else res.json({ available: false, version: VERSION, build: BUILD });
  }
});
for (const cmd of ['check', 'run']) {
  admin.post(`/update/${cmd}`, async (req, res) => {
    try {
      const result = await updater(cmd, cmd === 'check' ? 90000 : 10000);
      if (cmd === 'run' && result.ok) lastUpdaterStatus = { at: Date.now(), status: { ...(lastUpdaterStatus?.status || {}), state: 'running', phase: 'start', startedAt: new Date().toISOString(), log: [] } };
      res.json(result);
    } catch {
      res.status(502).json({ error: 'The updater is not reachable' });
    }
  });
}
admin.get('/system', async (req, res) => res.json(await systemInfo(getConfig())));
admin.get('/status', (req, res) => res.json({ clients: clientCount(), go2rtc: go2rtcStatus(), moduleTypes: Object.keys(MODULE_TYPES) }));

// Token-authenticated push API (Apple Shortcuts → tasks module); mirrors refresh at once.
app.use('/api/push', pushRouter(getConfig, (id) => broadcast('refresh', { module: id })));
app.use('/api/admin', requireAdmin({ api: true }), admin);
app.use('/login', express.static(path.join(root, 'public/login'), { index: 'index.html' }));
// index.html must never be cached (it names the current, hashed bundles); the bundles may be.
app.use('/admin', requireAdmin(), express.static(path.join(root, 'public/admin'), {
  index: 'index.html',
  setHeaders: (res, file) => res.setHeader('Cache-Control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable'),
}));

app.use((err, req, res, next) => {
  console.error('[http]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---- Live updates -------------------------------------------------------------
// The server's memory limit (power-saving mode) is set by the container entrypoint at start –
// when the mode is switched, restart (Docker brings the container back within seconds).
const startedEco = !!getConfig().general.ecoMode;
const inContainer = fs.existsSync('/.dockerenv') || process.env.MM_IN_CONTAINER === '1';
onConfigChange((cfg) => {
  broadcast('config', { updatedAt: cfg.updatedAt });
  syncStreams(cfg);
  if (inContainer && !!cfg.general.ecoMode !== startedEco) {
    console.log('[server] power-saving mode changed – restarting to apply the memory limit');
    setTimeout(() => process.exit(0), 1500).unref();
  }
});
syncStreams(getConfig());
setInterval(() => syncStreams(getConfig()), 60000).unref();
startHaLive(getConfig, broadcast, onConfigChange); // Home Assistant websocket → module refresh events

server.listen(PORT, () => console.log(`[server] Magic Mirror listening on port ${PORT} – mirror: /  admin: /admin`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
