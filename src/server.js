import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { VERSION } from './version.js';
import { systemInfo } from './system.js';
import { loadConfig, getConfig, saveConfig, onConfigChange, DEFAULT_LOCALE_ENV } from './config.js';
import { setupAuth, requireAdmin, changePassword, oidcEnabled, localEnabled } from './auth.js';
import { sseHandler, broadcast, clientCount } from './events.js';
import { mountGo2rtc, syncStreams, streamName, go2rtcStatus } from './go2rtc.js';
import { cached, fetchJson } from './util.js';
import { MODULE_TYPES, publicConfig, defaultConfig } from '../public/shared/modules.js';
import { weather, weatherHints } from './providers/weather.js';
import { provider as news } from './providers/news.js';
import { provider as homeassistant } from './providers/homeassistant.js';
import { provider as tasks } from './providers/tasks.js';
import { provider as fuel } from './providers/fuel.js';
import { provider as football } from './providers/football.js';
import { calendar } from './providers/calendar.js';
import { waste } from './providers/waste.js';
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

app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION, clients: clientCount(), oidc: oidcEnabled, localLogin: localEnabled, go2rtc: go2rtcStatus() }));

setupAuth(app);

// ---- Mirror (public, read-only) -------------------------------------------
app.use('/vendor/leaflet', express.static(path.join(root, 'node_modules/leaflet/dist'), { maxAge: '7d' }));
app.use('/vendor/inter', express.static(path.join(root, 'node_modules/@fontsource/inter'), { maxAge: '7d' }));
app.use('/shared', express.static(path.join(root, 'public/shared')));
app.use('/brand', express.static(path.join(root, 'public/brand'), { maxAge: '7d' }));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/brand/favicon.svg'));
app.use('/', express.static(path.join(root, 'public/mirror'), { index: 'index.html' }));

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
    res.set('Cache-Control', 'no-store').json({ ok: true, fetchedAt: new Date().toISOString(), data });
  } catch (err) {
    console.warn(`[module ${mod.type}/${mod.id}] ${err.message}`);
    res.status(502).json({ ok: false, error: err.message });
  }
});

mountGo2rtc(app, server, getConfig);

// ---- Admin (local login or OIDC) --------------------------------------------
const admin = express.Router();
admin.use(express.json({ limit: '5mb' }));

admin.get('/me', (req, res) => res.json({ ...req.adminUser, version: VERSION }));
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
    const data = await cached(`geo:${q}`, 86400, () =>
      fetchJson(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '10', language: 'de' })}`),
    );
    res.json((data.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude, timezone: r.timezone })));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

admin.post('/transit/search', async (req, res) => {
  const { settings = {}, q = '' } = req.body || {};
  if (String(q).trim().length < 2) return res.json([]);
  try {
    res.json(await searchStops(settings, String(q).trim()));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

admin.post('/command', (req, res) => {
  const { type, page } = req.body || {};
  if (type === 'reload') broadcast('reload');
  else if (type === 'page') broadcast('page', { page });
  else return res.status(400).json({ error: 'Unknown command' });
  res.json({ ok: true, clients: clientCount() });
});

admin.get('/system', async (req, res) => res.json(await systemInfo(getConfig())));
admin.get('/status', (req, res) => res.json({ clients: clientCount(), go2rtc: go2rtcStatus(), moduleTypes: Object.keys(MODULE_TYPES) }));

app.use('/api/admin', requireAdmin({ api: true }), admin);
app.use('/login', express.static(path.join(root, 'public/login'), { index: 'index.html' }));
app.use('/admin', requireAdmin(), express.static(path.join(root, 'public/admin'), { index: 'index.html' }));

app.use((err, req, res, next) => {
  console.error('[http]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---- Live updates -------------------------------------------------------------
onConfigChange((cfg) => {
  broadcast('config', { updatedAt: cfg.updatedAt });
  syncStreams(cfg);
});
syncStreams(getConfig());
setInterval(() => syncStreams(getConfig()), 60000).unref();

server.listen(PORT, () => console.log(`[server] Magic Mirror listening on port ${PORT} – mirror: /  admin: /admin`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
