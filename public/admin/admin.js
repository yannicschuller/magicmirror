import { MODULE_TYPES, GENERAL_FIELDS, REGIONS, defaultModule, uid } from '/shared/modules.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (v) => JSON.parse(JSON.stringify(v));

const state = {
  config: null,
  saved: '',
  view: 'layout',
  page: null, // selected page id in layout view
  module: null, // selected module id in modules view
};

// ---- API ----------------------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) {
    location.href = '/admin/';
    throw new Error('Nicht angemeldet');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = 'ok') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3500);
}

// ---- dirty tracking -------------------------------------------------------------------
function changed() {
  const dirty = JSON.stringify(state.config) !== state.saved;
  $('#dirty').hidden = !dirty;
  $('#discard').hidden = !dirty;
  $('#save').disabled = !dirty;
}

function setConfig(cfg) {
  state.config = cfg;
  state.saved = JSON.stringify(cfg);
  if (!cfg.pages.some((p) => p.id === state.page)) state.page = cfg.pages[0]?.id;
  if (state.module && !cfg.modules.some((m) => m.id === state.module)) state.module = null;
  changed();
}

async function save() {
  const btn = $('#save');
  btn.disabled = true;
  try {
    setConfig(await api('/config', { method: 'PUT', body: state.config }));
    toast('Gespeichert – der Spiegel aktualisiert sich automatisch.');
    render();
  } catch (err) {
    toast(err.message, 'error');
    changed();
  }
}

window.addEventListener('beforeunload', (e) => {
  if (state.config && JSON.stringify(state.config) !== state.saved) e.preventDefault();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (!$('#save').disabled) save();
  }
});

// ---- generic form builder ------------------------------------------------------------------
function isVisible(field, values) {
  if (!field.showIf) return true;
  return Object.entries(field.showIf).every(([k, v]) => {
    if (k === '_transitCustom') return values.provider === 'hafas' || values.efaPreset === 'custom';
    return values[k] === v;
  });
}

function fieldRow(field, inner, extraClass = '') {
  const row = document.createElement('div');
  row.className = `field type-${field.type} ${extraClass}`;
  row.innerHTML = `<label class="field-label">${esc(field.label)}</label>`;
  if (typeof inner === 'string') row.insertAdjacentHTML('beforeend', inner);
  else row.append(inner);
  if (field.help) row.insertAdjacentHTML('beforeend', `<div class="help">${esc(field.help)}</div>`);
  return row;
}

/**
 * Renders `fields` editing the object `values` in place. `onChange` is called after
 * every edit; `ctx` gives special widgets access to sibling values (e.g. transit provider).
 */
function renderFields(container, fields, values, onChange) {
  const rows = [];
  const refresh = () => {
    for (const { field, row } of rows) row.hidden = !isVisible(field, values);
  };
  const emit = () => {
    refresh();
    onChange();
  };
  for (const field of fields) {
    const row = buildField(field, values, emit);
    rows.push({ field, row });
    container.append(row);
  }
  refresh();
}

function buildField(field, values, emit) {
  const v = values[field.key];
  const set = (val) => {
    values[field.key] = val;
    emit();
  };
  switch (field.type) {
    case 'bool': {
      const row = document.createElement('label');
      row.className = 'field type-bool';
      row.innerHTML = `<span class="switch"><input type="checkbox" ${v ? 'checked' : ''}><span></span></span><span>${esc(field.label)}</span>`;
      $('input', row).addEventListener('change', (e) => set(e.target.checked));
      return row;
    }
    case 'number': {
      const row = fieldRow(field, `<input type="number" value="${esc(v)}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} step="${field.step || 1}">`);
      $('input', row).addEventListener('input', (e) => {
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) set(n);
      });
      return row;
    }
    case 'select': {
      const row = fieldRow(field, `<select>${field.options.map((o) => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`);
      $('select', row).addEventListener('change', (e) => set(e.target.value));
      return row;
    }
    case 'multiselect': {
      const row = fieldRow(field, `<div class="chips">${field.options.map((o) => `<label class="chip"><input type="checkbox" value="${esc(o.value)}" ${v.includes(o.value) ? 'checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div>`);
      row.addEventListener('change', () => set([...row.querySelectorAll('input:checked')].map((i) => i.value)));
      return row;
    }
    case 'color': {
      const row = fieldRow(field, `<div class="color"><input type="color" value="${esc(v)}"><input type="text" value="${esc(v)}" maxlength="9"></div>`);
      const [picker, text] = row.querySelectorAll('input');
      picker.addEventListener('input', () => { text.value = picker.value; set(picker.value); });
      text.addEventListener('change', () => { if (/^#[0-9a-f]{3,8}$/i.test(text.value)) { picker.value = text.value; set(text.value); } });
      return row;
    }
    case 'textarea': {
      const row = fieldRow(field, `<textarea rows="4">${esc(v)}</textarea>`);
      $('textarea', row).addEventListener('input', (e) => set(e.target.value));
      return row;
    }
    case 'date':
    case 'time': {
      const row = fieldRow(field, `<input type="${field.type}" value="${esc(v)}">`);
      $('input', row).addEventListener('change', (e) => set(e.target.value));
      return row;
    }
    case 'location':
      return locationField(field, values, set);
    case 'transitStop':
      return transitStopField(field, values, set);
    case 'list':
      return listField(field, values, emit);
    default: {
      const row = fieldRow(field, `<input type="${field.secret ? 'url' : 'text'}" value="${esc(v)}" placeholder="${esc(field.placeholder || '')}" ${field.secret ? 'autocomplete="off" spellcheck="false"' : ''}>`);
      $('input', row).addEventListener('input', (e) => set(e.target.value));
      return row;
    }
  }
}

function locationField(field, values, set) {
  const v = values[field.key];
  const row = fieldRow(field, `
    <div class="loc">
      <div class="loc-current">${v ? `<b>${esc(v.name || 'Standort')}</b> <span class="muted">${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</span>` : '<span class="muted">Kein Standort gesetzt</span>'}</div>
      <div class="search"><input type="search" placeholder="Ort suchen, z. B. Stuttgart"><button class="btn small" type="button">Suchen</button></div>
      <div class="results"></div>
      <details class="manual"><summary>Koordinaten manuell</summary>
        <div class="row3"><input type="text" class="n" placeholder="Name" value="${esc(v?.name || '')}"><input type="number" class="lat" step="0.0001" placeholder="Breitengrad" value="${v?.lat ?? ''}"><input type="number" class="lon" step="0.0001" placeholder="Längengrad" value="${v?.lon ?? ''}"><button class="btn small" type="button">Übernehmen</button></div>
      </details>
    </div>`);
  const input = $('input[type=search]', row);
  const results = $('.results', row);
  const apply = (loc) => {
    set(loc);
    $('.loc-current', row).innerHTML = `<b>${esc(loc.name)}</b> <span class="muted">${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}</span>`;
    results.innerHTML = '';
  };
  const search = async () => {
    results.innerHTML = '<div class="muted">Suche …</div>';
    try {
      const list = await api(`/geocode?q=${encodeURIComponent(input.value)}`);
      results.innerHTML = list.length ? '' : '<div class="muted">Nichts gefunden</div>';
      for (const r of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'result';
        b.innerHTML = `<b>${esc(r.name)}</b> <span class="muted">${esc(r.region)}</span>`;
        b.onclick = () => apply({ name: r.name, lat: r.lat, lon: r.lon });
        results.append(b);
      }
    } catch (err) {
      results.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  };
  $('.search button', row).onclick = search;
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), search()));
  $('.manual button', row).onclick = () => {
    const lat = Number($('.lat', row).value);
    const lon = Number($('.lon', row).value);
    if (Number.isFinite(lat) && Number.isFinite(lon)) apply({ name: $('.n', row).value || 'Standort', lat, lon });
  };
  return row;
}

function transitStopField(field, values, set) {
  const v = values[field.key];
  const row = fieldRow(field, `
    <div class="loc">
      <div class="loc-current">${v ? `<b>${esc(v.name)}</b> <span class="muted">${esc(v.id)}</span>` : '<span class="muted">Keine Haltestelle gewählt</span>'}</div>
      <div class="search"><input type="search" placeholder="Haltestelle suchen"><button class="btn small" type="button">Suchen</button></div>
      <div class="results"></div>
    </div>`);
  const input = $('input', row);
  const results = $('.results', row);
  const search = async () => {
    results.innerHTML = '<div class="muted">Suche …</div>';
    try {
      const list = await api('/transit/search', { method: 'POST', body: { settings: values, q: input.value } });
      results.innerHTML = list.length ? '' : '<div class="muted">Nichts gefunden</div>';
      for (const r of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'result';
        b.innerHTML = `<b>${esc(r.name)}</b> <span class="muted">${esc(r.id)}</span>`;
        b.onclick = () => {
          set({ id: r.id, name: r.name });
          $('.loc-current', row).innerHTML = `<b>${esc(r.name)}</b> <span class="muted">${esc(r.id)}</span>`;
          results.innerHTML = '';
        };
        results.append(b);
      }
    } catch (err) {
      results.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  };
  $('button', row).onclick = search;
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), search()));
  return row;
}

function listField(field, values, emit) {
  const row = fieldRow(field, '<div class="list"></div><button type="button" class="btn small add">+ ' + esc(field.itemLabel || 'Eintrag') + ' hinzufügen</button>', 'wide');
  const list = $('.list', row);
  const draw = () => {
    list.innerHTML = '';
    values[field.key].forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'list-item';
      card.innerHTML = `<div class="list-head"><span class="muted">${esc(field.itemLabel || 'Eintrag')} ${i + 1}</span><span class="list-btns"><button type="button" title="Nach oben" data-a="up">↑</button><button type="button" title="Nach unten" data-a="down">↓</button><button type="button" title="Entfernen" data-a="del" class="danger">✕</button></span></div><div class="list-body"></div>`;
      renderFields($('.list-body', card), field.fields, item, emit);
      card.querySelector('.list-btns').addEventListener('click', (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        const arr = values[field.key];
        if (a === 'del') arr.splice(i, 1);
        if (a === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        if (a === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        draw();
        emit();
      });
      list.append(card);
    });
  };
  $('.add', row).onclick = () => {
    const item = {};
    for (const f of field.fields) item[f.key] = clone(f.default ?? '');
    values[field.key].push(item);
    draw();
    emit();
  };
  draw();
  return row;
}

// ---- helpers ------------------------------------------------------------------------------------
const moduleName = (m) => m.title || MODULE_TYPES[m.type].label;
const onPage = (m, pageId) => m.pages.includes('*') || m.pages.includes(pageId);
const regionLabel = (id) => REGIONS.find((r) => r.id === id)?.label || id;

function pagesSummary(m) {
  if (m.pages.includes('*')) return 'Alle Seiten';
  return m.pages.map((id) => state.config.pages.find((p) => p.id === id)?.name || id).join(', ');
}

// ---- views ----------------------------------------------------------------------------------------------
const views = {};

views.general = (root) => {
  root.innerHTML = `<div class="panel narrow"><h2>Allgemein</h2><p class="muted">Standort, Zeitzone, Design und Verhalten des Spiegels.</p><div class="form"></div></div>`;
  renderFields($('.form', root), GENERAL_FIELDS, state.config.general, changed);
};

views.layout = (root) => {
  const cfg = state.config;
  const page = cfg.pages.find((p) => p.id === state.page) || cfg.pages[0];
  state.page = page.id;
  root.innerHTML = `
    <div class="layout-view">
      <section class="panel pages-panel">
        <div class="panel-head"><h2>Seiten</h2><button class="btn small" id="add-page">+ Seite</button></div>
        <p class="muted small">Seiten wechseln automatisch nach der eingestellten Dauer. Ein Klick auf „Zeigen“ schaltet alle Spiegel sofort um.</p>
        <div id="pages"></div>
      </section>
      <section class="panel layout-panel">
        <div class="panel-head"><h2>Layout: ${esc(page.name)}</h2><span class="muted small">Module per Drag &amp; Drop verschieben · Klick zum Bearbeiten</span></div>
        <div class="grid-editor" id="grid"></div>
        <div class="unplaced"><h3>Module auf anderen Seiten / deaktiviert</h3><div id="unplaced" class="chips-row"></div><p class="muted small">Auf eine Fläche ziehen, um das Modul auf dieser Seite anzuzeigen.</p></div>
      </section>
      <section class="panel preview-panel">
        <div class="panel-head"><h2>Vorschau</h2><span class="muted small">gespeicherter Stand</span></div>
        <div class="preview"><iframe id="preview" src="/?page=${encodeURIComponent(page.id)}" title="Vorschau" tabindex="-1"></iframe></div>
      </section>
    </div>`;

  // pages list
  const pagesEl = $('#pages', root);
  cfg.pages.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = `page-row ${p.id === page.id ? 'active' : ''} ${p.enabled ? '' : 'disabled'}`;
    row.innerHTML = `
      <button class="page-select" title="Layout dieser Seite bearbeiten">${i + 1}</button>
      <input class="page-name" value="${esc(p.name)}" aria-label="Name">
      <label class="dur" title="Anzeigedauer in Sekunden"><input type="number" min="5" max="3600" value="${p.duration}"> s</label>
      <label class="switch" title="Seite aktiv"><input type="checkbox" ${p.enabled ? 'checked' : ''}><span></span></label>
      <span class="page-btns">
        <button class="btn tiny" data-a="show" title="Jetzt auf dem Spiegel zeigen">Zeigen</button>
        <button class="icon" data-a="up" title="Nach oben">↑</button>
        <button class="icon" data-a="down" title="Nach unten">↓</button>
        <button class="icon danger" data-a="del" title="Seite löschen">✕</button>
      </span>`;
    $('.page-select', row).onclick = () => { state.page = p.id; render(); };
    $('.page-name', row).oninput = (e) => { p.name = e.target.value; changed(); };
    $('.dur input', row).oninput = (e) => { p.duration = Math.max(5, Number(e.target.value) || 30); changed(); };
    $('.switch input', row).onchange = (e) => { p.enabled = e.target.checked; changed(); row.classList.toggle('disabled', !p.enabled); };
    $('.page-btns', row).onclick = async (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      if (a === 'show') {
        try {
          const r = await api('/command', { method: 'POST', body: { type: 'page', page: p.id } });
          toast(`Seite „${p.name}“ auf ${r.clients} Spiegel(n) angezeigt`);
        } catch (err) { toast(err.message, 'error'); }
        return;
      }
      if (a === 'del') {
        if (cfg.pages.length === 1) return toast('Die letzte Seite kann nicht gelöscht werden.', 'error');
        if (!confirm(`Seite „${p.name}“ löschen? Module bleiben erhalten.`)) return;
        cfg.pages.splice(i, 1);
        for (const m of cfg.modules) {
          m.pages = m.pages.filter((id) => id !== p.id);
          if (!m.pages.length) { m.pages = [cfg.pages[0].id]; m.enabled = false; }
        }
        if (state.page === p.id) state.page = cfg.pages[0].id;
      }
      if (a === 'up' && i > 0) [cfg.pages[i - 1], cfg.pages[i]] = [cfg.pages[i], cfg.pages[i - 1]];
      if (a === 'down' && i < cfg.pages.length - 1) [cfg.pages[i + 1], cfg.pages[i]] = [cfg.pages[i], cfg.pages[i + 1]];
      changed();
      render();
    };
    pagesEl.append(row);
  });
  $('#add-page', root).onclick = () => {
    const id = uid('p');
    cfg.pages.push({ id, name: `Seite ${cfg.pages.length + 1}`, duration: 30, enabled: true });
    state.page = id;
    changed();
    render();
  };

  // grid editor
  const grid = $('#grid', root);
  for (const r of REGIONS) {
    const zone = document.createElement('div');
    zone.className = `zone zone-${r.id}`;
    zone.dataset.region = r.id;
    zone.innerHTML = `<div class="zone-label">${esc(r.label)}</div><div class="zone-items"></div>`;
    const mods = cfg.modules.filter((m) => m.region === r.id && m.enabled && onPage(m, page.id)).sort((a, b) => a.order - b.order);
    for (const m of mods) $('.zone-items', zone).append(chip(m, page));
    grid.append(zone);
    setupDrop(zone, page);
  }
  const preview = $('.preview', root);
  const frame = $('#preview', root);
  new ResizeObserver(() => (frame.style.transform = `scale(${preview.clientWidth / 1920})`)).observe(preview);

  const unplaced = $('#unplaced', root);
  const others = cfg.modules.filter((m) => !m.enabled || !onPage(m, page.id));
  if (!others.length) unplaced.innerHTML = '<span class="muted small">Alle Module sind auf dieser Seite.</span>';
  for (const m of others) unplaced.append(chip(m, page, true));
};

function chip(m, page, outside = false) {
  const el = document.createElement('div');
  el.className = `mchip ${m.enabled ? '' : 'disabled'} ${outside ? 'outside' : ''}`;
  el.draggable = true;
  el.dataset.id = m.id;
  const all = m.pages.includes('*');
  el.innerHTML = `<span class="mchip-name">${esc(moduleName(m))}</span><span class="mchip-meta">${esc(MODULE_TYPES[m.type].label)}${all ? ' · alle Seiten' : ''}${!m.enabled ? ' · aus' : ''}${outside ? ` · ${esc(pagesSummary(m))}` : ''}</span>${outside ? '' : '<button class="mchip-x" title="Von dieser Seite entfernen">✕</button>'}`;
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', m.id);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('mchip-x')) {
      e.stopPropagation();
      if (m.pages.includes('*')) m.pages = state.config.pages.map((p) => p.id);
      m.pages = m.pages.filter((id) => id !== page.id);
      if (!m.pages.length) { m.pages = [page.id]; m.enabled = false; }
      changed();
      render();
      return;
    }
    state.module = m.id;
    state.view = 'modules';
    render();
  });
  return el;
}

function setupDrop(zone, page) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const m = state.config.modules.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (!m) return;
    const items = [...zone.querySelectorAll('.mchip')].filter((c) => c.dataset.id !== m.id);
    const after = items.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    const order = items.map((c) => c.dataset.id);
    order.splice(after === -1 ? order.length : after, 0, m.id);
    m.region = zone.dataset.region;
    m.enabled = true;
    if (!onPage(m, page.id)) m.pages.push(page.id);
    order.forEach((id, i) => (state.config.modules.find((x) => x.id === id).order = i));
    changed();
    render();
  });
}

views.modules = (root) => {
  const cfg = state.config;
  if (!state.module && cfg.modules.length) state.module = cfg.modules[0].id;
  root.innerHTML = `
    <div class="modules-view">
      <aside class="panel module-list">
        <div class="panel-head"><h2>Module</h2></div>
        <div id="mlist"></div>
        <div class="add-module">
          <select id="add-type">${Object.entries(MODULE_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select>
          <button class="btn small primary" id="add-mod">+ Hinzufügen</button>
        </div>
      </aside>
      <section class="panel module-editor" id="editor"></section>
    </div>`;
  const list = $('#mlist', root);
  for (const m of cfg.modules) {
    const row = document.createElement('div');
    row.className = `mrow ${m.id === state.module ? 'active' : ''} ${m.enabled ? '' : 'disabled'}`;
    row.innerHTML = `<label class="switch" title="An/Aus"><input type="checkbox" ${m.enabled ? 'checked' : ''}><span></span></label><button class="mrow-main"><b>${esc(moduleName(m))}</b><span class="muted small">${esc(MODULE_TYPES[m.type].label)} · ${esc(regionLabel(m.region))} · ${esc(pagesSummary(m))}</span></button>`;
    $('input', row).onchange = (e) => { m.enabled = e.target.checked; changed(); render(); };
    $('.mrow-main', row).onclick = () => { state.module = m.id; render(); };
    list.append(row);
  }
  $('#add-mod', root).onclick = () => {
    const type = $('#add-type', root).value;
    const m = defaultModule(type, { pages: [state.page || cfg.pages[0].id] });
    m.order = cfg.modules.filter((x) => x.region === m.region).length;
    cfg.modules.push(m);
    state.module = m.id;
    changed();
    render();
  };

  const editor = $('#editor', root);
  const m = cfg.modules.find((x) => x.id === state.module);
  if (!m) {
    editor.innerHTML = '<p class="muted">Modul auswählen oder neu hinzufügen.</p>';
    return;
  }
  const t = MODULE_TYPES[m.type];
  const all = m.pages.includes('*');
  editor.innerHTML = `
    <div class="panel-head"><div><h2>${esc(moduleName(m))}</h2><p class="muted small">${esc(t.description)}</p></div>
      <div class="editor-btns"><button class="btn small" data-a="dup">Duplizieren</button><button class="btn small danger" data-a="del">Löschen</button></div></div>
    <div class="form base">
      <label class="field type-bool"><span class="switch"><input type="checkbox" id="m-enabled" ${m.enabled ? 'checked' : ''}><span></span></span><span>Modul aktiv</span></label>
      <div class="field"><label class="field-label">Überschrift (leer = keine)</label><input type="text" id="m-title" value="${esc(m.title)}"></div>
      <div class="field"><label class="field-label">Position</label><select id="m-region">${REGIONS.map((r) => `<option value="${r.id}" ${r.id === m.region ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></div>
      <div class="field"><label class="field-label">Reihenfolge in der Fläche</label><input type="number" id="m-order" value="${m.order}" step="1"></div>
      <div class="field wide"><label class="field-label">Seiten</label><div class="chips" id="m-pages">
        <label class="chip"><input type="checkbox" value="*" ${all ? 'checked' : ''}><span>Alle Seiten</span></label>
        ${cfg.pages.map((p) => `<label class="chip ${all ? 'off' : ''}"><input type="checkbox" value="${esc(p.id)}" ${all || m.pages.includes(p.id) ? 'checked' : ''} ${all ? 'disabled' : ''}><span>${esc(p.name)}</span></label>`).join('')}
      </div></div>
    </div>
    <h3>Einstellungen</h3>
    <div class="form settings"></div>
    <div class="module-test"><button class="btn small" id="m-test">Daten testen</button><span class="muted small">nutzt den gespeicherten Stand</span><pre id="m-test-out" hidden></pre></div>`;

  $('#m-enabled', editor).onchange = (e) => { m.enabled = e.target.checked; changed(); render(); };
  $('#m-title', editor).oninput = (e) => { m.title = e.target.value; changed(); };
  $('#m-region', editor).onchange = (e) => { m.region = e.target.value; changed(); };
  $('#m-order', editor).oninput = (e) => { m.order = Number(e.target.value) || 0; changed(); };
  $('#m-pages', editor).onchange = (e) => {
    if (e.target.value === '*') m.pages = e.target.checked ? ['*'] : [state.page || cfg.pages[0].id];
    else m.pages = [...editor.querySelectorAll('#m-pages input:checked')].map((i) => i.value).filter((v) => v !== '*');
    if (!m.pages.length) m.pages = [cfg.pages[0].id];
    changed();
    render();
  };
  $('.editor-btns', editor).onclick = (e) => {
    const a = e.target.dataset.a;
    if (a === 'dup') {
      const copy = { ...clone(m), id: uid('m'), title: `${m.title || t.label} (Kopie)` };
      cfg.modules.splice(cfg.modules.indexOf(m) + 1, 0, copy);
      state.module = copy.id;
    } else if (a === 'del') {
      if (!confirm(`Modul „${moduleName(m)}“ löschen?`)) return;
      cfg.modules.splice(cfg.modules.indexOf(m), 1);
      state.module = null;
    } else return;
    changed();
    render();
  };
  renderFields($('.settings', editor), t.fields, m.settings, () => {
    changed();
  });
  $('#m-test', editor).onclick = async () => {
    const out = $('#m-test-out', editor);
    out.hidden = false;
    out.textContent = 'Lade …';
    try {
      const res = await fetch(`/api/module/${encodeURIComponent(m.id)}/data`);
      const json = await res.json();
      out.textContent = JSON.stringify(json, null, 2).slice(0, 6000);
    } catch (err) {
      out.textContent = err.message;
    }
  };
};

views.backup = (root) => {
  root.innerHTML = `
    <div class="panel narrow">
      <h2>Import / Export</h2>
      <p class="muted">Die Sicherung enthält die <b>komplette</b> Konfiguration: alle Seiten, Module, Positionen und Einstellungen – inklusive Kalender-, Kamera- und Müll-URLs. Behandle die Datei daher vertraulich.</p>
      <div class="backup-actions">
        <a class="btn primary" href="/api/admin/export" download>Konfiguration exportieren</a>
      </div>
      <h3>Importieren</h3>
      <p class="muted small">Ersetzt die aktuelle Konfiguration vollständig. Die Spiegel laden danach automatisch neu.</p>
      <input type="file" id="import-file" accept="application/json,.json">
      <div id="import-preview"></div>
      <h3>Spiegel steuern</h3>
      <div class="backup-actions">
        <button class="btn" id="reload-mirrors">Alle Spiegel neu laden</button>
        <button class="btn danger" id="reset">Auf Standard zurücksetzen</button>
      </div>
      <div id="status" class="muted small"></div>
    </div>`;
  let pending = null;
  $('#import-file', root).onchange = async (e) => {
    const file = e.target.files[0];
    const preview = $('#import-preview', root);
    pending = null;
    if (!file) return (preview.innerHTML = '');
    try {
      const json = JSON.parse(await file.text());
      const cfg = json.app === 'magicmirror' && json.config ? json.config : json;
      if (!Array.isArray(cfg.modules) || !Array.isArray(cfg.pages)) throw new Error('Keine gültige Magic-Mirror-Konfiguration');
      pending = json;
      preview.innerHTML = `<div class="import-box"><p><b>${esc(file.name)}</b>${json.exportedAt ? ` · exportiert ${esc(new Date(json.exportedAt).toLocaleString('de-DE'))}` : ''}</p>
        <p>${cfg.pages.length} Seite(n): ${cfg.pages.map((p) => esc(p.name)).join(', ')}<br>${cfg.modules.length} Modul(e): ${cfg.modules.map((m) => esc(m.title || MODULE_TYPES[m.type]?.label || m.type)).join(', ')}</p>
        <button class="btn primary" id="do-import">Jetzt importieren</button></div>`;
      $('#do-import', root).onclick = async () => {
        try {
          setConfig(await api('/import', { method: 'POST', body: pending }));
          toast('Konfiguration importiert');
          render();
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    } catch (err) {
      preview.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  };
  $('#reload-mirrors', root).onclick = async () => {
    const r = await api('/command', { method: 'POST', body: { type: 'reload' } });
    toast(`${r.clients} Spiegel neu geladen`);
  };
  $('#reset', root).onclick = async () => {
    if (!confirm('Wirklich alles auf die Standardkonfiguration zurücksetzen? Exportiere vorher am besten eine Sicherung.')) return;
    try {
      setConfig(await api('/reset', { method: 'POST', body: {} }));
      toast('Standardkonfiguration wiederhergestellt');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  api('/status').then((s) => {
    $('#status', root).textContent = `Verbundene Spiegel: ${s.clients} · go2rtc: ${s.go2rtc.ok ? 'ok' : `nicht erreichbar (${s.go2rtc.error})`}`;
  });
};

// ---- shell -------------------------------------------------------------------------------------------------
function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const root = $('#view');
  const scroll = window.scrollY;
  views[state.view](root);
  window.scrollTo(0, scroll);
}

$('#tabs').addEventListener('click', (e) => {
  if (!e.target.dataset.view) return;
  state.view = e.target.dataset.view;
  history.replaceState(null, '', `#${state.view}`);
  window.scrollTo(0, 0);
  render();
});
window.addEventListener('hashchange', () => {
  const view = location.hash.slice(1);
  if (view in views && view !== state.view && state.config) {
    state.view = view;
    render();
  }
});
$('#save').onclick = save;
$('#discard').onclick = () => {
  setConfig(JSON.parse(state.saved));
  render();
};

(async () => {
  try {
    const [me, cfg] = await Promise.all([api('/me'), api('/config')]);
    $('#user').textContent = me.name;
    if (location.hash.slice(1) in views) state.view = location.hash.slice(1);
    setConfig(cfg);
    render();
  } catch (err) {
    $('#view').innerHTML = `<div class="panel narrow"><h2>Fehler</h2><p class="error">${esc(err.message)}</p></div>`;
  }
})();
