import { REGIONS, MODULE_TYPES, placementOn } from '/shared/modules.js';
import { renderers, makeFmt, esc } from './renderers.js';
import { translator, langOf } from '/shared/i18n.js';
import { scheduleActive, activePages, onDisplay } from '/shared/schedule.js';
import { displayState } from '/shared/night.js';
import { moduleHasContent } from '/shared/conditions.js';
import { setAmbient } from './ambient.js';

const params = new URLSearchParams(location.search);
const pinnedPage = params.get('page');
// ?preview=1: admin preview – gets the unsaved config from the admin page (postMessage)
// and loads module data for exactly those settings.
const preview = params.has('preview');
// ?display=<id>: this mirror's name when several mirrors show different pages
const display = params.get('display') || '';
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

const FONTS = {
  inter: "'Inter', system-ui, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif",
  serif: "Georgia, 'DejaVu Serif', 'Times New Roman', serif",
  mono: "ui-monospace, 'DejaVu Sans Mono', Menlo, monospace",
};

function applyTheme(g) {
  const root = document.documentElement.style;
  root.setProperty('--bg', g.background);
  root.setProperty('--fg', g.textColor);
  root.setProperty('--accent', g.accentColor);
  root.setProperty('--scale', g.fontScale);
  root.setProperty('--font', FONTS[g.fontFamily] || FONTS.inter);
  root.setProperty('--weight', g.fontWeight || '300');
  root.setProperty('--pad', `${g.padding}vmin`);
  document.body.classList.toggle('hide-cursor', g.hideCursor);
  document.body.classList.toggle('no-titles', !g.showTitles);
  document.body.dataset.transition = g.transition;
  // the admin preview already has the rotated (portrait) size
  stage.dataset.rotation = preview ? '0' : g.rotation;
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
    wrap.dataset.order = String(mod.order);
    region.append(wrap); // default position; moved per page in place()
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
    if (watched(inst)) loadData(inst); // needed to decide whether its page rotates
  }
  // ?page=<id> pins a page regardless of its schedule.
  pages = pinnedPage && config.pages.some((p) => p.id === pinnedPage) ? config.pages : activePages(config, new Date(), hiddenByContent, hasContent, display);
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
    const res = preview
      ? await fetch('/api/admin/preview-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: inst.mod }) })
      : await fetch(`/api/module/${encodeURIComponent(inst.mod.id)}/data`, { cache: 'no-store' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (!instances.includes(inst)) return;
    // Unchanged data → no re-render (no flicker); the first data fades in.
    inst.lastData = json.data;
    applyContent(inst);
    if (config.pages.some((p) => p.showWhen === inst.mod.id)) {
      clearTimeout(pagesTimer);
      pagesTimer = setTimeout(updatePages, 200);
    }
    const sig = JSON.stringify(json.data);
    if (sig !== inst.lastSig) {
      const first = !inst.lastSig;
      inst.lastSig = sig;
      const wasEmpty = inst.wrap.classList.contains('empty');
      inst.api.update(json.data);
      if (wasEmpty !== inst.wrap.classList.contains('empty')) contentChanged(inst);
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(layoutFill, 50); // a module may have become empty / non-empty
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
  if (delay) inst.fetchTimer = setTimeout(() => (inst.visible || watched(inst) ? loadData(inst) : (inst.stale = true)), delay * 1000);
}

// ---- pages ---------------------------------------------------------------------
function onPage(mod, page, seen = new Set()) {
  if (!(mod.pages.includes('*') || mod.pages.includes(page.id)) || !scheduleActive(mod.schedule, new Date(), config.general.timezone)) return false;
  // "Instead of": only while the other module is not shown (other page, schedule, nothing to show)
  if (mod.insteadOf && !seen.has(mod.id)) {
    seen.add(mod.id);
    const other = instances.find((i) => i.mod.id === mod.insteadOf);
    if (other && !other.wrap.classList.contains('no-content') && !other.wrap.classList.contains('empty') && onPage(other.mod, page, seen)) return false;
  }
  return true;
}

// A module's shown/hidden state changed by its content → modules standing in for it follow.
function contentChanged(inst) {
  if (!instances.some((i) => i.mod.insteadOf === inst.mod.id)) return;
  clearTimeout(visibilityTimer);
  visibilityTimer = setTimeout(() => applyVisibility(), 100);
}
let visibilityTimer = null;

// "Only show when …": hide a module while its data has nothing to show. Returns true if changed.
function applyContent(inst) {
  const hide = inst.mod.onlyWithContent && !moduleHasContent(inst.mod.type, inst.lastData, new Date(), config.general.timezone);
  if (hide === inst.wrap.classList.contains('no-content')) return false;
  inst.wrap.classList.toggle('no-content', hide);
  contentChanged(inst);
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(layoutFill, 50);
  // a page made only of such modules is skipped / comes back (e.g. F1 page on race weekends)
  clearTimeout(pagesTimer);
  pagesTimer = setTimeout(updatePages, 200);
  return true;
}

function hasContent(moduleId) {
  const inst = instances.find((i) => i.mod.id === moduleId);
  return !inst || moduleHasContent(inst.mod.type, inst.lastData, new Date(), config.general.timezone);
}

// Modules whose result decides about visibility keep loading while hidden.
const watched = (inst) => inst.mod.onlyWithContent || config.pages.some((p) => p.showWhen === inst.mod.id);

function hiddenByContent(mod) {
  return !!instances.find((i) => i.mod.id === mod.id)?.wrap.classList.contains('no-content');
}

// Re-evaluates which pages rotate (schedules, date ranges, empty pages); keeps the current page if possible.
let pagesTimer = null;
function updatePages() {
  if (!config || pinnedPage) return false;
  const next = activePages(config, new Date(), hiddenByContent, hasContent, display);
  if (next.map((p) => p.id).join() === pages.map((p) => p.id).join()) return false;
  const current = pages[pageIndex]?.id;
  pages = next;
  const keep = pages.findIndex((p) => p.id === current);
  showPage(keep >= 0 ? keep : 0);
  return true;
}

// Height of what a region actually shows (its row may be taller because of other columns).
function contentHeight(region) {
  const kids = [...region.children].filter((c) => c.offsetHeight > 0);
  if (!kids.length) return 0;
  return kids.at(-1).getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top;
}

// Modules with height "fill" take over empty areas above/below them in their column.
const COLUMNS = { left: 1, center: 2, right: 3 };
const ROWS = ['top', 'middle', 'bottom'];
function layoutFill() {
  // modules that currently show nothing (e.g. no weather hints → class "empty") don't occupy their area
  const visible = (region) => instances.some((i) => i.visible && regionOf(i) === region && !i.wrap.classList.contains('empty') && !i.wrap.classList.contains('no-content'));
  for (const [col, colIndex] of Object.entries(COLUMNS)) {
    const regions = ROWS.map((row) => grid.querySelector(`.region[data-region="${row}_${col}"]`));
    regions.forEach((el) => (el.style.gridRow = el.style.gridColumn = el.style.paddingTop = el.style.paddingBottom = ''));
    ROWS.forEach((row, r) => {
      const fills = instances.some((i) => i.visible && regionOf(i) === `${row}_${col}` && i.mod.height === 'fill');
      if (!fills) return;
      let start = r;
      let end = r;
      while (start > 0 && !visible(`${ROWS[start - 1]}_${col}`)) start--;
      while (end < ROWS.length - 1 && !visible(`${ROWS[end + 1]}_${col}`)) end++;
      // The top and bottom rows are as tall as their tallest region in any column. A shorter
      // top / bottom neighbour in this column leaves a gap – the fill region also spans that
      // row and keeps clear of the neighbour's content (top: aligned up, bottom: aligned down).
      const gap = parseFloat(getComputedStyle(regions[r]).rowGap) || 0;
      if (start === 1) {
        start = 0;
        regions[r].style.paddingTop = `${contentHeight(regions[0]) + gap}px`;
      }
      if (end === 1) {
        end = 2;
        regions[r].style.paddingBottom = `${contentHeight(regions[2]) + gap}px`;
      }
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
// Position of a module on a page (own position there or its default) – see placementOn.
function misplaced(inst, page) {
  const { region, order } = placementOn(inst.mod, page.id);
  return inst.wrap.parentElement?.dataset.region !== region || Number(inst.wrap.dataset.order) !== order;
}

function place(inst, page) {
  if (!misplaced(inst, page)) return;
  const { region, order } = placementOn(inst.mod, page.id);
  const target = grid.querySelector(`.region[data-region="${region}"]`);
  if (!target) return;
  inst.wrap.dataset.order = String(order);
  const before = [...target.children].find((c) => c !== inst.wrap && Number(c.dataset.order) > order);
  target.insertBefore(inst.wrap, before || null);
}

// The area a module is in right now (its position on the current page).
const regionOf = (inst) => (pages[pageIndex] ? placementOn(inst.mod, pages[pageIndex].id).region : inst.mod.region);

function applyVisibility(immediate = false) {
  const page = pages[pageIndex];
  if (!page) return;
  const animate = !immediate && config.general.transition !== 'none';
  // modules that stay but sit somewhere else on this page move (fade out → move → fade in)
  const moves = (inst) => inst.visible && onPage(inst.mod, page) && misplaced(inst, page);
  const changes = instances.filter((inst) => onPage(inst.mod, page) !== inst.visible || moves(inst));
  const leaving = animate && changes.some((inst) => inst.visible);
  const delay = leaving ? FADE_OUT : 0;
  for (const inst of changes) {
    const moving = moves(inst);
    const want = moving || !inst.visible;
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
        place(inst, page);
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
        cls.add(moving ? 'leaving' : 'off'); // a moving module fades out where it was
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

// Remote control "hold": keep the current page (until resumed or the time runs out).
let holdUntil = 0;
let holdTimer = null;
function hold(minutes) {
  clearTimeout(holdTimer);
  holdUntil = minutes > 0 ? Date.now() + minutes * 60000 : 0;
  if (holdUntil) holdTimer = setTimeout(() => hold(0), minutes * 60000);
  showPage(pageIndex, true);
}

function showPage(index, immediate = false) {
  clearTimeout(pageTimer);
  if (!pages.length) return;
  pageIndex = ((index % pages.length) + pages.length) % pages.length;
  const page = pages[pageIndex];
  applyVisibility(immediate);
  setAmbient(page.ambient);
  clearTimeout(prefetchTimer);
  const rotating = config.general.rotatePages && pages.length > 1 && !pinnedPage && !holdUntil;
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

// ---- night mode & housekeeping ------------------------------------------------------
// Remote override from the admin / remote page ("screen off for 1 h", "night now" …).
let displayOverride = null;

function updateDim() {
  const g = config?.general;
  if (!g) return;
  // the admin preview always shows the day view
  const state = preview ? { mode: 'day', brightness: 1 } : displayState(g, new Date(), displayOverride);
  dimLayer.style.opacity = String(1 - state.brightness);
  document.body.classList.toggle('night-clock', state.mode === 'clock');
  document.body.classList.toggle('screen-off', state.mode === 'off');
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  const h = config.general.autoReloadHours;
  if (h > 0) reloadTimer = setTimeout(() => location.reload(), h * 3600 * 1000);
}

async function init() {
  fetch('/api/display', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
    displayOverride = d.override || null;
    updateDim();
  }).catch(() => {});
  try {
    const saved = await fetchConfig();
    if (previewConfig) return; // the admin's working copy arrived first – keep it
    config = saved;
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

// Admin preview: the admin page posts its working copy (incl. unsaved changes).
let previewConfig = false;
if (preview) {
  let lastSig = '';
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'mm-config') return;
    const sig = JSON.stringify(e.data.config);
    if (sig === lastSig) return;
    lastSig = sig;
    previewConfig = true;
    config = e.data.config;
    statusEl.hidden = true;
    applyTheme(config.general);
    build();
    updateDim();
  });
  window.parent?.postMessage({ type: 'mm-preview-ready' }, location.origin);
}

function buildGrid() {
  grid.innerHTML = REGIONS.map((r) => `<div class="region" data-region="${r.id}"></div>`).join('');
}

// ---- live updates (SSE) -------------------------------------------------------------
function connectEvents() {
  const es = new EventSource(preview ? '/api/events?preview=1' : '/api/events');
  let lastUpdate = null;
  es.addEventListener('config', async (e) => {
    if (preview) return; // the admin page sends the config itself
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
  es.addEventListener('display', (e) => {
    displayOverride = JSON.parse(e.data).override || null;
    dimLayer.classList.add('quick');
    updateDim();
    setTimeout(() => dimLayer.classList.remove('quick'), 1500);
  });
  // New data was pushed for a module (e.g. Apple Reminders) – fetch it now.
  es.addEventListener('refresh', (e) => {
    const { module } = JSON.parse(e.data);
    for (const inst of instances.filter((i) => i.mod.id === module)) {
      if (inst.visible || watched(inst)) loadData(inst);
      else inst.stale = true;
    }
  });
  es.addEventListener('nav', (e) => {
    const { action, minutes } = JSON.parse(e.data);
    if (action === 'next') showPage(pageIndex + 1);
    else if (action === 'prev') showPage(pageIndex - 1);
    else if (action === 'hold') hold(minutes || 60);
    else if (action === 'resume') hold(0);
  });
  es.addEventListener('page', (e) => {
    const { page } = JSON.parse(e.data);
    let i = pages.findIndex((p) => p.id === page);
    // "Show" from the admin also works for pages that are currently not rotating
    // (switched off, outside their schedule …): shown once, then rotation continues.
    if (i < 0) {
      const extra = config.pages.find((p) => p.id === page);
      if (!extra || !onDisplay(extra, display)) return; // page belongs to another mirror
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
  instances.forEach(applyContent); // time-based conditions (race weekend, match day …)
  // Page schedules / date ranges: keep the current page if it is still active.
  if (!updatePages()) applyVisibility();
}, 60000);
