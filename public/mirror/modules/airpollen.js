// "Pollen & air quality" renderer.
import { esc, num } from '../renderers.js';
import { POLLEN_TYPES } from '/shared/modules/airpollen.js';

const NAMES = Object.fromEntries(POLLEN_TYPES.map((p) => [p.value, p.label]));
// DWD index 0…3 in half steps → text.
const LEVEL_TEXT = ['None', 'None to low', 'Low', 'Low to medium', 'Medium', 'Medium to high', 'High'];
const AQI_TEXT = { good: 'Good', fair: 'Fair', moderate: 'Moderate', poor: 'Poor', 'very poor': 'Very poor', 'extremely poor': 'Extremely poor' };
const SHORT = { pm2_5: 'PM2.5', pm10: 'PM10', ozone: 'O₃', nitrogen_dioxide: 'NO₂', uv_index: 'UV' };

export function levelClass(v) {
  if (v === null || v === undefined) return 'na';
  if (v < 0.5) return 'none';
  if (v <= 1) return 'low';
  if (v <= 2) return 'mid';
  return 'high';
}
const cls = (cat) => String(cat || 'na').replace(/ /g, '-');

// Three segments, each full / half / empty.
function bar(v, title) {
  const segs = [0, 1, 2]
    .map((i) => {
      const f = v === null ? 0 : Math.min(1, Math.max(0, v - i));
      return `<i${f >= 1 ? ' class="f"' : f > 0 ? ' class="h"' : ''}></i>`;
    })
    .join('');
  return `<span class="ap-bar lvl-${levelClass(v)}" title="${esc(title)}">${segs}</span>`;
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t, dayLabel, localHour } = ctx.fmt;
  const levelText = (v) => (v === null || v === undefined ? '–' : t(LEVEL_TEXT[Math.round(v * 2)] || ''));

  function pollenHtml(d) {
    const p = d.pollen;
    if (!p) return '';
    if (p.error) return `<div class="ap-msg dim">${esc(p.error)}</div>`;
    if (!p.items.length) {
      return `<div class="ap-msg dim">${esc(p.total ? t('No relevant pollen load') : t('No pollen forecast available'))}</div>`;
    }
    const days = d.days;
    if (s.layout === 'chips') {
      const chips = p.items
        .map((it) => {
          const [first, ...rest] = it.values;
          const dots = rest.map((v) => `<i class="lvl-${levelClass(v)}"></i>`).join('');
          return `<span class="ap-chip lvl-${levelClass(first)}" title="${esc(levelText(first))}">${esc(t(NAMES[it.id]))}${dots ? `<span class="ap-dots">${dots}</span>` : ''}</span>`;
        })
        .join('');
      return `<div class="ap-chips">${chips}</div>`;
    }
    const single = days.length === 1;
    const head = single ? '' : `<span></span>${days.map((k) => `<span class="ap-day">${esc(dayLabel(k))}</span>`).join('')}`;
    const rows = p.items
      .map((it) => {
        const cells = it.values.map((v) => `<span class="ap-cell">${bar(v, levelText(v))}</span>`).join('');
        const text = single ? `<span class="ap-lvl lvl-${levelClass(it.values[0])}">${esc(levelText(it.values[0]))}</span>` : '';
        return `<span class="ap-name">${esc(t(NAMES[it.id]))}</span>${cells}${text}`;
      })
      .join('');
    return `<div class="ap-list" style="--n:${single ? 2 : days.length}">${head}${rows}</div>`;
  }

  function airHtml(d) {
    const a = d.air;
    if (!a) return '';
    if (a.error) return `<div class="ap-msg dim">${esc(a.error)}</div>`;
    if (a.aqi === null) return `<div class="ap-msg dim">${esc(t('No air quality data'))}</div>`;
    const main = `<div class="ap-aqi aqi-${cls(a.level)}"><span class="ap-dot"></span><span class="ap-aqi-label">${esc(t('Air quality'))}</span> <span class="ap-aqi-text">${esc(t(AQI_TEXT[a.level]))}</span> <span class="ap-aqi-val">${a.aqi}</span></div>`;
    const pol = a.pollutants.length
      ? `<div class="ap-pol">${a.pollutants
          .map((x) => `<span class="aqi-${cls(x.level)}"><span class="ap-pol-k">${esc(t(SHORT[x.id]))}</span> ${num(x.value, x.id === 'uv_index' || x.value < 10 ? 1 : 0)}</span>`)
          .join('')}</div>`
      : '';
    const peak = a.peak
      ? `<div class="ap-peak">${esc(t('Up to {aqi} ({level}) around {time}', { aqi: a.peak.aqi, level: t(AQI_TEXT[a.peak.level]).toLowerCase(), time: localHour(a.peak.time) }))}</div>`
      : '';
    return `${main}${pol}${peak}`;
  }

  return {
    update(d) {
      const src = [];
      if (d.pollen && !d.pollen.error) {
        src.push(d.pollen.source === 'dwd' ? t('Pollen: DWD · {region}', { region: d.pollen.region }) : t('Pollen: CAMS model'));
      }
      if (d.air && !d.air.error) src.push(t('Air: CAMS / Open-Meteo'));
      const pollen = pollenHtml(d);
      const air = airHtml(d);
      el.innerHTML = `<div class="airpollen">${pollen ? `<div class="ap-section">${pollen}</div>` : ''}${air ? `<div class="ap-section ap-air">${air}</div>` : ''}${src.length ? `<div class="ap-attr">${esc(src.join(' · '))}</div>` : ''}</div>`;
    },
  };
}
