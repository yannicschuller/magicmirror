import { REGIONS, MODULE_TYPES } from '/shared/modules.js';
import { renderers, makeFmt, esc } from './renderers.js';
import { translator, langOf } from '/shared/i18n.js';

const params = new URLSearchParams(location.search);
const pinnedPage = params.get('page');
const stage = document.getElementById('stage');
const grid = document.getElementById('grid');
const indicator = document.getElementById('indicator');
const dimLayer = document.getElementById('dim');
const statusEl = document.getElementById('status');

let config = null;
let pages = [];
let pageIndex = 0;
let pageTimer = null;
let instances = [];

// ---- config & theme -----------------------------------------------------------
async function fetchConfig() {
  const res = await fetch('/api/config', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function applyTheme(g) {
  const root = document.documentElement.style;
  root.setProperty('--bg', g.background);
  root.setProperty('--fg', g.textColor);
  root.setProperty('--accent', g.accentColor);
  root.setProperty('--scale', g.fontScale);
  root.setProperty('--pad', `${g.padding}vmin`);
  document.body.classList.toggle('hide-cursor', g.hideCursor);
  document.body.classList.toggle('no-titles', !g.showTitles);
  document.body.dataset.transition = g.transition;
  stage.dataset.rotation = g.rotation;
  document.title = g.name;
  document.documentElement.lang = langOf(g.locale);
}

// ---- modules ------------------------------------------------------------------
function destroyAll() {
  for (const inst of instances) {
    clearInterval(inst.tickTimer);
    clearTimeout(inst.fetchTimer);
    try { inst.api.destroy?.(); } catch (err) { console.error(err); }
  }
  instances = [];
  grid.querySelectorAll('.region').forEach((r) => (r.innerHTML = ''));
}

function build() {
  destroyAll();
  const ctx = { general: config.general, fmt: makeFmt(config.general) };
  const mods = config.modules.filter((m) => m.enabled && renderers[m.type]).sort((a, b) => a.order - b.order);
  for (const mod of mods) {
    const region = grid.querySelector(`.region[data-region="${mod.region}"]`);
    const wrap = document.createElement('section');
    wrap.className = `module mod-${mod.type} off`;
    wrap.dataset.id = mod.id;
    wrap.innerHTML = `${mod.title ? `<header class="mod-title">${esc(mod.title)}</header>` : ''}<div class="mod-body"><div class="dim small loading">${ctx.fmt.t('Loading …')}</div></div>`;
    region.append(wrap);
    const body = wrap.querySelector('.mod-body');
    let api;
    try {
      api = renderers[mod.type](body, mod, ctx, mod.region) || {};
    } catch (err) {
      console.error(mod.type, err);
      body.innerHTML = `<div class="err small">${esc(err.message)}</div>`;
      api = {};
    }
    const inst = { mod, wrap, api, visible: false, lastFetch: 0, type: MODULE_TYPES[mod.type] };
    if (api.tick && api.tickEvery) inst.tickTimer = setInterval(() => inst.visible && api.tick(), api.tickEvery);
    instances.push(inst);
  }
  pages = config.pages.filter((p) => p.enabled);
  if (!pages.length) pages = config.pages.slice(0, 1);
  const pinned = pages.findIndex((p) => p.id === pinnedPage);
  showPage(pinned >= 0 ? pinned : Math.min(pageIndex, pages.length - 1), true);
}

function refreshSeconds(inst) {
  if (inst.mod.type === 'flights' || inst.mod.type === 'fuel') return inst.mod.settings.refreshSeconds;
  return inst.type.refresh;
}

async function loadData(inst) {
  clearTimeout(inst.fetchTimer);
  if (!inst.api.update) return;
  const every = refreshSeconds(inst);
  inst.lastFetch = Date.now();
  try {
    const res = await fetch(`/api/module/${encodeURIComponent(inst.mod.id)}/data`, { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (!instances.includes(inst)) return;
    inst.api.update(json.data);
    inst.wrap.classList.remove('has-error');
    inst.failures = 0;
  } catch (err) {
    inst.failures = (inst.failures || 0) + 1;
    console.warn(`[${inst.mod.type}]`, err.message);
    // Keep the last good render; show the error only if there never was data.
    if (inst.wrap.querySelector('.loading')) inst.wrap.querySelector('.mod-body').innerHTML = `<div class="err small">${esc(makeFmt(config.general).t(err.message))}</div>`;
    inst.wrap.classList.add('has-error');
  }
  if (!instances.includes(inst)) return;
  // Retry faster after errors, otherwise follow the module's refresh interval.
  const delay = inst.failures ? Math.min(every || 300, 30 * inst.failures) : every;
  if (delay) inst.fetchTimer = setTimeout(() => (inst.visible ? loadData(inst) : (inst.stale = true)), delay * 1000);
}

// ---- pages ---------------------------------------------------------------------
function onPage(mod, page) {
  return mod.pages.includes('*') || mod.pages.includes(page.id);
}

function showPage(index, immediate = false) {
  clearTimeout(pageTimer);
  if (!pages.length) return;
  pageIndex = ((index % pages.length) + pages.length) % pages.length;
  const page = pages[pageIndex];
  const transition = config.general.transition;
  for (const inst of instances) {
    const want = onPage(inst.mod, page);
    if (want === inst.visible) continue;
    inst.visible = want;
    if (want) {
      inst.wrap.classList.remove('off');
      if (!immediate && transition !== 'none') {
        inst.wrap.classList.add('entering');
        requestAnimationFrame(() => requestAnimationFrame(() => inst.wrap.classList.remove('entering')));
      }
      inst.api.show?.();
      inst.api.tick?.();
      const every = refreshSeconds(inst);
      if (!inst.lastFetch || inst.stale || (every && Date.now() - inst.lastFetch > every * 1000)) {
        inst.stale = false;
        loadData(inst);
      }
    } else {
      inst.api.hide?.();
      if (immediate || transition === 'none') inst.wrap.classList.add('off');
      else {
        inst.wrap.classList.add('leaving');
        setTimeout(() => {
          inst.wrap.classList.remove('leaving');
          if (!inst.visible) inst.wrap.classList.add('off');
        }, 600);
      }
    }
  }
  renderIndicator();
  if (config.general.rotatePages && pages.length > 1 && !pinnedPage) {
    pageTimer = setTimeout(() => showPage(pageIndex + 1), page.duration * 1000);
  }
}

function renderIndicator() {
  const show = config.general.pageIndicator && pages.length > 1;
  indicator.hidden = !show;
  if (!show) return;
  indicator.innerHTML = pages.map((p, i) => `<span class="${i === pageIndex ? 'active' : ''}" title="${esc(p.name)}"></span>`).join('');
}

// ---- night dimming & housekeeping ----------------------------------------------------
function minutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function updateDim() {
  const g = config?.general;
  if (!g || !g.dimEnabled) {
    dimLayer.style.opacity = 0;
    return;
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: g.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const now = minutes(parts);
  const from = minutes(g.dimFrom);
  const to = minutes(g.dimTo);
  const active = from <= to ? now >= from && now < to : now >= from || now < to;
  dimLayer.style.opacity = active ? 1 - g.dimBrightness / 100 : 0;
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  const h = config.general.autoReloadHours;
  if (h > 0) reloadTimer = setTimeout(() => location.reload(), h * 3600 * 1000);
}

async function init() {
  try {
    config = await fetchConfig();
    statusEl.hidden = true;
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = translator(langOf(navigator.language))('Server unreachable – retrying …');
    setTimeout(init, 10000);
    return;
  }
  applyTheme(config.general);
  build();
  updateDim();
  scheduleReload();
}

function buildGrid() {
  grid.innerHTML = REGIONS.map((r) => `<div class="region" data-region="${r.id}"></div>`).join('');
}

// ---- live updates (SSE) -------------------------------------------------------------
function connectEvents() {
  const es = new EventSource('/api/events');
  let lastUpdate = null;
  es.addEventListener('config', async (e) => {
    const { updatedAt } = JSON.parse(e.data);
    if (updatedAt === lastUpdate) return;
    lastUpdate = updatedAt;
    try {
      config = await fetchConfig();
      applyTheme(config.general);
      build();
      updateDim();
      scheduleReload();
    } catch (err) {
      console.warn(err);
    }
  });
  let serverVersion = null;
  es.addEventListener('hello', (e) => {
    const { version } = JSON.parse(e.data);
    if (serverVersion && version !== serverVersion) location.reload();
    serverVersion = version;
  });
  es.addEventListener('reload', () => location.reload());
  es.addEventListener('page', (e) => {
    const { page } = JSON.parse(e.data);
    const i = pages.findIndex((p) => p.id === page);
    if (i >= 0) showPage(i);
  });
  es.onopen = () => (statusEl.hidden = true);
}

// ---- manual navigation (keyboard, touch) ----------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ') showPage(pageIndex + 1);
  if (e.key === 'ArrowLeft') showPage(pageIndex - 1);
});
let touchX = null;
document.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
document.addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 60) showPage(pageIndex + (dx < 0 ? 1 : -1));
  touchX = null;
});
indicator.addEventListener('click', (e) => {
  const i = [...indicator.children].indexOf(e.target);
  if (i >= 0) showPage(i);
});

buildGrid();
init().then(connectEvents);
setInterval(updateDim, 60000);
