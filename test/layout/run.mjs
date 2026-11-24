// Layout tests: the real mirror (server + page) with test data for every module, in WebKit
// (like the kiosk on the Pi) and Chromium, portrait and landscape. Each scenario is checked for
//   - modules cut off by their area (content taller/wider than the region),
//   - modules overlapping each other,
//   - content sticking out of its module (not clipped by an ellipsis/overflow on purpose),
//   - modules that render nothing although they have data, error states, JS errors.
// Screenshots of every scenario land in test/layout/out/ for a look by eye.
//
// Run (Docker, no local Node needed):
//   docker run --rm -v "$PWD":/app -w /app/test/layout mcr.microsoft.com/playwright:v1.49.1-noble \
//     sh -c "npm i --no-audit --no-fund --silent && node run.mjs"
// Options (env): TYPES=weather,tasks  SCENARIOS=solo,long,dense,options  BROWSERS=webkit,chromium
//                SCREENS=portrait,landscape  VERBOSE=1  WARNINGS=1  OUT=out (screenshot folder)  CONCURRENCY=4
//                ONLY=solo-clock-1,dense-hallway (just these scenarios)
// Performance: PERF=1 BROWSERS=chromium CONCURRENCY=1 measures, per scenario, the main-thread
// time per second while the mirror sits idle (CPU slowed down PERF_THROTTLE=6 times, roughly a
// Pi) and lists running animations with VERBOSE=1. More than a few ms/s, or style/layout
// ~60 times a second, means something animates a property the graphics chip can't do alone.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { MODULE_TYPES, defaultModule, normalizeConfig, publicConfig } from '../../public/shared/modules.js';
import { fixtureFor, IMAGE_SVG } from './fixtures/index.js';
import { scenarios } from './scenarios.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.resolve(here, process.env.OUT || 'out');
const list = (v, all) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : all);

const SCREENS = { portrait: { width: 1080, height: 1920 }, landscape: { width: 1920, height: 1080 } };
const BROWSERS = { webkit, chromium };
const want = {
  types: list(process.env.TYPES, null),
  scenarios: list(process.env.SCENARIOS, ['solo', 'long', 'dense', 'options']),
  browsers: list(process.env.BROWSERS, ['webkit', 'chromium']),
  screens: list(process.env.SCREENS, ['portrait', 'landscape']),
};
const VERBOSE = !!process.env.VERBOSE;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 4);

// ---- server ---------------------------------------------------------------------------------
async function startServer() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mm-layout-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: 'test', TZ: 'Europe/Berlin' },
    stdio: VERBOSE ? 'inherit' : 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, stop: () => proc.kill() };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  proc.kill();
  throw new Error('server did not start');
}

// ---- config ---------------------------------------------------------------------------------
// A scenario lists modules as { type, region, width?, height?, title?, settings?, long? }.
function buildConfig(sc) {
  const modules = sc.modules.map((m, i) => {
    const mod = defaultModule(m.type, { region: m.region, order: i, pages: ['*'], width: m.width || 'full', height: m.height || 'auto' }, 'de-DE');
    mod.id = `t${i}_${m.type}`;
    if (m.title !== undefined) mod.title = m.title;
    Object.assign(mod.settings, m.settings || {});
    // modules whose content comes from their settings, not from the server
    if (m.type === 'text' && !mod.settings.content) mod.settings.content = m.long ? `WLAN: Gäste-${'Netzwerk'.repeat(3)} · Passwort: ${'Sonnenblume'.repeat(4)}\nBitte Schuhe ausziehen – Donaudampfschifffahrtsgesellschaftskapitän` : 'WLAN: Gäste · Passwort: Sonnenblume42';
    return mod;
  });
  const cfg = normalizeConfig({
    version: 1,
    general: { locale: 'de-DE', timezone: 'Europe/Berlin', location: { name: 'Leipzig', lat: 51.34, lon: 12.37 }, burnInShift: false, transition: 'none', ...sc.general },
    pages: [{ id: 'p', name: 'Test', duration: 0, enabled: true }],
    modules,
  }, 'de-DE');
  return { cfg, modules: sc.modules };
}

// ---- checks (run in the page) -------------------------------------------------------------
/* global document, getComputedStyle, window */
function inspect() {
  const T = 2; // px tolerance
  const issues = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom };
  };
  const inter = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const area = (a) => Math.max(0, a.r - a.l) * Math.max(0, a.b - a.t);
  const clips = (el) => {
    const s = getComputedStyle(el);
    return s.overflowX !== 'visible' || s.overflowY !== 'visible' || (s.contain || '').includes('paint');
  };
  // the part of a region that is shown (overflow + the clip-path strips of "fill" regions)
  const regionBox = (reg) => {
    const r = rectOf(reg);
    const s = getComputedStyle(reg);
    if (s.clipPath && s.clipPath.startsWith('inset(')) {
      const [top, , bottom] = s.clipPath.slice(6).split(/\s+/).map((x) => parseFloat(x) || 0);
      r.t += top;
      r.b -= bottom;
    }
    return r;
  };
  const name = (m) => {
    const title = m.querySelector(':scope > .mod-title')?.textContent;
    return `${m.dataset.id} (${m.closest('.region')?.dataset.region}${m.classList.contains('half') ? ', half' : ''}${m.classList.contains('fill') ? ', fill' : ''})${title ? ` [${title}]` : ''}`;
  };

  const mods = [...document.querySelectorAll('.region .module')].filter((m) => {
    const s = getComputedStyle(m);
    return s.display !== 'none' && s.visibility !== 'hidden' && !m.classList.contains('empty') && !m.classList.contains('no-content') && m.getClientRects().length;
  });
  const shown = [];
  for (const m of mods) {
    const reg = m.closest('.region');
    const box = rectOf(m);
    const rb = regionBox(reg);
    const body = m.querySelector('.mod-body');
    if (m.classList.contains('has-error')) issues.push({ kind: 'error', module: name(m), detail: (body?.textContent || '').trim().slice(0, 160) });
    if (m.querySelector('.loading')) issues.push({ kind: 'not-loaded', module: name(m) });
    // an area squeezed to nothing by its full neighbours (e.g. the middle row when top and
    // bottom fill the screen) is a matter of space, like a cut-off module
    const squeezed = rb.b - rb.t < 4 || (rb.b - rb.t < 100 && body && body.scrollHeight > 4 && body.getBoundingClientRect().height < 4);
    if (squeezed && reg.dataset.region !== 'fullscreen') issues.push({ kind: 'no-space', module: name(m), detail: `its area has only ${Math.round(Math.max(0, rb.b - rb.t))}px height left` });
    else if (body && body.getBoundingClientRect().height < 4 && !m.classList.contains('empty')) issues.push({ kind: 'renders-nothing', module: name(m) });
    if (reg.dataset.region !== 'fullscreen') {
      const cut = { top: rb.t - box.t, bottom: box.b - rb.b, left: rb.l - box.l, right: box.r - rb.r };
      const worst = Object.entries(cut).filter(([, v]) => v > T).map(([k, v]) => `${k} ${Math.round(v)}px`);
      // middle regions fade out their bottom on purpose (mask) – more than that is cut off
      if (worst.length) issues.push({ kind: 'clipped-by-region', module: name(m), detail: worst.join(', ') });
    }
    // the shown part (after the region's clipping) must be on the screen
    const seen = reg.dataset.region === 'fullscreen' ? box : inter(box, rb);
    if (area(seen) > 0 && (seen.r > vw + T || seen.b > vh + T || seen.l < -T || seen.t < -T)) issues.push({ kind: 'offscreen', module: name(m), detail: `${Math.round(seen.l)},${Math.round(seen.t)}–${Math.round(seen.r)},${Math.round(seen.b)}` });
    shown.push({ m, vis: reg.dataset.region === 'fullscreen' ? null : inter(box, rb) });

    // content that sticks out of the module (after the clipping of its own ancestors)
    const wrapBox = box;
    let reported = 0;
    for (const el of m.querySelectorAll('*')) {
      if (reported >= 3) break;
      if (el.closest('.leaflet-container') && el !== el.closest('.leaflet-container')) continue; // map internals
      const rects = el.getClientRects();
      if (!rects.length) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.opacity === '0' || st.position === 'fixed') continue;
      let r = rectOf(el);
      if (area(r) === 0) continue;
      for (let a = el.parentElement; a && a !== m; a = a.parentElement) if (clips(a)) r = inter(r, rectOf(a));
      if (area(r) === 0) continue;
      const out = Math.max(r.r - wrapBox.r, wrapBox.l - r.l);
      if (out > 4) {
        issues.push({ kind: 'overflows-module', module: name(m), detail: `<${el.tagName.toLowerCase()} class="${el.className?.baseVal ?? el.className}"> sticks out ${Math.round(out)}px: "${(el.textContent || '').trim().slice(0, 60)}"` });
        reported++;
      }
    }
  }
  // modules covering each other
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i].vis;
      const b = shown[j].vis;
      if (!a || !b) continue;
      const x = inter(a, b);
      if (x.r - x.l > T && x.b - x.t > T) issues.push({ kind: 'overlap', module: name(shown[i].m), detail: `with ${name(shown[j].m)}: ${Math.round(x.r - x.l)}×${Math.round(x.b - x.t)}px` });
    }
  }
  // the page itself must not scroll
  const se = document.scrollingElement;
  if (se.scrollWidth > vw + T || se.scrollHeight > vh + T) issues.push({ kind: 'page-scrolls', module: '-', detail: `${se.scrollWidth}×${se.scrollHeight}` });
  return { issues, shown: shown.length };
}

// ---- run ---------------------------------------------------------------------------------
async function runScenario(browser, screenName, sc, server) {
  const { cfg } = buildConfig(sc);
  const pub = publicConfig(cfg);
  const byId = Object.fromEntries(cfg.modules.map((m, i) => [m.id, { mod: m, spec: sc.modules[i] }]));
  const ctx = await browser.newContext({ viewport: SCREENS[screenName], deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|net::ERR|blocked|ERR_FAILED/i.test(msg.text())) jsErrors.push(msg.text());
  });
  const now = new Date();
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== server.url) {
      // no network: images get a placeholder, everything else fails like an offline mirror
      if (route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGE_SVG });
      return route.abort();
    }
    if (u.pathname === '/api/config') return route.fulfill({ json: pub, headers: { 'Cache-Control': 'no-store' } });
    const m = u.pathname.match(/^\/api\/module\/([^/]+)\/data$/);
    if (m) {
      const entry = byId[decodeURIComponent(m[1])];
      if (!entry) return route.fulfill({ status: 404, json: { error: 'not found' } });
      const data = await fixtureFor(entry.mod.type, { now, settings: entry.mod.settings, long: !!entry.spec.long, general: cfg.general });
      return route.fulfill({ json: { ok: true, fetchedAt: now.toISOString(), data } });
    }
    // the go2rtc player script: an empty module (no stream server in the test)
    if (u.pathname.startsWith('/go2rtc/') && route.request().resourceType() === 'script') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    if (/^\/api\/module\/[^/]+\/cover/.test(u.pathname) || u.pathname.startsWith('/api/camera') || u.pathname.startsWith('/go2rtc/')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGE_SVG });
    return route.continue();
  });
  await page.goto(`${server.url}/?page=p`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  // all modules loaded (or failed), fonts ready, fades and the fill layout done
  await page.waitForFunction(() => !document.querySelector('.module:not(.off):not(.empty) .loading'), null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1600);
  if (process.env.DEBUG_REGIONS) console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.region')].filter((r) => r.children.length).map((r) => ({ r: r.dataset.region, box: r.getBoundingClientRect().toJSON(), st: r.getAttribute('style'), kids: [...r.children].map((c) => [c.className, Math.round(c.getBoundingClientRect().top), Math.round(c.getBoundingClientRect().height)]) }))), null, 1));
  if (process.env.PERF) {
    // main-thread cost while the mirror just sits there (Chromium only: CDP metrics), on a
    // CPU slowed down roughly to a Raspberry Pi
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.PERF_THROTTLE) || 6 });
    await cdp.send('Performance.enable');
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const a = await metrics();
    const secs = Number(process.env.PERF_SECONDS) || 10;
    await page.waitForTimeout(secs * 1000);
    const b = await metrics();
    const d = (k) => (b[k] - a[k]) / secs;
    const anims = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').map((x) => {
      const t = x.effect?.target;
      const props = [...new Set((x.effect?.getKeyframes?.() || []).flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))];
      return `${x.animationName || x.constructor.name}(${props.join('+')})@${t?.closest?.('.module')?.dataset.id || t?.id || t?.className?.baseVal || t?.className || '?'}`;
    }));
    await ctx.close();
    return { issues: [], shown: 0, perf: { taskMs: d('TaskDuration') * 1000, scriptMs: d('ScriptDuration') * 1000, styleMs: d('RecalcStyleDuration') * 1000, layoutMs: d('LayoutDuration') * 1000, styles: d('RecalcStyleCount'), layouts: d('LayoutCount'), anims } };
  }
  const res = await page.evaluate(inspect);
  for (const e of jsErrors) res.issues.push({ kind: 'js-error', module: '-', detail: e.slice(0, 200) });
  const dir = path.join(OUT, browser.browserType().name(), screenName);
  await fs.mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${sc.name}.png`) });
  await ctx.close();
  return res;
}

const server = await startServer();
let failed = 0;
let warned = 0;
const WARN = new Set(['clipped-by-region', 'no-space']);
const report = [];
try {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  const only = list(process.env.ONLY, null); // run just these scenarios by name
  const all = scenarios(Object.keys(MODULE_TYPES)).filter((sc) => (only ? only.includes(sc.name) : want.scenarios.includes(sc.kind) && (!want.types || sc.types.some((t) => want.types.includes(t)))));
  for (const bName of want.browsers) {
    const browser = await BROWSERS[bName].launch();
    const jobs = want.screens.flatMap((screen) => all.map((sc) => ({ screen, sc })));
    // several pages at once (each in its own context) – the server answers from test data
    const worker = async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) {
        const { screen, sc } = job;
        let res;
        try {
          res = await runScenario(browser, screen, sc, server);
        } catch (err) {
          res = { issues: [{ kind: 'crash', module: '-', detail: err.message.split('\n')[0] }], shown: 0 };
        }
        const label = `${bName} ${screen} ${sc.name}`;
        report.push({ browser: bName, screen, scenario: sc.name, ...res });
        if (res.perf) {
          const p = res.perf;
          console.log(`${sc.name.padEnd(34)} task ${p.taskMs.toFixed(1).padStart(6)} ms/s · script ${p.scriptMs.toFixed(1).padStart(5)} · style ${p.styleMs.toFixed(1).padStart(5)} (${p.styles.toFixed(1)}/s) · layout ${p.layoutMs.toFixed(1).padStart(5)} (${p.layouts.toFixed(1)}/s) · ${p.anims.length} anim`);
          if (VERBOSE && p.anims.length) console.log(`    ${[...new Set(p.anims)].join('\n    ')}`);
          continue;
        }
        // a module taller than its area is cut off (middle areas fade it out) – that is a matter
        // of how much it shows, so it is a warning; everything else is a layout bug
        res.warnings = res.issues.filter((i) => WARN.has(i.kind));
        res.issues = res.issues.filter((i) => !WARN.has(i.kind));
        warned += res.warnings.length ? 1 : 0;
        if (process.env.WARNINGS && res.warnings.length) console.log(`! ${label}\n${res.warnings.map((i) => `    ${i.kind.padEnd(18)} ${i.module}${i.detail ? ` – ${i.detail}` : ''}`).join('\n')}`);
        if (res.issues.length) {
          failed++;
          console.log(`✗ ${label}\n${res.issues.map((i) => `    ${i.kind.padEnd(18)} ${i.module}${i.detail ? ` – ${i.detail}` : ''}`).join('\n')}`);
        } else if (VERBOSE) console.log(`✓ ${label} (${res.shown} modules)`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    await browser.close();
  }
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
} finally {
  server.stop();
}
console.log(`\n${report.length - failed} of ${report.length} scenario runs without findings (${warned} with content cut off by its area – WARNINGS=1 lists them) · screenshots: ${path.relative(root, OUT)}/`);
process.exit(failed ? 1 : 0);
