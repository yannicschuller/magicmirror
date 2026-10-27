import { icons, bin, weatherInfo as wmo, hintIcons, weatherIcons, animatedIcon } from './icons.js';
import { hourlyChart, uvLevel, aqiLevel, pollenLevel, tempColor, compass } from './weather-chart.js';
import { translator, langOf } from '/shared/i18n.js';
import pluginRenderers from './modules/index.js';
import { flights } from './flights.js';
import { goStatus, nextReachable } from './transit-go.js';
import { wordClock, GRIDS, litCells } from './word-clock.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Set by makeFmt() – the mirror renders one configuration at a time.
let t = (s) => s;
let decimalComma = false;
export const num = (n, d = 0) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const s = Number(n).toFixed(d);
  return decimalComma ? s.replace('.', ',') : s;
};
const weatherInfo = (code, isDay) => {
  const w = wmo(code, isDay);
  return { ...w, text: t(w.text) };
};
const DAY = 86400000;
const POLLEN_NAMES = { alder: 'Alder', birch: 'Birch', grass: 'Grass', mugwort: 'Mugwort', ragweed: 'Ragweed' };

// ---- time helpers (always in the mirror's configured time zone) -------------
export function makeFmt(general) {
  const tz = general.timezone || 'Europe/Berlin';
  const locale = general.locale || 'en-GB';
  t = translator(langOf(locale));
  decimalComma = new Intl.NumberFormat(locale).format(1.5).includes(',');
  const cache = new Map();
  const f = (opts) => {
    const key = JSON.stringify(opts);
    if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }));
    return cache.get(key);
  };
  const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (d) => keyFmt.format(d);
  const keyDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
  const utc = (key) => new Date(`${key}T12:00:00Z`);
  const fu = (opts) => {
    const k = 'utc' + JSON.stringify(opts);
    if (!cache.has(k)) cache.set(k, new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }));
    return cache.get(k);
  };
  return {
    tz,
    locale,
    t,
    f,
    dayKey,
    keyDiff,
    time: (d) => f({ hour: '2-digit', minute: '2-digit' }).format(d),
    hour: (d) => f({ hour: '2-digit', minute: '2-digit' }).format(d),
    // Label for a YYYY-MM-DD key relative to today.
    dayLabel(key, { long = false } = {}) {
      const diff = keyDiff(dayKey(new Date()), key);
      if (diff === 0) return t('Today');
      if (diff === 1) return t('Tomorrow');
      if (diff === 2 && locale.startsWith('de')) return 'Übermorgen';
      if (diff === -1) return t('Yesterday');
      return fu(long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }).format(utc(key));
    },
    weekdayShort: (key) => fu({ weekday: 'short' }).format(utc(key)).replace('.', ''),
    dateShort: (key) => fu({ day: 'numeric', month: 'short' }).format(utc(key)),
    // Open-Meteo returns local time strings without offset ("2026-10-24T18:00").
    localHour: (s) => s.slice(11, 16),
  };
}

function countdown(ms) {
  if (ms <= 0) return t('running');
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return t('{d} d {h} h', { d, h });
  if (h > 0) return t('{h} h {m} min', { h, m: min });
  return t('{m} min', { m: min });
}

// ---- renderers ---------------------------------------------------------------
// Each renderer: (el, mod, ctx) => { update?(data), tick?(), show?(), hide?(), destroy?() }

const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
const polar = (deg, r) => [Math.sin((deg * Math.PI) / 180) * r, -Math.cos((deg * Math.PI) / 180) * r].map((v) => v.toFixed(2));
function analogSvg(face, seconds) {
  let marks = '';
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0;
    if (face === 'minimal' && i % 15) continue;
    const labels = face === 'numbers' || face === 'roman';
    const [r0, cls] = face === 'minimal' ? [82, 'ac-tick big'] : hour && !labels ? [80, 'ac-tick big'] : [90, 'ac-tick'];
    const [x1, y1] = polar(i * 6, r0);
    const [x2, y2] = polar(i * 6, 95);
    marks += `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    if (labels && hour) {
      const [x, y] = polar(i * 6, 74);
      marks += `<text class="ac-num" x="${x}" y="${y}">${face === 'roman' ? ROMAN[i / 5] : i / 5 || 12}</text>`;
    }
  }
  return `<svg class="clock-analog" viewBox="-100 -100 200 200" aria-hidden="true">${marks}`
    + '<g class="ac-hand ac-hr"><line y1="10" y2="-50"/></g><g class="ac-hand ac-min"><line y1="12" y2="-80"/></g>'
    + `${seconds ? '<g class="ac-hand ac-sec"><line y1="18" y2="-88"/></g>' : ''}<circle class="ac-pin" r="${seconds ? 3.5 : 4.5}"/></svg>`;
}

const clock = (el, mod, ctx) => {
  const s = mod.settings;
  const { f } = ctx.fmt;
  const style = s.style || 'digital';
  const analog = style === 'analog' || style === 'analogDigital';
  const digital = style === 'digital' || style === 'analogDigital';
  const word = style === 'word';
  const secHand = analog && s.showSecondHand !== false;
  const needSec = secHand || (digital && s.showSeconds);
  const lang = langOf(ctx.fmt.locale);
  const timeFmt = f({ hour: '2-digit', minute: '2-digit', hour12: !s.format24 });
  const hmsFmt = f({ hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const dateFmt = f(s.dateStyle === 'full' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { dateStyle: s.dateStyle });
  const partsFmt = f({ year: 'numeric', month: 'numeric', day: 'numeric' });
  const digitalHtml = digital ? `<div class="clock-time"><span class="hm"></span>${s.showSeconds ? '<span class="sec"></span>' : ''}</div>` : '';
  el.innerHTML = `<div class="clock size-${s.size} style-${style}">${analog ? analogSvg(s.analogFace || 'ticks', secHand) : ''}${digitalHtml}${word ? `<div class="clock-words wc-${s.wordStyle === 'grid' ? 'grid' : 'sentence'}" lang="${lang}"></div>` : ''}${s.showDate ? '<div class="clock-date"></div>' : ''}${s.showWeek ? '<div class="clock-week dim"></div>' : ''}</div>`;
  const $ = (q) => el.querySelector(q);
  const hm = $('.hm');
  const sec = $('.sec');
  const date = $('.clock-date');
  const week = $('.clock-week');
  const words = $('.clock-words');
  const hands = analog ? { hr: $('.ac-hr'), min: $('.ac-min'), sec: $('.ac-sec') } : null;
  const isoWeek = (now) => {
    const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, Number(x.value)]));
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow);
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - y0) / DAY + 1) / 7);
  };
  const renderWords = (h, m) => {
    const w = wordClock(h, m, lang, s.wordDialect);
    if (s.wordStyle !== 'grid') {
      words.innerHTML = w.words.map((x, i) => `<span class="${i === w.hourIndex ? 'wc-key' : ''}">${esc(i ? x : x[0].toUpperCase() + x.slice(1))}</span>`).join(' ')
        + (w.extra ? `<span class="wc-extra">${'•'.repeat(w.extra)}</span>` : '');
      return;
    }
    const g = GRIDS[lang === 'en' ? 'en' : 'de'];
    const lit = litCells(w.ids, lang);
    const dots = [0, 1, 2, 3].map((i) => `<i class="wc-dot d${i}${i < w.extra ? ' on' : ''}"></i>`).join('');
    words.innerHTML = `${dots}<div class="wc-letters">${g.rows.map((row, r) => [...row].map((c, i) => `<span${lit.has(`${r}:${i}`) ? ' class="on"' : ''}>${c}</span>`).join('')).join('')}</div>`;
  };
  let lastMin = -1;
  const tick = () => {
    const now = new Date();
    const minKey = Math.floor(now.getTime() / 60000);
    const secs = now.getSeconds(); // time-zone offsets are whole minutes
    if (sec) sec.textContent = String(secs).padStart(2, '0');
    if (hands?.sec) hands.sec.style.transform = `rotate(${secs * 6}deg)`;
    if (minKey === lastMin) return;
    lastMin = minKey;
    const p = Object.fromEntries(hmsFmt.formatToParts(now).map((x) => [x.type, Number(x.value)]));
    const h = p.hour % 24;
    if (hm) hm.textContent = timeFmt.format(now);
    if (hands) {
      hands.hr.style.transform = `rotate(${((h % 12) + p.minute / 60) * 30}deg)`;
      hands.min.style.transform = `rotate(${p.minute * 6}deg)`;
    }
    if (words) renderWords(h, p.minute);
    if (date) date.textContent = dateFmt.format(now);
    if (week) week.textContent = t('Week {n}', { n: isoWeek(now) });
  };
  tick();
  // Without seconds this does almost nothing between minute changes.
  return { tick, tickEvery: needSec ? 1000 : 2000 };
};

const bgKind = (code) => (code >= 95 ? 'thunder' : [71, 73, 75, 77, 85, 86].includes(code) ? 'snow' : (code >= 51 && code <= 67) || (code >= 80 && code <= 82) ? 'rain' : null);
const SEP = '<span class="w-sep"> · </span>';
const lvlClass = (l) => String(l).replace(/ /g, '-');

const weather = (el, mod, ctx) => {
  const s = mod.settings;
  const deg = '°';
  const imperial = s.units === 'imperial';
  const speed = imperial ? 'mph' : 'km/h';
  const extras = new Set(s.extras || ['uv', 'windDirection']);
  const anim = s.animation || 'subtle';
  const compact = s.layout === 'compact';
  const wi = weatherIcons;
  const bigIcon = (info) => (anim !== 'off' ? animatedIcon(info.key) : info.icon);
  const smallIcon = (code, isDay = true) => {
    const info = weatherInfo(code, isDay);
    return anim === 'full' ? animatedIcon(info.key) : info.icon;
  };
  const toC = (v) => (imperial ? ((v - 32) * 5) / 9 : v);
  const x = (cls, body) => `<span class="w-x ${cls}">${body}</span>`;

  const uvItem = (now, max) => {
    if (now == null && max == null) return '';
    const lNow = uvLevel(now ?? 0), lMax = uvLevel(max ?? now);
    return x(`w-uv uv-${lvlClass(lNow)}`, `<i class="w-dot"></i>UV ${num(now)}${max != null ? ` <span class="uv-${lvlClass(lMax)} w-uvmax">↑${num(max)}</span>` : ''}${compact ? '' : ` <span class="dim">${esc(t(lMax))}</span>`}`);
  };
  const windItem = (c, withText) => {
    let w = `${icons.wind} ${num(c.wind)} ${speed}`;
    if (extras.has('windDirection') && c.windDir != null) w += ` ${wi.arrow(c.windDir)}${compact ? '' : `<span class="dim">${esc(t(compass(c.windDir)))}</span>`}`;
    return withText ? x('w-wind', w) : w;
  };

  function extraItems(d) {
    const c = d.current;
    const today = d.daily[0] || {};
    const out = [];
    if (extras.has('uv')) out.push(uvItem(c.uv, today.uv));
    if (extras.has('precipitation') && today.precip != null) out.push(x('w-pr', `${icons.umbrella} ${num(today.precip, 1)} ${imperial ? 'in' : 'mm'}${today.pop != null ? ` · ${num(today.pop)} %` : ''}`));
    if (!s.showDetails && extras.has('windDirection')) out.push(windItem(c, true));
    if (extras.has('gusts') && c.gust != null) out.push(x('w-gust', `${wi.gust} ${esc(t('Gusts {v}', { v: `${num(c.gust)} ${speed}` }))}`));
    if (extras.has('pressure') && c.pressure != null) out.push(x('w-press', `${wi.gauge} ${imperial ? `${num(c.pressure, 2)} inHg` : `${num(c.pressure)} hPa`}`));
    if (extras.has('visibility') && c.visibility != null) out.push(x('w-vis', `${wi.eye} ${num(c.visibility, c.visibility < 10 ? 1 : 0)} ${imperial ? 'mi' : 'km'}`));
    if (extras.has('dewPoint') && c.dewPoint != null) out.push(x('w-dew', `${wi.dew} ${esc(t('Dew point'))} ${num(c.dewPoint)}${deg}`));
    if (extras.has('cloudCover') && c.cloudCover != null) out.push(x('w-cc', `${wi.cloud} ${num(c.cloudCover)} %`));
    if (extras.has('sunshine') && today.sunshine != null) out.push(x('w-ss', `${wi.sun} ${esc(t('{h} h sun', { h: num(today.sunshine / 3600, 1) }))}`));
    const air = d.air;
    if (air && s.airQuality && air.aqi != null) {
      const l = aqiLevel(air.aqi);
      out.push(x(`w-aqi aqi-${lvlClass(l)}`, `${wi.leaf} <i class="w-dot"></i>${esc(t('Air {n}', { n: num(air.aqi) }))}${compact ? '' : ` <span class="dim">${esc(t(l))}</span>`}`));
    }
    if (air && (s.pollen || []).length) {
      const known = s.pollen.filter((p) => air.pollen?.[p] != null);
      const active = known.map((p) => ({ p, l: pollenLevel(p, air.pollen[p]) })).filter((v) => v.l);
      if (active.length) {
        out.push(x('w-pol', `${wi.flower} ${active.map((v) => `<span class="pol-${lvlClass(v.l)}"><i class="w-dot"></i>${esc(t(POLLEN_NAMES[v.p]))}${compact ? '' : ` <span class="dim">${esc(t(v.l))}</span>`}</span>`).join(' ')}`));
      } else if (known.length) {
        out.push(x('w-pol dim', `${wi.flower} ${esc(t('No pollen'))}`));
      }
    }
    return out.filter(Boolean);
  }

  function current(d) {
    const c = d.current;
    const info = weatherInfo(c.code, c.isDay);
    const today = d.daily[0];
    let html = '';
    const details = s.showDetails ? [x('w-feels', `${t('Feels like')} ${num(c.feels)}${deg}`), windItem(c, true), x('w-hum', `${icons.drop} ${num(c.humidity)} %`)] : [];
    const sun = s.showSun && today ? x('w-sunx', `${icons.sunrise} ${ctx.fmt.localHour(today.sunrise)} &nbsp; ${icons.sunset} ${ctx.fmt.localHour(today.sunset)}`) : '';
    const more = extraItems(d);
    if (compact) {
      html += `<div class="w-now"><span class="w-icon">${bigIcon(info)}</span><span class="w-temp">${num(c.temp)}<sup>${deg}</sup></span><span class="w-side"><span class="w-desc">${esc(info.text)}</span>${today ? `<span class="dim">↑${num(today.max)}${deg} ↓${num(today.min)}${deg}</span>` : ''}</span></div>`;
      const line = [...details, ...more, sun].filter(Boolean);
      if (line.length) html += `<div class="w-line dim">${line.join(SEP)}</div>`;
      return html;
    }
    html += `<div class="w-now"><span class="w-icon">${bigIcon(info)}</span><span class="w-temp">${num(c.temp)}<sup>${deg}</sup></span></div>
      <div class="w-desc">${esc(info.text)}${d.location ? ` <span class="dim">· ${esc(d.location)}</span>` : ''}</div>`;
    if (details.length) html += `<div class="w-details w-line dim">${details.join(SEP)}</div>`;
    if (more.length) html += `<div class="w-extras w-line dim">${more.join(SEP)}</div>`;
    if (s.showSun && today) {
      html += `<div class="w-sun dim">${icons.sunrise} ${ctx.fmt.localHour(today.sunrise)} &nbsp; ${icons.sunset} ${ctx.fmt.localHour(today.sunset)} &nbsp; ↑${num(today.max)}${deg} ↓${num(today.min)}${deg}</div>`;
    }
    return html;
  }

  function hourly(d) {
    const style = s.chartStyle || 'icons';
    if (style === 'icons') {
      const hours = d.hourly.filter((_, i) => i > 0 && i % s.hourlyStep === 0).slice(0, s.hourlyCount);
      return `<div class="w-hourly">${hours
        .map((h) => `<div class="w-h"><div class="dim small">${h.time.slice(11, 13)}</div>${smallIcon(h.code, h.isDay)}<div>${num(h.temp)}${deg}</div><div class="w-pop small ${h.pop >= 50 ? 'wet' : 'dim'}">${h.pop >= 10 ? `${h.pop}%` : '&nbsp;'}</div></div>`)
        .join('')}</div>`;
    }
    const bars = style === 'lineBars' ? s.chartBars || 'probability' : 'none';
    // 1 viewBox unit = 0.1em, so text in the SVG matches the module's font size
    const widthEm = Math.min(34, Math.max(compact ? 16 : 19, s.hourlyCount * s.hourlyStep * (compact ? 1.4 : 1.6)));
    const nowMin = Number(String(d.current.time).slice(14, 16)) || 0;
    const { svg, labels } = hourlyChart(d.hourly, {
      count: s.hourlyCount,
      step: s.hourlyStep,
      bars,
      width: widthEm * 10,
      maxLabels: Math.max(3, Math.floor(widthEm / 3)),
      nowFrac: nowMin / 60,
      amountMin: imperial ? 0.08 : 2,
      fmtTemp: (n) => `${num(n)}${deg}`,
      fmtBar: (h) => (bars === 'amount' ? num(h.precip, 1) : `${h.pop}%`),
      hourLabel: (h) => h.time.slice(11, 13),
      uid: mod.id,
    });
    if (!svg) return '';
    return `<div class="w-chart" style="width:${widthEm}em"><div class="w-cicons">${labels
      .map((l) => `<span style="left:${l.xPct}%">${smallIcon(l.hour.code, l.hour.isDay)}</span>`)
      .join('')}</div>${svg}</div>`;
  }

  function daily(d) {
    const days = d.daily.slice(0, s.forecastDays);
    const label = (x, i) => (i === 0 ? t('Today') : ctx.fmt.weekdayShort(x.date));
    const pop = (x) => `<td class="w-pp small ${x.pop >= 50 ? 'wet' : 'dim'}">${x.pop >= 10 ? `${icons.drop}${x.pop}%` : ''}</td>`;
    const uv = (x) => (s.dailyUv ? `<td class="w-du small">${x.uv != null ? `<span class="w-uvb uv-${lvlClass(uvLevel(x.uv))}">UV ${num(x.uv)}</span>` : ''}</td>` : '');
    if (s.dailyStyle === 'bars') {
      // CSS grid instead of a table: the range bar column can shrink (minmax) in narrow regions
      const lo = Math.min(...days.map((x) => x.min)), hi = Math.max(...days.map((x) => x.max));
      const span = hi - lo || 1;
      const pct = (v) => Math.round(((v - lo) / span) * 1000) / 10;
      const cur = d.current.temp;
      return `<div class="w-dgrid${s.dailyUv ? ' has-uv' : ''}">${days
        .map((x, i) => {
          const r = `w-r${i + 1}`;
          const cell = (cls, body) => `<span class="${cls} ${r}">${body}</span>`;
          const dot = i === 0 && cur != null && cur >= lo && cur <= hi ? `<i class="w-cur" style="left:${pct(cur)}%"></i>` : '';
          return cell('w-dn', label(x, i)) + cell('w-di', smallIcon(x.code))
            + cell(`w-pp small ${x.pop >= 50 ? 'wet' : 'dim'}`, x.pop >= 10 ? `${icons.drop}${x.pop}%` : '')
            + (s.dailyUv ? cell('w-du small', x.uv != null ? `<span class="w-uvb uv-${lvlClass(uvLevel(x.uv))}">UV ${num(x.uv)}</span>` : '') : '')
            + cell('w-min dim', `${num(x.min)}${deg}`)
            + cell('w-rng', `<span class="w-track"><span class="w-fill" style="left:${pct(x.min)}%;width:${Math.max(2, pct(x.max) - pct(x.min))}%;background:linear-gradient(90deg,${tempColor(toC(x.min))},${tempColor(toC(x.max))})"></span>${dot}</span>`)
            + cell('w-max', `${num(x.max)}${deg}`);
        })
        .join('')}</div>`;
    }
    return `<table class="w-days">${days
      .map((x, i) => `<tr><td class="w-dn">${label(x, i)}</td><td class="w-di">${smallIcon(x.code)}</td><td class="w-max">${num(x.max)}${deg}</td><td class="w-min dim">${num(x.min)}${deg}</td>${pop(x)}${uv(x)}</tr>`)
      .join('')}</table>`;
  }

  return {
    update(d) {
      const kind = anim === 'full' && s.animatedBackground ? bgKind(d.current.code) : null;
      let html = `<div class="weather layout-${compact ? 'compact' : 'detailed'} anim-${anim}">`;
      if (kind) html += `<div class="w-bg w-bg-${kind}"><i></i></div>`;
      if (s.showCurrent) html += current(d);
      if (s.showHourly) html += hourly(d);
      if (s.forecastDays > 0) html += daily(d);
      el.innerHTML = html + '</div>';
    },
  };
};

const weather_hints = (el) => ({
  update(d) {
    el.closest('.module').classList.toggle('empty', !d.hints.length);
    el.innerHTML = `<div class="hints">${d.hints
      .map((h) => `<div class="hint lvl-${h.level} kind-${h.kind}"><span class="hint-ico">${icons[hintIcons[h.kind]] || icons.warning}</span><div><div class="hint-title">${esc(h.title)}</div><div class="hint-detail">${esc(h.detail)}</div></div></div>`)
      .join('')}</div>`;
  },
});

const waste = (el, mod, ctx) => {
  const s = mod.settings;
  let last = null;
  const render = () => {
    const d = last;
    if (!d) return;
    if (!d.days.length) {
      el.innerHTML = `<div class="dim">${s.sources.length || s.manual.length ? t('No collection coming up') : t('No waste calendar set up')}</div>${d.errors.map((x) => `<div class="err small">${esc(x)}</div>`).join('')}`;
      return;
    }
    const now = new Date();
    const today = ctx.fmt.dayKey(now);
    const hour = Number(ctx.fmt.f({ hour: 'numeric', hour12: false }).format(now));
    el.innerHTML = `<div class="waste">${d.days
      .map((day) => {
        const diff = ctx.fmt.keyDiff(today, day.date);
        const remind = (diff === 1 && hour >= s.reminderHour) || (diff === 0 && hour < 10);
        const note = diff === 1 && hour >= s.reminderHour ? t('Put it out tonight!') : diff === 0 && hour < 10 ? t('Collection today!') : '';
        const when = diff > 2 ? `${ctx.fmt.weekdayShort(day.date)}, ${ctx.fmt.dateShort(day.date)} <span class="dim small">${t('in {n} days', { n: diff })}</span>` : esc(ctx.fmt.dayLabel(day.date));
        return `<div class="waste-day${remind ? ' remind' : ''}${diff <= 1 ? ' soon' : ''}"><div class="waste-when">${when}</div><div class="waste-items">${day.items
          .map((i) => `<span class="waste-item">${bin(esc(i.color))}<span>${esc(i.name)}</span></span>`)
          .join('')}</div>${note ? `<div class="waste-note">${note}</div>` : ''}</div>`;
      })
      .join('')}${d.errors.map((x) => `<div class="err small">${esc(x)}</div>`).join('')}</div>`;
  };
  return { update(d) { last = d; render(); }, tick: render, tickEvery: 60000 };
};

const TEAM_COLORS = [
  ['red bull', '#3671C6'], ['ferrari', '#E8002D'], ['mercedes', '#27F4D2'], ['mclaren', '#FF8000'], ['aston', '#229971'],
  ['alpine', '#FF87BC'], ['williams', '#64C4FF'], ['rb f1', '#6692FF'], ['racing bulls', '#6692FF'], ['sauber', '#52E252'],
  ['audi', '#F50537'], ['haas', '#B6BABD'], ['cadillac', '#D4AF37'],
];
const teamColor = (name = '') => TEAM_COLORS.find(([k]) => name.toLowerCase().includes(k))?.[1] || '#888';

const f1 = (el, mod, ctx) => {
  const s = mod.settings;
  const fav = s.favoriteDrivers.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  let last = null;
  const render = () => {
    const d = last;
    if (!d) return;
    if (d.offseason) {
      el.innerHTML = `<div class="dim">${t('Off-season – the race calendar has not been published yet.')}</div>`;
      return;
    }
    const now = Date.now();
    const next = d.nextSession;
    const ms = new Date(next.start) - now;
    const live = ms <= 0 && ms > -2 * 3600 * 1000;
    const wd = ctx.fmt.f({ weekday: 'short' });
    let html = `<div class="f1">
      <div class="f1-meta dim small">${t('Round {n}', { n: d.round })}${d.totalRounds ? ` / ${d.totalRounds}` : ''} · ${t('Season {n}', { n: d.season })}${d.isSprint ? ` · <span class="accent">${t('Sprint weekend')}</span>` : ''}</div>
      <div class="f1-name">${esc(d.raceName)}</div>
      <div class="f1-circuit dim">${icons.pin} ${esc(d.circuit)} · ${esc(d.locality)}, ${esc(d.country)}</div>`;
    if (s.showCountdown) {
      html += `<div class="f1-countdown${live ? ' live' : ''}"><span class="f1-cd-label">${esc(next.label)}</span><span class="f1-cd-value">${live ? '● LIVE' : t('in {time}', { time: countdown(ms) })}</span></div>`;
    }
    if (s.showSessions) {
      html += `<table class="f1-sessions">${d.sessions
        .map((x) => {
          const start = new Date(x.start);
          const past = start.getTime() + 2 * 3600 * 1000 < now;
          const cls = x.key === next.key ? 'next' : past ? 'past' : '';
          return `<tr class="${cls}"><td>${esc(x.label)}</td><td class="r">${wd.format(start).replace('.', '')}</td><td class="r">${ctx.fmt.time(start)}</td></tr>`;
        })
        .join('')}</table>`;
    }
    const facts = [];
    if (d.trackWeather) {
      const w = d.trackWeather;
      facts.push(`<span>${weatherInfo(w.code).icon} ${t('Race day')} ${num(w.max)}° · ${icons.drop}${num(w.pop)} %</span>`);
    }
    if (d.previousWinner) facts.push(`<span>${icons.trophy} ${d.previousWinner.season}: ${esc(d.previousWinner.name)}</span>`);
    if (facts.length) html += `<div class="f1-facts small">${facts.join('')}</div>`;
    if (d.lastRace) {
      html += `<div class="f1-sub dim small">${t('Last race')} · ${esc(d.lastRace.name)}</div><div class="f1-podium">${d.lastRace.podium
        .map((p) => `<span class="p${p.pos}"><b>P${p.pos}</b> ${esc(p.code || p.name)}</span>`)
        .join('')}</div>`;
    }
    if (d.driverStandings?.length) {
      html += `<div class="f1-sub dim small">${t('Driver standings')}</div><table class="f1-standings">${d.driverStandings
        .map((x) => `<tr class="${fav.includes(x.code) ? 'fav' : ''}"><td class="r dim">${x.pos}</td><td><span class="team" style="background:${teamColor(x.team)}"></span>${esc(x.name)}</td><td class="r">${x.points}</td></tr>`)
        .join('')}</table>`;
    }
    if (d.constructorStandings?.length) {
      html += `<div class="f1-sub dim small">${t('Constructor standings')}</div><table class="f1-standings">${d.constructorStandings
        .map((x) => `<tr><td class="r dim">${x.pos}</td><td><span class="team" style="background:${teamColor(x.name)}"></span>${esc(x.name)}</td><td class="r">${x.points}</td></tr>`)
        .join('')}</table>`;
    }
    el.innerHTML = html + '</div>';
  };
  return { update(d) { last = d; render(); }, tick: render, tickEvery: 30000 };
};

const transit = (el, mod, ctx) => {
  const s = mod.settings;
  let last = null;
  const render = () => {
    const d = last;
    if (!d) return;
    if (d.needsSetup) {
      el.innerHTML = `<div class="dim">${t('Please choose a stop in the admin panel.')}</div>`;
      return;
    }
    const now = Date.now();
    const go = s.goNow ? s.goNowStyle || 'dot' : null;
    const earliest = go ? now - 60000 : now + (Number(s.walkMinutes) || 0) * 60000 - 30000;
    const rows = d.departures
      .filter((x) => new Date(x.realtime || x.planned).getTime() > Math.max(now - 60000, earliest))
      .map((x) => ({ x, st: go ? goStatus(new Date(x.realtime || x.planned).getTime(), now, s) : null }))
      .filter(({ st }) => !st || st.level !== 'gone' || s.hideUnreachable === false)
      .map(({ x, st }) => {
        const goCls = st ? ` go-${st.level}` : '';
        const dot = go === 'dot' ? `<td class="go-cell">${st && !x.cancelled && st.level !== 'gone' ? '<span class="go-dot"></span>' : ''}</td>` : '';
        const planned = new Date(x.planned);
        const when = new Date(x.realtime || x.planned);
        const mins = Math.round((when - now) / 60000);
        const delay = x.realtime ? Math.round((when - planned) / 60000) : null;
        const rel = mins <= 0 ? t('now') : t('{m} min', { m: mins });
        const abs = ctx.fmt.time(planned);
        const time = s.timeMode === 'absolute' ? abs : s.timeMode === 'both' ? `${rel} <span class="dim small">${abs}</span>` : rel;
        const delayHtml = s.showDelay && delay !== null ? `<span class="delay ${delay > 0 ? 'late' : 'ontime'}">${delay > 0 ? `+${delay}` : '±0'}</span>` : '';
        return `<tr class="${x.cancelled ? 'cancelled' : ''}${mins <= 1 && !go ? ' imminent' : ''}${goCls}">${dot}<td><span class="line cat-${x.category}">${esc(x.line)}</span></td><td class="dest">${esc(x.destination)}</td>${s.showPlatform ? `<td class="plat dim small">${esc(x.platform.replace(/^(Gleis|Bstg\.?|Steig|Bussteig)\s*/i, ''))}</td>` : ''}<td class="r tm">${x.cancelled ? `<span class="late">${t('cancelled')}</span>` : `${time}${delayHtml}`}</td></tr>`;
      });
    let banner = '';
    if (go === 'banner') {
      const next = nextReachable(d.departures, now, s);
      if (next) {
        const { departure: x, leave, level } = next;
        const m = Math.floor(leave);
        const msg = level === 'run' ? t('Run!') : m < 1 ? t('Leave now!') : t('Leave in {m} min', { m });
        banner = `<div class="go-banner go-${level}"><span class="go-dot"></span><span>${t('Line {line}', { line: esc(x.line) })} → ${esc(x.destination)}: <b>${msg}</b></span></div>`;
      } else banner = `<div class="go-banner dim">${t('No reachable departure')}</div>`;
    }
    el.innerHTML = `<div class="transit go-style-${go || 'none'}">${d.stop ? `<div class="dim small tr-stop">${esc(d.stop)}</div>` : ''}${banner}${rows.length ? `<table>${rows.join('')}</table>` : `<div class="dim">${t('No departures')}</div>`}</div>`;
  };
  return { update(d) { last = d; render(); }, tick: render, tickEvery: 15000 };
};

let go2rtcLoaded = null;
const camera = (el, mod) => {
  const s = mod.settings;
  let timer = null;
  let visible = true;
  let streams = [];
  const refreshSnapshots = () => {
    if (!visible) return;
    el.querySelectorAll('img.cam-img').forEach((img) => {
      const next = new Image();
      next.onload = () => {
        img.src = next.src;
        img.parentElement.classList.remove('offline');
      };
      next.onerror = () => img.parentElement.classList.add('offline');
      next.src = `/go2rtc/frame/${encodeURIComponent(img.dataset.src)}?t=${Date.now()}`;
    });
  };
  const build = () => {
    clearInterval(timer);
    if (!streams.length) {
      el.innerHTML = `<div class="dim">${t('No camera set up')}</div>`;
      return;
    }
    el.innerHTML = `<div class="cams" style="grid-template-columns:repeat(${s.columns},1fr);width:${s.width}%">${streams
      .map((c) => `<div class="cam"><div class="cam-off dim small">${icons.camera} ${t('Camera unreachable')}</div>${s.mode === 'snapshot' ? `<img class="cam-img" data-src="${esc(c.src)}" alt="">` : `<div class="cam-live" data-src="${esc(c.src)}"></div>`}${s.showName ? `<div class="cam-name">${esc(c.name)}</div>` : ''}</div>`)
      .join('')}</div>`;
    if (s.mode === 'snapshot') {
      refreshSnapshots();
      timer = setInterval(refreshSnapshots, s.refreshSeconds * 1000);
    } else {
      go2rtcLoaded ||= import('/go2rtc/video-stream.js').catch((err) => console.warn('go2rtc player', err));
      go2rtcLoaded.then(() => {
        el.querySelectorAll('.cam-live').forEach((box) => {
          if (!customElements.get('video-stream')) return box.parentElement.classList.add('offline');
          const v = document.createElement('video-stream');
          v.mode = 'mse';
          v.background = false;
          box.append(v);
          if (v.video) v.video.controls = false;
          v.src = `/go2rtc/api/ws?src=${encodeURIComponent(box.dataset.src)}`;
        });
      });
    }
  };
  return {
    update(d) {
      const sig = JSON.stringify(d.streams);
      if (sig === JSON.stringify(streams) && el.children.length) return;
      streams = d.streams;
      build();
    },
    show() { visible = true; refreshSnapshots(); },
    hide() { visible = false; },
    destroy() { clearInterval(timer); },
  };
};

const greeting = (el, mod, ctx) => {
  const s = mod.settings;
  let current = '';
  const hourFmt = ctx.fmt.f({ hour: '2-digit', hourCycle: 'h23' });
  const pick = () => {
    const h = Number(hourFmt.format(new Date()));
    const key = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
    const lines = s[key].split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    const options = lines.length > 1 ? lines.filter((l) => l !== current) : lines;
    current = options[Math.floor(Math.random() * options.length)];
    return current.replace(/\{name\}/g, s.name ? `, ${s.name}` : '');
  };
  el.innerHTML = `<div class="greeting size-${s.size}"></div>`;
  const box = el.firstChild;
  const tick = () => {
    box.classList.add('fading');
    setTimeout(() => {
      box.textContent = pick();
      box.classList.remove('fading');
    }, 600);
  };
  box.textContent = pick();
  return { tick, tickEvery: s.intervalSeconds * 1000 };
};

const text = (el, mod) => {
  const s = mod.settings;
  el.innerHTML = `<div class="freetext size-${s.size}" style="text-align:${s.align}">${esc(s.content).replace(/\n/g, '<br>')}</div>`;
  return {};
};

export const renderers = { clock, weather, weather_hints, waste, f1, transit, flights, camera, greeting, text, ...pluginRenderers };
