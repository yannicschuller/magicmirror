// Internet & network renderer.
import { esc, num } from '../renderers.js';

const STATUS = { ok: 'Online', slow: 'Slow', degraded: 'Partly reachable', dns: 'DNS problem', offline: 'Offline' };

const ms = (v) => (v === null || v === undefined ? '–' : `${num(v, v < 10 ? 1 : 0)} ms`);
const rate = (v) => (v === null || v === undefined ? '–' : num(v, v < 10 ? 1 : 0));

// Latency history as a polyline; gaps (null) are marked at the bottom.
export function sparkline(values, warnMs, w = 160, h = 26) {
  const n = values.length;
  if (n < 2) return '';
  const nums = values.filter((v) => v !== null);
  const max = Math.max(warnMs || 0, ...nums, 1) * 1.1;
  const x = (i) => ((i / (n - 1)) * w).toFixed(1);
  const y = (v) => (h - 1 - (v / max) * (h - 2)).toFixed(1);
  const segs = [];
  let cur = [];
  const gaps = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segs.push(cur);
      cur = [];
      gaps.push(`<rect x="${(x(i) - 1).toFixed(1)}" y="${h - 3}" width="2" height="3" class="net-gap"/>`);
    } else cur.push(`${x(i)},${y(v)}`);
  });
  if (cur.length) segs.push(cur);
  const lines = segs.map((p) => (p.length > 1 ? `<polyline points="${p.join(' ')}"/>` : `<circle cx="${p[0].split(',')[0]}" cy="${p[0].split(',')[1]}" r="1.2"/>`)).join('');
  const warn = warnMs > 0 && warnMs < max ? `<line x1="0" x2="${w}" y1="${y(warnMs)}" y2="${y(warnMs)}" class="net-warn-line"/>` : '';
  return `<svg class="net-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">${warn}<g class="net-line">${lines}</g>${gaps.join('')}</svg>`;
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;

  const when = (iso) => {
    const d = new Date(iso);
    const key = ctx.fmt.dayKey(d);
    return key === ctx.fmt.dayKey(new Date()) ? ctx.fmt.time(d) : `${ctx.fmt.dayLabel(key)} ${ctx.fmt.time(d)}`;
  };

  const speedText = (sp) => `↓ ${rate(sp.down)}${sp.up !== null && sp.up !== undefined ? ` ↑ ${rate(sp.up)}` : ''} ${t('Mbit/s')}`;

  const devicesHtml = (d) => {
    const list = (d.devices || []).filter((x) => x.home || s.showAway);
    if (!list.length) return '';
    return `<div class="net-devices">${list
      .map((x) => {
        const title = x.home ? t('At home') : x.where || t('Away');
        return `<span class="net-dev${x.home ? ' home' : ''}" title="${esc(title)}"><span class="net-dot"></span>${esc(x.name)}${!x.home && x.where && s.layout !== 'compact' ? ` <span class="net-where">${esc(x.where)}</span>` : ''}</span>`;
      })
      .join('')}</div>`;
  };

  const compact = (d) => {
    const parts = [`<span class="net-status lvl-${esc(d.level)}"><span class="net-dot"></span>${esc(t(STATUS[d.status] || d.status))}</span>`];
    if (d.status !== 'offline' && d.latency !== null) parts.push(`<span class="net-lat">${esc(ms(d.latency))}</span>`);
    if (d.speed) parts.push(`<span class="net-speed">${esc(speedText(d.speed))}</span>`);
    if (d.publicIp) parts.push(`<span class="net-ip">${esc(d.publicIp.ip)}</span>`);
    return `<div class="net-compact">${parts.join('<span class="net-sep">·</span>')}${devicesHtml(d)}</div>`;
  };

  const detailed = (d) => {
    const sub = [];
    if (d.total) sub.push(t('{n} of {total} reachable', { n: d.reachable, total: d.total }));
    if (d.loss > 0 && d.reachable) sub.push(t('{n} % lost', { n: Math.round(d.loss * 100) }));
    if (d.dns) sub.push(d.dns.ok ? t('DNS {ms}', { ms: ms(d.dns.ms) }) : t('DNS failed'));
    const head = `<div class="net-head lvl-${esc(d.level)}"><span class="net-dot big"></span><span class="net-state">${esc(t(STATUS[d.status] || d.status))}</span>${
      d.status !== 'offline' && d.latency !== null ? `<span class="net-lat">${esc(ms(d.latency))}</span>` : ''
    }</div>`;
    const rows = [head, `<div class="net-sub">${esc(sub.join(' · '))}</div>`];
    if (s.showTargets && d.targets?.length) {
      rows.push(`<div class="net-targets">${d.targets.map((x) => `<span class="${x.ok ? '' : 'down'}">${esc(x.label)} ${esc(x.ok ? ms(x.ms) : '✕')}</span>`).join('')}</div>`);
    }
    if (s.showSparkline && (d.history || []).length > 1) rows.push(sparkline(d.history, d.warnMs));
    if (d.speed) {
      rows.push(`<div class="net-speed"><span class="net-rate">${esc(speedText(d.speed))}</span> <span class="net-when">${esc(when(d.speed.at))}</span></div>`);
    } else if (s.speedTest) {
      rows.push(`<div class="net-speed net-when">${esc(d.speedRunning ? t('Speed test running …') : d.speedError ? t('Speed test failed') : t('Speed test pending'))}</div>`);
    }
    if (d.publicIp) rows.push(`<div class="net-ip">${esc(t('IP {ip}', { ip: d.publicIp.ip }))}${d.publicIp.loc ? ` · ${esc(d.publicIp.loc)}` : ''}</div>`);
    rows.push(devicesHtml(d));
    if (d.presenceError) rows.push(`<div class="net-err">${esc(d.presenceError)}</div>`);
    return `<div class="net-detailed">${rows.join('')}</div>`;
  };

  return {
    update(d) {
      el.innerHTML = s.layout === 'compact' ? compact(d) : detailed(d);
    },
    refreshSeconds: () => Math.max(30, Number(s.refreshSeconds) || 60),
  };
}
