// Electricity renderer: current price (large, with cheap/normal/expensive), the cheapest
// window, an hourly bar chart for today/tomorrow and solar/grid/battery from Home Assistant.
import { esc, num } from '../renderers.js';
import { icons } from '../icons.js';

const HOUR = 3600000;
const LEVEL = { cheap: 'cheap', normal: 'normal', expensive: 'expensive' };

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  const ct = (v) => `${num(v, v >= 100 ? 0 : 1)} ct`;
  let data = null;
  let last = '';

  const chart = (d, now) => {
    const hours = d.hours || [];
    if (hours.length < 2) return '';
    const prices = hours.map((h) => h.price);
    const max = Math.max(...prices);
    const lo = Math.min(...prices);
    // the bars start a bit below the cheapest hour, so differences stay visible
    const floor = Math.min(0, lo) < 0 ? lo : Math.max(0, lo - (max - lo || 1) * 0.6);
    const span = max - floor || 1;
    const w = 100 / hours.length;
    const bars = hours.map((h, i) => {
      const hgt = ((h.price - floor) / span) * 40;
      const y = 40 - hgt;
      const cls = [`lv-${LEVEL[h.level] || 'normal'}`, h.start + HOUR <= now ? 'past' : '', h.start <= now && now < h.start + HOUR ? 'now' : ''].filter(Boolean).join(' ');
      return `<rect x="${(i * w + w * 0.12).toFixed(2)}" y="${y.toFixed(2)}" width="${(w * 0.76).toFixed(2)}" height="${Math.max(0.4, hgt).toFixed(2)}" class="${cls}"/>`;
    }).join('');
    // hour labels every 6 hours, a separator at midnight
    const labels = hours.map((h, i) => {
      const hr = ctx.fmt.hourOf(new Date(h.start));
      if (hr % 6) return '';
      const mid = hr === 0 && i > 0 ? `<line x1="${(i * w).toFixed(2)}" x2="${(i * w).toFixed(2)}" y1="0" y2="40" class="midnight"/>` : '';
      return mid;
    }).join('');
    const ticks = hours.map((h, i) => {
      const hr = ctx.fmt.hourOf(new Date(h.start));
      return hr % 6 ? '' : `<span style="left:${(i * w + w / 2).toFixed(2)}%">${hr}</span>`;
    }).join('');
    return `<svg class="en-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${bars}${labels}</svg><div class="en-ticks">${ticks}</div>`;
  };

  const home = (h) => {
    if (!h) return '';
    const parts = [];
    if (Number.isFinite(h.pv)) parts.push(`<span class="en-home-item"><span class="en-ico">${icons.sun}</span>${esc(t('Solar'))} ${esc(num(h.pv, 1))} kW</span>`);
    if (Number.isFinite(h.grid)) parts.push(`<span class="en-home-item">${esc(h.grid < 0 ? t('Feed-in') : t('Grid'))} ${esc(num(Math.abs(h.grid), 1))} kW</span>`);
    if (Number.isFinite(h.battery)) parts.push(`<span class="en-home-item">${esc(t('Battery'))} ${esc(h.battery)} %</span>`);
    const err = h.error && !parts.length ? `<div class="err small">${esc(t(h.error))}</div>` : '';
    return parts.length ? `<div class="en-home">${parts.join('')}</div>` : err;
  };

  const html = (d, now) => {
    if (d.needsSetup) return `<div class="dim small">${esc(t('Enter your Tibber access token in the module settings.'))}</div>`;
    const c = d.current;
    const lv = c?.level || 'normal';
    const head = c
      ? `<div class="en-now lv-${lv}"><span class="en-price">${esc(num(c.price, c.price >= 100 ? 0 : 1))}</span><span class="en-unit">ct/kWh</span><span class="en-level">${esc(t({ cheap: 'cheap', expensive: 'expensive', normal: 'normal' }[lv]))}</span></div>`
      : '';
    const range = `<div class="en-sub dim">${esc(t('Today {min} – {max}, average {avg}', { min: ct(d.today.min), max: ct(d.today.max), avg: ct(d.today.avg) }))}</div>`;
    let win = '';
    if (d.window) {
      const from = ctx.fmt.hour(new Date(d.window.start));
      const to = ctx.fmt.hour(new Date(d.window.end));
      const day = ctx.fmt.dayKey(new Date(d.window.start)) !== ctx.fmt.dayKey(new Date(now)) ? `${t('Tomorrow')} ` : '';
      win = `<div class="en-window"><span class="en-ico">${icons.check}</span>${esc(t('Cheapest {n} h: {from}–{to}', { n: d.windowHours, from: `${day}${from}`, to }))} <span class="dim">· Ø ${esc(ct(d.window.avg))}</span></div>`;
    }
    return head + range + win + (s.showChart !== false ? chart(d, now) : '') + home(d.home);
  };

  const draw = () => {
    if (!data) return;
    const out = html(data, Date.now());
    if (out === last) return;
    last = out;
    el.innerHTML = out;
  };

  return {
    update(d) {
      data = d;
      draw();
    },
    tick: draw, // the current hour moves on
    show: draw,
    tickEvery: 60000,
  };
}
