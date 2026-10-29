// Countdown renderer – list, one large "next event" or a compact line.
// Everything is computed from the settings (public/shared/countdown.js); the
// HTML is only replaced when the text actually changes (once a day, or every
// minute shortly before an event with a time in "precise" mode).
import { esc } from '../renderers.js';
import { upcoming, remaining } from '/shared/countdown.js';

const COLOR = /^#[0-9a-f]{3,8}$/i;

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t, tz } = ctx.fmt;
  const layout = s.layout || 'list';
  const precise = s.precision === 'precise';
  let last = '';

  const items = (now) => upcoming(s.events, now, tz, {
    hidePast: s.hidePast !== false,
    withinDays: s.withinDays || 0,
    sort: s.sort || 'next',
    max: s.maxItems || 0,
  });

  // "in 3 days" / "tomorrow" … as one string (list + compact).
  const left = (r, short = false) => {
    switch (r.kind) {
      case 'today': return t('Today');
      case 'tomorrow': return t('Tomorrow');
      case 'now': return t('Now');
      case 'ago': return r.days === 1 ? t('Yesterday') : t('{n} days ago', { n: r.days });
      case 'hours': return r.h ? t('in {h} h {m} min', { h: r.h, m: r.m }) : t('in {m} min', { m: r.m });
      case 'dayhours': return t('in {d} d {h} h', { d: r.d, h: r.h });
      default: return short ? t('{n} days', { n: r.days }) : t('in {n} days', { n: r.days });
    }
  };

  // Big layout: number + unit, or a word on the day itself.
  const bigLeft = (r) => {
    if (r.kind === 'days') return { num: r.days, unit: t('days') };
    if (r.kind === 'ago') return { num: r.days, unit: r.days === 1 ? t('day ago') : t('days ago') };
    if (r.kind === 'hours' && r.h) return { num: r.h, unit: r.h === 1 ? t('hour') : t('hours') };
    if (r.kind === 'hours') return { num: r.m, unit: t('min') };
    if (r.kind === 'dayhours') return { num: r.d * 24 + r.h, unit: t('hours') };
    return { word: left(r) };
  };

  const years = (it) => {
    if (!it.yearly || it.years === null || it.years < 1 || it.yearsStyle === 'none') return '';
    if (it.yearsStyle === 'age') return t('turns {n}', { n: it.years });
    return it.years === 1 ? t('1 year') : t('{n} years', { n: it.years });
  };

  const dateText = (it, now) => {
    if (!s.showDate) return '';
    let d = ctx.fmt.dateShort(it.key);
    if (it.key.slice(0, 4) !== ctx.fmt.dayKey(now).slice(0, 4)) d += ` ${it.key.slice(0, 4)}`;
    return it.at ? `${d}, ${ctx.fmt.time(it.at)}` : d;
  };

  const style = (it) => (COLOR.test(it.color) ? ` style="--cd-color:${it.color}"` : '');
  const icon = (it) => (it.icon ? `<span class="cd-icon">${esc(it.icon)}</span>` : '');
  const meta = (it, now) => [years(it), dateText(it, now)].filter(Boolean).map(esc).join(' · ');
  const cls = (it, r) => `${it.past ? ' past' : ''}${r.kind !== 'days' && r.kind !== 'ago' ? ' soon' : ''}`;

  const row = (it, now) => {
    const r = remaining(it, now, precise);
    const m = meta(it, now);
    return `<li class="cd-item${cls(it, r)}"${style(it)}>${icon(it)}<div class="cd-main"><div class="cd-name">${esc(it.name)}</div>${m ? `<div class="cd-meta">${m}</div>` : ''}</div><div class="cd-left">${esc(left(r))}</div></li>`;
  };

  const big = (it, now) => {
    const r = remaining(it, now, precise);
    const b = bigLeft(r);
    const m = meta(it, now);
    const value = b.word !== undefined
      ? `<div class="cd-big-word">${esc(b.word)}</div>`
      : `<div class="cd-big-num"><span class="cd-num">${esc(b.num)}</span><span class="cd-unit">${esc(b.unit)}</span></div>`;
    return `<div class="cd-big${cls(it, r)}"${style(it)}>${icon(it)}${value}<div class="cd-big-name">${esc(it.name)}</div>${m ? `<div class="cd-meta">${m}</div>` : ''}</div>`;
  };

  const compact = (it, now) => {
    const r = remaining(it, now, precise);
    return `<span class="cd-chip${cls(it, r)}"${style(it)}>${icon(it)}<span class="cd-name">${esc(it.name)}</span> <span class="cd-left">${esc(left(r, true))}</span></span>`;
  };

  const html = (now) => {
    const list = items(now);
    if (!list.length) return `<div class="dim">${(s.events || []).some((e) => e?.date) ? t('No upcoming events') : t('No events set up')}</div>`;
    if (layout === 'compact') return `<div class="cd-compact">${list.map((it) => compact(it, now)).join('')}</div>`;
    if (layout === 'big') {
      const rest = list.slice(1);
      return big(list[0], now) + (rest.length ? `<ul class="cd-list cd-rest">${rest.map((it) => row(it, now)).join('')}</ul>` : '');
    }
    return `<ul class="cd-list">${list.map((it) => row(it, now)).join('')}</ul>`;
  };

  const draw = () => {
    const out = html(new Date());
    if (out === last) return;
    last = out;
    el.innerHTML = out;
  };

  draw();
  return {
    // The server data only feeds the "only show when …" condition; settings are already here.
    update: draw,
    tick: draw,
    show: draw,
    tickEvery: 60000,
  };
}
