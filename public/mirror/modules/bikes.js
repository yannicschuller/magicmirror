// Bike & scooter sharing: nearest stations with available vehicles plus
// free-floating vehicles within the radius, per operator.
import { esc, num } from '../renderers.js';

const svg = (body) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const wheels = '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/>';
const frame = '<path d="M5.5 16.5L9 9h6.5l3 7.5M9 9l3.5 7.5h-7M8 6.5h3M14.5 6.5h2l-1 2.5"/>';
export const KIND_ICONS = {
  bike: svg(wheels + frame),
  ebike: svg(`${wheels}${frame}<path d="M12.5 1.5l-2 3h3l-2 3" stroke-width="1.3"/>`),
  cargo: svg('<circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M5 17l3-7h5l3 7M8 10L7 7.5H5.5"/><rect x="14" y="9" width="7" height="5" rx=".5"/>'),
  scooter: svg('<circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M8 18h8M18.5 15.5L15.5 4H13M15.5 4h2.5"/>'),
  moped: svg('<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h5.5l2.5-6h-6l-2 6M17 11l-1.5-5h2.5M4 12h5"/>'),
};
const ORDER = ['bike', 'ebike', 'cargo', 'scooter', 'moped'];
const ARROW = '<svg class="ico bk-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V4M6 10l6-6 6 6"/></svg>';

// 120 m / 1.2 km (rounded to 10 m – GPS positions are not more exact anyway).
export function distText(m) {
  if (m === null || m === undefined) return '';
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${num(m / 1000, 1)} km`;
}

// Straight-line distance × 1.25 detour at 4.8 km/h.
export const walkMinutes = (m) => Math.max(1, Math.round((m * 1.25) / 80));

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  const compact = s.layout === 'compact';
  let last = null;

  const counts = (c) =>
    ORDER.filter((k) => c[k] > 0)
      .map((k) => `<span class="bk-c bk-${k}">${KIND_ICONS[k]}<span class="bk-n">${c[k]}</span></span>`)
      .join('');
  const dir = (deg) => (s.showDirection && Number.isFinite(deg) ? `<span class="bk-dir" style="transform:rotate(${deg}deg)">${ARROW}</span>` : '');
  const where = (m, deg) => {
    const parts = [];
    if (s.showDistance) parts.push(`<span class="bk-dist">${esc(distText(m))}</span>`);
    if (s.showWalk && !compact) parts.push(esc(t('{m} min walk', { m: walkMinutes(m) })));
    const d = dir(deg);
    return { text: parts.join(' · '), dir: d };
  };

  const station = (st, multi) => {
    const w = where(st.dist, st.bearing);
    const sub = [];
    if (w.text || w.dir) sub.push(`${w.dir}${w.text}`);
    if (!st.renting) sub.push(`<span class="bk-off">${esc(t('out of service'))}</span>`);
    else if (s.showDocks && st.docks !== null && st.docks !== undefined) sub.push(esc(t('{n} free docks', { n: st.docks })));
    if (multi && st.operator && !compact) sub.push(esc(st.operator));
    const c = counts(st.counts) || `<span class="bk-c bk-zero">${KIND_ICONS.bike}<span class="bk-n">0</span></span>`;
    const cls = `bk-row${st.available ? '' : ' bk-empty'}`;
    if (compact) {
      return `<div class="${cls}"><span class="bk-counts">${c}</span><span class="bk-name">${esc(st.name)}</span><span class="bk-sub">${sub.join(' · ')}</span></div>`;
    }
    return `<div class="${cls}"><span class="bk-counts">${c}</span><div class="bk-st"><div class="bk-name">${esc(st.name)}</div>${sub.length ? `<div class="bk-sub">${sub.join(' · ')}</div>` : ''}</div></div>`;
  };

  const fleet = (v, radius) => {
    const within = esc(t('within {d}', { d: distText(radius) }));
    if (!v.total) return `<div class="bk-fleet bk-empty"><span class="bk-op">${esc(v.operator)}</span> <span class="bk-sub">${esc(t('none within {d}', { d: distText(radius) }))}</span></div>`;
    const near = v.nearest ? where(v.nearest.dist, v.nearest.bearing) : null;
    const nearest = near && (near.text || near.dir) ? ` · ${esc(t('nearest'))} ${near.dir}${near.text}` : '';
    return `<div class="bk-fleet"><span class="bk-counts">${counts(v.counts)}</span> <span class="bk-op">${esc(v.operator)}</span> <span class="bk-sub">${within}${compact ? '' : nearest}</span></div>`;
  };

  const draw = () => {
    const d = last;
    const errors = (d.errors || []).map((x) => `<div class="err small">${esc(x)}</div>`).join('');
    if (d.needsSetup) return (el.innerHTML = `<div class="dim">${esc(t('Add a sharing system in the module settings'))}</div>`);
    const multi = d.multiOperator;
    let html = '';
    if (d.stations.length) html += `<div class="bk-list">${d.stations.map((st) => station(st, multi)).join('')}</div>`;
    else if (s.maxStations > 0) html += `<div class="dim small bk-none">${esc(t('No stations within {d}', { d: distText(d.radius) }))}</div>`;
    if (s.showFreeFloating !== false && d.vehicles.length) html += `<div class="bk-fleets">${d.vehicles.map((v) => fleet(v, d.radius)).join('')}</div>`;
    el.innerHTML = `<div class="bikes${compact ? ' compact' : ''}">${html || `<div class="dim">${esc(t('Nothing available nearby'))}</div>`}</div>${errors}`;
  };

  return {
    update(d) {
      last = { stations: [], vehicles: [], errors: [], ...d };
      draw();
    },
    refreshSeconds: () => last?.refresh || 0,
  };
}
