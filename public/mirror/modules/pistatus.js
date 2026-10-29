import { esc, num } from '../renderers.js';

const GB = 2 ** 30;
const clamp = (n) => Math.max(0, Math.min(100, n));

export function bytes(b) {
  return b >= GB ? `${num(b / GB, 1)} GB` : `${num(b / 2 ** 20)} MB`;
}

export function duration(sec, t) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return t('{d} d {h} h', { d, h });
  if (h) return t('{h} h {m} min', { h, m });
  return t('{m} min', { m });
}

// Polyline points for a sparkline in a 100×24 box.
export function sparkPoints(values, lo, hi) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null && p.v !== undefined);
  if (pts.length < 2) return '';
  const n = values.length - 1 || 1;
  const span = hi - lo || 1;
  return pts.map((p) => `${((p.i / n) * 100).toFixed(1)},${(22 - ((p.v - lo) / span) * 20).toFixed(1)}`).join(' ');
}

const ARROW = { up: '↑', down: '↓' };

// Visible items in display order; unavailable values are skipped.
export function items(d, show, t) {
  const has = (k) => show.includes(k);
  const lvl = (...keys) => {
    const w = (d.warnings || []).filter((x) => keys.includes(x.key));
    return w.some((x) => x.level === 'severe') ? 'severe' : w.length ? 'warn' : '';
  };
  const out = [];
  if (has('temp') && d.temp !== null && d.temp !== undefined) {
    const arrow = ARROW[d.tempTrend] ? ` <span class="ps-trend">${ARROW[d.tempTrend]}</span>` : '';
    out.push({ key: 'temp', label: t('Temp'), value: `${num(d.temp, 1)} °C${arrow}`, bar: clamp(((d.temp - 30) / 55) * 100), level: lvl('temp') });
  }
  if (has('cpu') && d.cpu !== null && d.cpu !== undefined) {
    out.push({ key: 'cpu', label: t('CPU'), value: `${num(d.cpu)} %`, bar: clamp(d.cpu), level: '' });
  }
  if (has('load') && d.load) {
    out.push({ key: 'load', label: t('Load'), value: num(d.load[0], 2), bar: clamp(d.loadPct), sub: `${num(d.load[1], 2)} · ${num(d.load[2], 2)} · ${t('{n} cores', { n: d.cores })}`, level: '' });
  }
  if (has('ram') && d.mem) {
    out.push({ key: 'ram', label: t('RAM'), value: `${num(d.mem.pct)} %`, bar: clamp(d.mem.pct), sub: `${bytes(d.mem.used)} / ${bytes(d.mem.total)}`, level: lvl('ram') });
  }
  if (has('disk') && d.disk) {
    out.push({ key: 'disk', label: t('Disk'), value: `${num(d.disk.pct)} %`, bar: clamp(d.disk.pct), sub: t('{size} free', { size: bytes(d.disk.free) }), level: lvl('disk') });
  }
  if (has('uptime') && d.uptime !== null && d.uptime !== undefined) {
    out.push({ key: 'uptime', label: t('Uptime'), value: esc(duration(d.uptime, t)), level: '' });
  }
  // Power problems are listed as warnings; the item itself only says "OK".
  if (has('power') && d.power && !lvl('underVoltage', 'throttled')) {
    out.push({ key: 'power', label: t('Power'), value: esc(t('OK')), level: '' });
  }
  return out;
}

function warningHtml(w, t) {
  const params = w.params ? Object.fromEntries(Object.entries(w.params).map(([k, v]) => [k, typeof v === 'number' ? num(v, k === 't' ? 1 : 0) : v])) : undefined;
  return `<div class="ps-warn lvl-${w.level}">${w.level === 'severe' ? '⚠' : '!'} ${esc(t(w.id, params))}</div>`;
}

function spark(label, value, values, lo, hi, level) {
  const pts = sparkPoints(values, lo, hi);
  const svg = pts ? `<svg class="ps-spark" viewBox="0 0 100 24" preserveAspectRatio="none"><polyline points="${pts}" /></svg>` : '<span class="ps-spark"></span>';
  return `<div class="ps-srow${level ? ` lvl-${level}` : ''}"><span class="ps-l">${esc(label)}</span>${svg}<span class="ps-v">${value}</span></div>`;
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const t = ctx.fmt.t;
  return {
    refreshSeconds: () => Math.max(10, Number(s.refreshSeconds) || 30),
    update(d) {
      const show = s.show || [];
      const list = items(d, show, t);
      const warnings = (d.warnings || []).map((w) => warningHtml(w, t)).join('');
      if (!list.length && !warnings) {
        el.innerHTML = `<div class="dim small">${esc(t('No device data available'))}</div>`;
        return;
      }
      const cls = (i) => `ps-i${i.level ? ` lvl-${i.level}` : ''}`;
      const inline = (arr) => arr.map((i) => `<span class="${cls(i)}"><span class="ps-l">${esc(i.label)}</span> <span class="ps-v">${i.value}</span></span>`).join('<span class="ps-sep"> · </span>');
      let body = '';
      if (s.layout === 'compact') {
        body = list.length ? `<div class="ps-line">${inline(list)}</div>` : '';
      } else if (s.layout === 'sparkline') {
        const hist = d.history || [];
        const rest = [];
        for (const i of list) {
          if (i.key === 'temp') {
            const temps = hist.map((h) => h.temp).filter((v) => v !== null);
            const lo = Math.min(...temps, d.temp);
            const hi = Math.max(...temps, d.temp, lo + 5);
            body += spark(i.label, i.value, hist.map((h) => h.temp), lo - 0.5, hi + 0.5, i.level);
          } else if (i.key === 'cpu') {
            body += spark(i.label, i.value, hist.map((h) => h.cpu), 0, 100, i.level);
          } else rest.push(i);
        }
        body = `<div class="ps-sparks">${body}</div>${rest.length ? `<div class="ps-line">${inline(rest)}</div>` : ''}`;
      } else {
        const tiles = list.map((i) => `<div class="ps-tile ${cls(i)}"><div class="ps-l">${esc(i.label)}</div><div class="ps-v">${i.value}</div>`
          + (i.bar !== undefined ? `<div class="ps-bar"><i style="width:${i.bar.toFixed(0)}%"></i></div>` : '')
          + (i.sub ? `<div class="ps-sub">${esc(i.sub)}</div>` : '')
          + '</div>').join('');
        body = list.length ? `<div class="ps-tiles" style="--cols:${Math.min(3, list.length)}">${tiles}</div>` : '';
      }
      el.innerHTML = `<div class="ps">${body}${warnings ? `<div class="ps-warns">${warnings}</div>` : ''}</div>`;
    },
  };
}
