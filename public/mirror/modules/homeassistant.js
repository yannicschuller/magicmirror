import { esc, num } from '../renderers.js';

const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Keys = HA_ICONS in shared/modules/homeassistant.js
const ICONS = {
  thermometer: svg('<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 17v-6"/>'),
  humidity: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 16.5l5-5M10 12h.01M14 16h.01" />'),
  window: svg('<rect x="4.5" y="3.5" width="15" height="17" rx="1"/><path d="M12 3.5v17M4.5 12h15"/>'),
  door: svg('<path d="M5.5 21V4.5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V21M3.5 21h17"/><path d="M15 12.5h.01" stroke-width="2.5"/>'),
  power: svg('<path d="M12 3v8"/><path d="M7 6.3a7.5 7.5 0 1 0 10 0"/>'),
  bolt: svg('<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6l1-8z"/>'),
  light: svg('<path d="M9 17.5h6M10 21h4"/><path d="M8.5 14.5a6 6 0 1 1 7 0c-.8.6-1 1.4-1 2.5v.5h-5V17c0-1.1-.2-1.9-1-2.5z"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2"/>'),
  plug: svg('<path d="M9 3v5M15 3v5M6.5 8h11v3a5.5 5.5 0 0 1-11 0V8zM12 16.5V21"/>'),
  sun: svg('<circle cx="12" cy="9" r="3.5"/><path d="M12 2.5v1M5.5 9h-1M19.5 9h-1M7.4 4.4l.7.7M16.6 4.4l-.7.7"/><path d="M5 21l1.5-6h11l1.5 6zM12 15v6M5.8 18h12.4"/>'),
  battery: svg('<rect x="3" y="7.5" width="16" height="9" rx="1.5"/><path d="M21 10.5v3M6 10.5v3M9 10.5v3"/>'),
  generic: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>'),
};

const unitSep = (u) => (!u || u.startsWith('°') ? '' : ' ');

export function formatValue(e) {
  if (e.value !== undefined) return `${num(e.value, e.decimals)}${e.unit ? `${unitSep(e.unit)}<span class="ha-unit">${esc(e.unit)}</span>` : ''}`;
  return esc(e.state);
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const t = ctx.fmt.t;
  return {
    update(d) {
      const list = d.entities || [];
      const wrap = el.closest('.module');
      if (!d.configured) {
        wrap?.classList.remove('empty');
        el.innerHTML = `<div class="dim small">${esc(t('No entities configured'))}</div>`;
        return;
      }
      // Hide the whole module when every entity is filtered out (e.g. all windows closed).
      wrap?.classList.toggle('empty', !list.length);
      const cls = (e) => ['ha-item', s.highlightActive && e.active && e.value === undefined ? 'active' : '', e.available === false ? 'unavailable' : '', e.missing ? 'missing' : '', e.value === undefined ? 'text' : ''].filter(Boolean).join(' ');
      const icon = (e) => `<span class="ha-ico">${ICONS[e.icon] || ICONS.generic}</span>`;
      if (s.layout === 'grid') {
        el.innerHTML = `<div class="ha-grid" style="--ha-cols:${Math.min(s.columns, list.length) || 1}">${list
          .map((e) => `<div class="${cls(e)}">${icon(e)}<div class="ha-value">${formatValue(e)}</div><div class="ha-label">${esc(e.label)}</div></div>`)
          .join('')}</div>`;
      } else {
        el.innerHTML = `<div class="ha-list">${list
          .map((e) => `<div class="${cls(e)}">${icon(e)}<span class="ha-label">${esc(e.label)}</span><span class="ha-value">${formatValue(e)}</span></div>`)
          .join('')}</div>`;
      }
    },
  };
}
