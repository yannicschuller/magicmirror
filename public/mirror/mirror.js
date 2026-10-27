import { REGIONS, MODULE_TYPES } from '/shared/modules.js';
import { renderers, makeFmt, esc } from './renderers.js';
import { translator, langOf } from '/shared/i18n.js';
import { scheduleActive, activePages } from '/shared/schedule.js';
import { setAmbient } from './ambient.js';

const params = new URLSearchParams(location.search);
const pinnedPage = params.get('page');
const stage = document.getElementById('stage');
const grid = document.getElementById('grid');
const indicator = document.getElementById('indicator');
const progress = document.getElementById('progress');
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
    clearTimeout(inst.fadeTimer);
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
    wrap.className = `module mod-${mod.type}${mod.height === 'fill' ? ' fill' : ''} off`;
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
  // ?page=<id> pins a page regardless of its schedule.
  pages = pinnedPage && config.pages.some((p) => p.id === pinnedPage) ? config.pages : activePages(config);
  const pinned = pages.findIndex((p) => p.id === pinnedPage);
  showPage(pinned >= 0 ? pinned : Math.min(pageIndex, pages.length - 1), true);
}

function refreshSeconds(inst) {
  if (inst.mod.type === 'flights' || inst.mod.type === 'fuel') return inst.mod.settings.refreshSeconds;
  return inst.api.refreshSeconds?.() || inst.type.refresh; // e.g. F1: fast while a session is live
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
    // Unchanged data → no re-render (no flicker); the first data fades in.
    const sig = JSON.stringify(json.data);
    if (sig !== inst.lastSig) {
      const first = !inst.lastSig;
      inst.lastSig = sig;
      inst.api.update(json.data);
      if (first) {
        const body = inst.wrap.querySelector('.mod-body');
        body.classList.remove('fade-in');
        void body.offsetWidth;
        body.classList.add('fade-in');
      }
    }
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
  const delay = inst.failures ? Math.min(every || 300, 30 * inst.failures) : refreshSeconds(inst);
  if (delay) inst.fetchTimer = setTimeout(() => (inst.visible ? loadData(inst) : (inst.stale = true)), delay * 1000);
}

// ---- pages ---------------------------------------------------------------------
function onPage(mod, page) {
  return (mod.pages.includes('*') || mod.pages.includes(page.id)) && scheduleActive(mod.schedule, new Date(), config.general.timezone);
}

// Modules with height "fill" take over empty areas above/below them in their column.
const COLUMNS = { left: 1, center: 2, right: 3 };
const ROWS = ['top', 'middle', 'bottom'];
function layoutFill() {
  const visible = (region) => instances.some((i) => i.visible && i.mod.region === region);
  for (const [col, colIndex] of Object.entries(COLUMNS)) {
    const regions = ROWS.map((row) => grid.querySelector(`.region[data-region="${row}_${col}"]`));
    regions.forEach((el) => (el.style.gridRow = el.style.gridColumn = ''));
    ROWS.forEach((row, r) => {
      const fills = instances.some((i) => i.visible && i.mod.region === `${row}_${col}` && i.mod.height === 'fill');
      if (!fills) return;
      let start = r;
      let end = r;
      while (start > 0 && !visible(`${ROWS[start - 1]}_${col}`)) start--;
      while (end < ROWS.length - 1 && !visible(`${ROWS[end + 1]}_${col}`)) end++;
      if (start === end) return;
      // grid rows: 1 = top bar, 2 = top, 3 = middle, 4 = bottom, 5 = bottom bar
      regions[r].style.gridRow = `${start + 2} / ${end + 3}`;
      regions[r].style.gridColumn = String(colIndex);
    });
  }
}

// Re-evaluate schedules without switching the page.
// Page changes fade out first, then swap, then fade in – both pages are never in the
// layout at the same time, so nothing jumps. Data of the entering modules loads during
// the fade-out (or was prefetched already).
const FADE_OUT = 350;
let layoutTimer = null;
function applyVisibility(immediate = false) {
  const page = pages[pageIndex];
  if (!page) return;
  const animate = !immediate && config.general.transition !== 'none';
  const changes = instances.filter((inst) => onPage(inst.mod, page) !== inst.visible);
  const leaving = animate && changes.some((inst) => inst.visible);
  const delay = leaving ? FADE_OUT : 0;
  for (const inst of changes) {
    const want = !inst.visible;
    inst.visible = want;
    // Timers (not requestAnimationFrame – paused in hidden tabs); always cancel the
    // other direction so fast page switches never leave a module half-faded.
    clearTimeout(inst.fadeTimer);
    const cls = inst.wrap.classList;
    if (want) {
      const every = refreshSeconds(inst);
      if (!inst.lastFetch || inst.stale || (every && Date.now() - inst.lastFetch > every * 1000)) {
        inst.stale = false;
        loadData(inst);
      }
      const enter = () => {
        cls.remove('off', 'leaving');
        if (animate) {
          cls.add('entering');
          void inst.wrap.offsetWidth; // start the transition from the "entering" state
          inst.fadeTimer = setTimeout(() => cls.remove('entering'), 20);
        } else cls.remove('entering');
        inst.api.show?.();
        inst.api.tick?.();
      };
      if (delay) {
        cls.add('off');
        inst.fadeTimer = setTimeout(enter, delay);
      } else enter();
    } else {
      inst.api.hide?.();
      cls.remove('entering');
      if (!animate) cls.add('off');
      else {
        cls.add('leaving');
        inst.fadeTimer = setTimeout(() => {
          cls.remove('leaving');
          if (!inst.visible) cls.add('off');
        }, FADE_OUT);
      }
    }
  }
  clearTimeout(layoutTimer);
  if (delay) layoutTimer = setTimeout(layoutFill, delay);
  else layoutFill();
}

// Load the data of the next page's modules in the background shortly before it shows.
let prefetchTimer = null;
function prefetch(page) {
  for (const inst of instances) {
    if (inst.visible || !inst.api.update || !onPage(inst.mod, page)) continue;
    const every = refreshSeconds(inst);
    if (!inst.lastFetch || inst.stale || (every && Date.now() - inst.lastFetch > every * 1000)) {
      inst.stale = false;
      loadData(inst);
    }
  }
}

function showPage(index, immediate = false) {
  clearTimeout(pageTimer);
  if (!pages.length) return;
  pageIndex = ((index % pages.length) + pages.length) % pages.length;
  const page = pages[pageIndex];
  applyVisibility(immediate);
  setAmbient(page.ambient);
  clearTimeout(prefetchTimer);
  const rotating = config.general.rotatePages && pages.length > 1 && !pinnedPage;
  renderIndicator(rotating ? page.duration : 0);
  if (rotating) {
    pageTimer = setTimeout(() => showPage(pageIndex + 1), page.duration * 1000);
    const next = pages[(pageIndex + 1) % pages.length];
    prefetchTimer = setTimeout(() => prefetch(next), Math.max(0, page.duration * 1000 - 5000));
  }
}

// Page indicator: dots, a progress bar running until the next page, or both.
function renderIndicator(seconds) {
  const style = config.general.indicatorStyle || 'dots';
  const dots = config.general.pageIndicator && pages.length > 1 && style !== 'bar';
  indicator.hidden = !dots;
  if (dots) indicator.innerHTML = pages.map((p, i) => `<span class="${i === pageIndex ? 'active' : ''}" title="${esc(p.name)}"></span>`).join('');
  const bar = config.general.pageIndicator && pages.length > 1 && style !== 'dots';
  progress.hidden = !bar;
  if (!bar) return;
  const fill = progress.firstElementChild;
  fill.style.transition = 'none';
  fill.style.transform = 'scaleX(0)';
  void fill.offsetWidth;
  if (seconds) {
    fill.style.transition = `transform ${seconds}s linear`;
    fill.style.transform = 'scaleX(1)';
  } else fill.style.transform = 'scaleX(1)'; // not rotating: full bar
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
  // New data was pushed for a module (e.g. Apple Reminders) – fetch it now.
  es.addEventListener('refresh', (e) => {
    const { module } = JSON.parse(e.data);
    for (const inst of instances.filter((i) => i.mod.id === module)) {
      if (inst.visible) loadData(inst);
      else inst.stale = true;
    }
  });
  es.addEventListener('page', (e) => {
    const { page } = JSON.parse(e.data);
    let i = pages.findIndex((p) => p.id === page);
    // "Show" from the admin also works for pages that are currently not rotating
    // (switched off, outside their schedule …): shown once, then rotation continues.
    if (i < 0) {
      const extra = config.pages.find((p) => p.id === page);
      if (!extra) return;
      pages = [...pages, extra];
      i = pages.length - 1;
    }
    showPage(i);
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
setInterval(() => {
  updateDim();
  if (!config) return;
  // Page schedules / date ranges: keep the current page if it is still active.
  const next = pinnedPage ? pages : activePages(config);
  if (next.map((p) => p.id).join() !== pages.map((p) => p.id).join()) {
    const current = pages[pageIndex]?.id;
    pages = next;
    const keep = pages.findIndex((p) => p.id === current);
    showPage(keep >= 0 ? keep : 0);
  } else applyVisibility();
}, 60000);
