import { icons, bin, plane, weatherInfo, hintIcons } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toFixed(d).replace('.', ','));
const DAY = 86400000;

// ---- time helpers (always in the mirror's configured time zone) -------------
export function makeFmt(general) {
  const tz = general.timezone || 'Europe/Berlin';
  const locale = general.locale || 'de-DE';
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
    f,
    dayKey,
    keyDiff,
    time: (d) => f({ hour: '2-digit', minute: '2-digit' }).format(d),
    hour: (d) => f({ hour: '2-digit', minute: '2-digit' }).format(d),
    // Label for a YYYY-MM-DD key relative to today.
    dayLabel(key, { long = false } = {}) {
      const diff = keyDiff(dayKey(new Date()), key);
      if (diff === 0) return 'Heute';
      if (diff === 1) return 'Morgen';
      if (diff === 2 && locale.startsWith('de')) return 'Übermorgen';
      if (diff === -1) return 'Gestern';
      return fu(long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' }).format(utc(key));
    },
    weekdayShort: (key) => fu({ weekday: 'short' }).format(utc(key)).replace('.', ''),
    dateShort: (key) => fu({ day: 'numeric', month: 'short' }).format(utc(key)),
    // Open-Meteo returns local time strings without offset ("2026-10-24T18:00").
    localHour: (s) => s.slice(11, 16),
  };
}

function countdown(ms) {
  if (ms <= 0) return 'läuft';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  if (d > 0) return `${d} T ${h} Std`;
  if (h > 0) return `${h} Std ${min} Min`;
  return `${min} Min`;
}

// ---- renderers ---------------------------------------------------------------
// Each renderer: (el, mod, ctx) => { update?(data), tick?(), show?(), hide?(), destroy?() }

const clock = (el, mod, ctx) => {
  const s = mod.settings;
  const { f } = ctx.fmt;
  const timeFmt = f({ hour: '2-digit', minute: '2-digit', hour12: !s.format24 });
  const secFmt = f({ second: '2-digit' });
  const dateFmt = f(s.dateStyle === 'full' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { dateStyle: s.dateStyle });
  const partsFmt = f({ year: 'numeric', month: 'numeric', day: 'numeric' });
  el.innerHTML = `<div class="clock size-${s.size}"><div class="clock-time"><span class="hm"></span>${s.showSeconds ? '<span class="sec"></span>' : ''}</div>${s.showDate ? '<div class="clock-date"></div>' : ''}${s.showWeek ? '<div class="clock-week dim"></div>' : ''}</div>`;
  const hm = el.querySelector('.hm');
  const sec = el.querySelector('.sec');
  const date = el.querySelector('.clock-date');
  const week = el.querySelector('.clock-week');
  const isoWeek = (now) => {
    const p = Object.fromEntries(partsFmt.formatToParts(now).map((x) => [x.type, Number(x.value)]));
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow);
    const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - y0) / DAY + 1) / 7);
  };
  const tick = () => {
    const now = new Date();
    hm.textContent = timeFmt.format(now);
    if (sec) sec.textContent = secFmt.format(now).padStart(2, '0');
    if (date) date.textContent = dateFmt.format(now);
    if (week) week.textContent = `Kalenderwoche ${isoWeek(now)}`;
  };
  tick();
  return { tick, tickEvery: 1000 };
};

const weather = (el, mod, ctx) => {
  const s = mod.settings;
  const deg = '°';
  const speed = s.units === 'imperial' ? 'mph' : 'km/h';
  return {
    update(d) {
      const c = d.current;
      const info = weatherInfo(c.code, c.isDay);
      const today = d.daily[0];
      let html = '<div class="weather">';
      if (s.showCurrent) {
        html += `<div class="w-now"><span class="w-icon">${info.icon}</span><span class="w-temp">${num(c.temp)}<sup>${deg}</sup></span></div>
          <div class="w-desc">${esc(info.text)}${d.location ? ` <span class="dim">· ${esc(d.location)}</span>` : ''}</div>`;
        if (s.showDetails) {
          html += `<div class="w-details dim">Gefühlt ${num(c.feels)}${deg} · ${icons.wind} ${num(c.wind)} ${speed} · ${icons.drop} ${num(c.humidity)} %</div>`;
        }
        if (s.showSun && today) {
          html += `<div class="w-sun dim">${icons.sunrise} ${ctx.fmt.localHour(today.sunrise)} &nbsp; ${icons.sunset} ${ctx.fmt.localHour(today.sunset)} &nbsp; ↑${num(today.max)}${deg} ↓${num(today.min)}${deg}</div>`;
        }
      }
      if (s.showHourly) {
        const hours = d.hourly.filter((_, i) => i > 0 && i % s.hourlyStep === 0).slice(0, s.hourlyCount);
        html += `<div class="w-hourly">${hours
          .map((h) => `<div class="w-h"><div class="dim small">${h.time.slice(11, 13)}</div>${weatherInfo(h.code, h.isDay).icon}<div>${num(h.temp)}${deg}</div><div class="w-pop small ${h.pop >= 50 ? 'wet' : 'dim'}">${h.pop >= 10 ? `${h.pop}%` : '&nbsp;'}</div></div>`)
          .join('')}</div>`;
      }
      if (s.forecastDays > 0) {
        const days = d.daily.slice(0, s.forecastDays);
        html += `<table class="w-days">${days
          .map((x, i) => `<tr><td class="w-dn">${i === 0 ? 'Heute' : ctx.fmt.weekdayShort(x.date)}</td><td class="w-di">${weatherInfo(x.code).icon}</td><td class="w-max">${num(x.max)}${deg}</td><td class="w-min dim">${num(x.min)}${deg}</td><td class="w-pp small ${x.pop >= 50 ? 'wet' : 'dim'}">${x.pop >= 10 ? `${icons.drop}${x.pop}%` : ''}</td></tr>`)
          .join('')}</table>`;
      }
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

const calendar = (el, mod, ctx) => {
  const s = mod.settings;
  const evTime = (e) => (e.allDay ? 'ganztägig' : ctx.fmt.time(new Date(e.start)));
  const evDay = (e) => (e.allDay ? e.start : ctx.fmt.dayKey(new Date(e.start)));
  const row = (e, withDay) => {
    const today = ctx.fmt.dayKey(new Date());
    const running = !e.allDay && new Date(e.start) <= new Date() && evDay(e) <= today;
    return `<div class="cal-ev${running ? ' running' : ''}"><span class="dot" style="background:${esc(e.color)}"></span><span class="cal-time ${e.allDay ? 'dim' : ''}">${withDay ? `${esc(ctx.fmt.dayLabel(evDay(e)))} ` : ''}${running ? 'jetzt' : evTime(e)}</span><span class="cal-title">${esc(e.title)}${s.showLocation && e.location ? `<span class="dim small"> · ${esc(e.location)}</span>` : ''}${s.showCalendarName ? `<span class="dim small"> · ${esc(e.calendar)}</span>` : ''}</span></div>`;
  };
  return {
    update(d) {
      if (!d.events.length) {
        el.innerHTML = `<div class="dim">${s.calendars.length ? 'Keine Termine' : 'Kein Kalender eingerichtet'}</div>${d.errors.map((x) => `<div class="err small">${esc(x)}</div>`).join('')}`;
        return;
      }
      let html = '<div class="cal">';
      if (s.groupByDay) {
        const groups = new Map();
        const today = ctx.fmt.dayKey(new Date());
        for (const e of d.events) {
          let k = evDay(e);
          if (k < today) k = today; // multi-day events that started earlier
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k).push(e);
        }
        for (const [k, evs] of groups) html += `<div class="cal-day"><div class="cal-dh">${esc(ctx.fmt.dayLabel(k, { long: true }))}</div>${evs.map((e) => row(e, false)).join('')}</div>`;
      } else {
        html += d.events.map((e) => row(e, true)).join('');
      }
      html += d.errors.map((x) => `<div class="err small">${esc(x)}</div>`).join('');
      el.innerHTML = html + '</div>';
    },
  };
};

const waste = (el, mod, ctx) => {
  const s = mod.settings;
  let last = null;
  const render = () => {
    const d = last;
    if (!d) return;
    if (!d.days.length) {
      el.innerHTML = `<div class="dim">${s.sources.length || s.manual.length ? 'Keine Abholung in Sicht' : 'Kein Müllkalender eingerichtet'}</div>${d.errors.map((x) => `<div class="err small">${esc(x)}</div>`).join('')}`;
      return;
    }
    const now = new Date();
    const today = ctx.fmt.dayKey(now);
    const hour = Number(ctx.fmt.f({ hour: 'numeric', hour12: false }).format(now));
    el.innerHTML = `<div class="waste">${d.days
      .map((day) => {
        const diff = ctx.fmt.keyDiff(today, day.date);
        const remind = (diff === 1 && hour >= s.reminderHour) || (diff === 0 && hour < 10);
        const note = diff === 1 && hour >= s.reminderHour ? 'Heute Abend rausstellen!' : diff === 0 && hour < 10 ? 'Heute ist Abholung!' : '';
        const when = diff > 2 ? `${ctx.fmt.weekdayShort(day.date)}, ${ctx.fmt.dateShort(day.date)} <span class="dim small">in ${diff} Tagen</span>` : esc(ctx.fmt.dayLabel(day.date));
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
      el.innerHTML = '<div class="dim">Saisonpause – der Rennkalender ist noch nicht veröffentlicht.</div>';
      return;
    }
    const now = Date.now();
    const next = d.nextSession;
    const ms = new Date(next.start) - now;
    const live = ms <= 0 && ms > -2 * 3600 * 1000;
    const wd = ctx.fmt.f({ weekday: 'short' });
    let html = `<div class="f1">
      <div class="f1-meta dim small">Runde ${d.round}${d.totalRounds ? ` / ${d.totalRounds}` : ''} · Saison ${d.season}${d.isSprint ? ' · <span class="accent">Sprint-Wochenende</span>' : ''}</div>
      <div class="f1-name">${esc(d.raceName)}</div>
      <div class="f1-circuit dim">${icons.pin} ${esc(d.circuit)} · ${esc(d.locality)}, ${esc(d.country)}</div>`;
    if (s.showCountdown) {
      html += `<div class="f1-countdown${live ? ' live' : ''}"><span class="f1-cd-label">${esc(next.label)}</span><span class="f1-cd-value">${live ? '● LIVE' : `in ${countdown(ms)}`}</span></div>`;
    }
    if (s.showSessions) {
      html += `<table class="f1-sessions">${d.sessions
        .map((x) => {
          const t = new Date(x.start);
          const past = t.getTime() + 2 * 3600 * 1000 < now;
          const cls = x.key === next.key ? 'next' : past ? 'past' : '';
          return `<tr class="${cls}"><td>${esc(x.label)}</td><td class="r">${wd.format(t).replace('.', '')}</td><td class="r">${ctx.fmt.time(t)}</td></tr>`;
        })
        .join('')}</table>`;
    }
    const facts = [];
    if (d.trackWeather) {
      const w = d.trackWeather;
      facts.push(`<span>${weatherInfo(w.code).icon} Renntag ${num(w.max)}° · ${icons.drop}${num(w.pop)} %</span>`);
    }
    if (d.previousWinner) facts.push(`<span>${icons.trophy} ${d.previousWinner.season}: ${esc(d.previousWinner.name)}</span>`);
    if (facts.length) html += `<div class="f1-facts small">${facts.join('')}</div>`;
    if (d.lastRace) {
      html += `<div class="f1-sub dim small">Letztes Rennen · ${esc(d.lastRace.name)}</div><div class="f1-podium">${d.lastRace.podium
        .map((p) => `<span class="p${p.pos}"><b>P${p.pos}</b> ${esc(p.code || p.name)}</span>`)
        .join('')}</div>`;
    }
    if (d.driverStandings?.length) {
      html += `<div class="f1-sub dim small">Fahrer-WM</div><table class="f1-standings">${d.driverStandings
        .map((x) => `<tr class="${fav.includes(x.code) ? 'fav' : ''}"><td class="r dim">${x.pos}</td><td><span class="team" style="background:${teamColor(x.team)}"></span>${esc(x.name)}</td><td class="r">${x.points}</td></tr>`)
        .join('')}</table>`;
    }
    if (d.constructorStandings?.length) {
      html += `<div class="f1-sub dim small">Konstrukteurs-WM</div><table class="f1-standings">${d.constructorStandings
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
      el.innerHTML = '<div class="dim">Bitte im Admin-Panel eine Haltestelle wählen.</div>';
      return;
    }
    const now = Date.now();
    const rows = d.departures
      .filter((x) => new Date(x.realtime || x.planned).getTime() > now - 60000)
      .map((x) => {
        const planned = new Date(x.planned);
        const when = new Date(x.realtime || x.planned);
        const mins = Math.round((when - now) / 60000);
        const delay = x.realtime ? Math.round((when - planned) / 60000) : null;
        const rel = mins <= 0 ? 'jetzt' : `${mins} Min`;
        const abs = ctx.fmt.time(planned);
        const time = s.timeMode === 'absolute' ? abs : s.timeMode === 'both' ? `${rel} <span class="dim small">${abs}</span>` : rel;
        const delayHtml = s.showDelay && delay !== null ? `<span class="delay ${delay > 0 ? 'late' : 'ontime'}">${delay > 0 ? `+${delay}` : '±0'}</span>` : '';
        return `<tr class="${x.cancelled ? 'cancelled' : ''}${mins <= 1 ? ' imminent' : ''}"><td><span class="line cat-${x.category}">${esc(x.line)}</span></td><td class="dest">${esc(x.destination)}</td>${s.showPlatform ? `<td class="plat dim small">${esc(x.platform.replace(/^(Gleis|Bstg\.?|Steig|Bussteig)\s*/i, ''))}</td>` : ''}<td class="r tm">${x.cancelled ? '<span class="late">fällt aus</span>' : `${time}${delayHtml}`}</td></tr>`;
      });
    el.innerHTML = `<div class="transit">${d.stop ? `<div class="dim small tr-stop">${esc(d.stop)}</div>` : ''}${rows.length ? `<table>${rows.join('')}</table>` : '<div class="dim">Keine Abfahrten</div>'}</div>`;
  };
  return { update(d) { last = d; render(); }, tick: render, tickEvery: 15000 };
};

let leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = reject;
    document.head.append(js);
  });
  return leafletPromise;
}

function altColor(a) {
  if (a.ground || a.alt === null) return '#9ca3af';
  if (a.alt < 3000) return '#fb923c';
  if (a.alt < 10000) return '#facc15';
  if (a.alt < 25000) return '#4ade80';
  if (a.alt < 35000) return '#38bdf8';
  return '#c084fc';
}
const fmtAlt = (a) => (a.ground ? 'am Boden' : a.alt === null ? '–' : `${Math.round(a.alt).toLocaleString('de-DE')} ft`);

const TILES = {
  esri_dark: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri, HERE, Garmin, © OpenStreetMap', className: 'tiles-dim' },
  osm_dark: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', className: 'tiles-dark' },
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
};

const flights = (el, mod, ctx, region) => {
  const s = mod.settings;
  const full = region === 'fullscreen';
  el.innerHTML = `<div class="flights${full ? ' full' : ''}"><div class="fl-map" style="${full ? '' : `height:${s.height}vh`}"></div>${s.showList ? '<div class="fl-list"></div>' : ''}</div>`;
  const mapEl = el.querySelector('.fl-map');
  const listEl = el.querySelector('.fl-list');
  let map = null;
  let layer = null;
  const markers = new Map();
  let pending = null;

  loadLeaflet().then((L) => {
    const c = pending?.center || ctx.general.location;
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
    map.setView([c.lat, c.lon], s.zoom);
    const tiles = TILES[s.tiles] || { url: s.tileUrl, attribution: '' };
    if (tiles.url) L.tileLayer(tiles.url, { maxZoom: 18, attribution: tiles.attribution, className: tiles.className || '' }).addTo(map);
    if (s.showRings) {
      for (const f of [1 / 3, 2 / 3, 1]) L.circle([c.lat, c.lon], { radius: s.radiusKm * f * 1000, color: '#ffffff', opacity: 0.18, weight: 1, fill: false, interactive: false }).addTo(map);
    }
    L.circleMarker([c.lat, c.lon], { radius: 4, color: '#fff', weight: 2, fillColor: ctx.general.accentColor, fillOpacity: 1 }).addTo(map);
    layer = L.layerGroup().addTo(map);
    if (pending) draw(pending);
  });

  function draw(d) {
    const L = window.L;
    const seen = new Set();
    for (const a of d.aircraft) {
      seen.add(a.hex);
      const html = `<div class="ac-icon">${plane(altColor(a), a.track ?? 0)}</div>${s.showLabels ? `<div class="ac-label">${esc(a.flight)}<br><span>${a.ground ? 'GND' : a.alt !== null ? `${Math.round(a.alt / 100)}` : ''}</span></div>` : ''}`;
      const icon = L.divIcon({ className: 'ac', html, iconSize: [22, 22], iconAnchor: [11, 11] });
      if (markers.has(a.hex)) markers.get(a.hex).setLatLng([a.lat, a.lon]).setIcon(icon);
      else markers.set(a.hex, L.marker([a.lat, a.lon], { icon, interactive: false, keyboard: false }).addTo(layer));
    }
    for (const [hex, m] of markers) {
      if (!seen.has(hex)) {
        layer.removeLayer(m);
        markers.delete(hex);
      }
    }
  }

  return {
    update(d) {
      pending = d;
      if (map) draw(d);
      if (listEl) {
        const list = d.aircraft.filter((a) => !a.ground).slice(0, s.listCount);
        listEl.innerHTML = list.length
          ? `<table>${list
              .map((a) => `<tr><td><span class="ac-dot" style="background:${altColor(a)}"></span>${esc(a.flight)}</td><td class="dim small">${esc(a.type)}</td><td class="r">${fmtAlt(a)}</td><td class="r dim small">${a.speed ?? '–'} km/h</td><td class="r dim small">${num(a.dist, 1)} km</td></tr>`)
              .join('')}</table>`
          : '<div class="dim small">Gerade keine Flugzeuge in der Luft</div>';
        listEl.insertAdjacentHTML('afterbegin', `<div class="dim small fl-count">${d.aircraft.length} Flugzeuge im Umkreis von ${s.radiusKm} km · Quelle: ${d.source === 'local' ? 'eigener Empfänger' : d.source === 'airplaneslive' ? 'airplanes.live' : 'adsb.lol'}</div>`);
      }
    },
    show() {
      if (map) setTimeout(() => map.invalidateSize(), 50);
    },
    destroy() {
      if (map) map.remove();
    },
  };
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
      el.innerHTML = '<div class="dim">Keine Kamera eingerichtet</div>';
      return;
    }
    el.innerHTML = `<div class="cams" style="grid-template-columns:repeat(${s.columns},1fr);width:${s.width}%">${streams
      .map((c) => `<div class="cam"><div class="cam-off dim small">${icons.camera} Kamera nicht erreichbar</div>${s.mode === 'snapshot' ? `<img class="cam-img" data-src="${esc(c.src)}" alt="">` : `<div class="cam-live" data-src="${esc(c.src)}"></div>`}${s.showName ? `<div class="cam-name">${esc(c.name)}</div>` : ''}</div>`)
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

export const renderers = { clock, weather, weather_hints, calendar, waste, f1, transit, flights, camera, greeting, text };
