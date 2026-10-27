// Calendar renderer – agenda list, week columns or month grid. Overrides the
// core `calendar` renderer. Ticks every 30 s locally (progress bars, relative
// times, ended events) without refetching.
import { esc } from '../renderers.js';
import { calIcons } from '../icons.js';
import { eventSpan, dayOfSpan, groupByDay, eventsOnDay, addDays } from '/shared/calendar-days.js';
import { loadLeaflet, TILES } from '../flights.js';

const FADE = { subtle: { start: 0.5, min: 0.45 }, strong: { start: 0.25, min: 0.15 } };
const MAX_CHIPS = 6;
const MAX_DOTS = 4;
const WARN_MS = 5 * 60000; // countdown turns amber this long before leaving
const ico = (body) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const MODE_ICONS = {
  bike: ico('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5L9 9h7l2.5 7.5M9 9l3.5 7.5L16 9M8 6.5h3"/>'),
  foot: ico('<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2.2-6-2.7-2.7.8-4.3 3.2 1.8 2.5 2.7M9.7 8.2L6.8 10l-.8 3.2M12.2 15l2.3 2 1 4"/>'),
};
const TRANSIT_ICON = ico('<rect x="5" y="3.5" width="14" height="13" rx="3"/><path d="M5 11h14M9 20.5l1.5-4M15 20.5l-1.5-4M8.5 14h.01M15.5 14h.01M9 1.5h6"/>');

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  const dk = (d) => ctx.fmt.dayKey(d);
  const rules = (s.iconRules || [])
    .map((r) => ({ icon: r.icon, keys: r.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) }))
    .filter((r) => r.keys.length);
  let last = null;
  let lastHtml = '';

  const span = (e) => eventSpan(e, dk);
  const iconFor = (e) => {
    if (e.kind) return e.icon || 'flag';
    if (e.birthday) return 'cake';
    const title = e.title.toLowerCase();
    return rules.find((r) => r.keys.some((k) => title.includes(k)))?.icon || e.icon || 'calendar';
  };
  const marker = (e) => {
    const color = esc(e.color);
    if (s.style === 'dot') return `<span class="cal-mark dot" style="background:${color}"></span>`;
    const svg = calIcons[iconFor(e)] || calIcons.calendar;
    if (s.style === 'badge') return `<span class="cal-mark badge" style="--c:${color}">${svg}</span>`;
    return `<span class="cal-mark icon" style="color:${color}">${svg}</span>`;
  };
  const titleOf = (e) => (e.birthday ? t('{name} turns {n}', { name: e.title, n: e.birthday.age }) : e.title);

  const duration = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 60) return t('{m} min', { m });
    const h = Math.floor(m / 60);
    return m % 60 ? t('{h} h {m} min', { h, m: m % 60 }) : t('{h} h', { h });
  };
  const relative = (ms) => {
    const m = Math.max(1, Math.round(ms / 60000));
    return m < 60 ? t('in {m} min', { m }) : t('in {h} h', { h: Math.round(m / 60) });
  };
  const isRunning = (e, now) => !e.allDay && new Date(e.start) <= now && new Date(e.end || e.start) > now;
  const ended = (e, now, today) => (e.allDay ? span(e).last < today : new Date(e.end || e.start) <= now);

  // Time column text of a not-running timed event.
  const timeText = (e, now, today) => {
    const start = new Date(e.start);
    const end = e.end ? new Date(e.end) : null;
    if (s.relativeToday && dk(start) === today && start > now) return relative(start - now);
    let txt = ctx.fmt.time(start);
    if (end && end > start && s.timeFormat === 'startEnd') {
      const endDay = dk(new Date(end - 1));
      txt += `–${endDay !== dk(start) ? `${ctx.fmt.weekdayShort(endDay)} ` : ''}${ctx.fmt.time(end)}`;
    } else if (end && end > start && s.timeFormat === 'duration') {
      txt += ` · ${duration(end - start)}`;
    }
    return txt;
  };

  const fadeOf = (i, n) => {
    const f = FADE[s.fade];
    if (!f || n < 3) return 1;
    const from = Math.floor(n * f.start);
    if (i < from) return 1;
    return Math.max(f.min, 1 - ((1 - f.min) * (i - from + 1)) / (n - from));
  };

  // One agenda row. `day` = day the row is shown under (for "Day x of y").
  const row = (e, { withDay, day, now, today, nextEv, opacity }) => {
    const running = isRunning(e, now);
    const startMs = new Date(e.start) - now;
    const soon = !e.allDay && !running && s.soonMinutes > 0 && startMs > 0 && startMs <= s.soonMinutes * 60000;
    const cls = `cal-ev style-${s.style}${running ? ' running' : ''}${soon ? ' soon' : ''}${e.kind ? ` kind-${e.kind}` : ''}`;
    const style = `--c:${esc(e.color)}${opacity < 1 ? `;opacity:${opacity.toFixed(2)}` : ''}`;
    const time = e.allDay ? t('all day') : running ? t('now') : timeText(e, now, today);
    const dayPart = withDay ? `${esc(ctx.fmt.dayLabel(span(e).first < today ? today : span(e).first))} ` : '';
    const multi = s.multiDayLabel ? dayOfSpan(e, day, dk) : null;
    const extras = [
      s.showLocation && e.location ? e.location : '',
      s.showCalendarName && e.calendar ? e.calendar : '',
      multi ? t('Day {x} of {y}', { x: multi.day, y: multi.days }) : '',
    ].filter(Boolean).map((x) => `<span class="dim small"> · ${esc(x)}</span>`).join('');
    const next = e === nextEv ? `<span class="cal-next">${esc(relative(startMs))}</span>` : '';
    let prog = '';
    if (running && s.showProgress && e.end) {
      const total = new Date(e.end) - new Date(e.start);
      const pct = total > 0 ? Math.min(100, Math.max(0, ((now - new Date(e.start)) / total) * 100)) : 0;
      prog = `<span class="cal-prog"><i style="width:${pct.toFixed(1)}%"></i></span>`;
    }
    return `<div class="${cls}" style="${style}">${marker(e)}<span class="cal-time${e.allDay ? ' dim' : ''}">${dayPart}${esc(time)}</span><span class="cal-title"${s.colorTitle ? ` style="color:${esc(e.color)}"` : ''}>${esc(titleOf(e))}${extras}</span>${next}${prog}</div>`;
  };

  const agendaHtml = (events, now, today) => {
    // The next timed event today that has not started yet.
    const nextEv = s.showNext && !s.relativeToday
      ? events.find((e) => !e.allDay && new Date(e.start) > now && dk(new Date(e.start)) === today)
      : null;
    const n = events.length;
    let i = 0;
    const opts = (e, extra) => ({ now, today, nextEv, opacity: fadeOf(i++, n), ...extra });
    if (s.groupByDay) {
      let html = '';
      for (const [k, evs] of groupByDay(events, today, dk)) {
        html += `<div class="cal-day"><div class="cal-dh">${esc(ctx.fmt.dayLabel(k, { long: true }))}</div>${evs.map((e) => row(e, opts(e, { withDay: false, day: k }))).join('')}</div>`;
      }
      return html;
    }
    return events.map((e) => row(e, opts(e, { withDay: true, day: span(e).first < today ? today : span(e).first }))).join('');
  };

  const sortDay = (a, b) => Number(b.allDay) - Number(a.allDay) || (a.allDay ? 0 : a.start.localeCompare(b.start));

  const weekHtml = (g, now, today) => {
    let html = '';
    for (let i = 0; i < 7; i++) {
      const day = addDays(g.from, i);
      const evs = eventsOnDay(g.events, day, dk).sort(sortDay);
      const chips = evs.slice(0, MAX_CHIPS).map((e) => {
        const running = isRunning(e, now);
        const past = ended(e, now, today);
        const startsHere = e.allDay || dk(new Date(e.start)) === day;
        const time = e.allDay ? '' : `<span class="cw-t">${esc(running ? t('now') : startsHere ? ctx.fmt.time(new Date(e.start)) : '…')}</span>`;
        return `<div class="cw-chip${e.allDay ? ' ad' : ''}${running ? ' running' : ''}${past && day === today ? ' done' : ''}" style="--c:${esc(e.color)}">${time}<span class="cw-x">${esc(titleOf(e))}</span></div>`;
      }).join('');
      const more = evs.length > MAX_CHIPS ? `<div class="cw-more">${esc(t('+ {n} more', { n: evs.length - MAX_CHIPS }))}</div>` : '';
      const cls = `cw-col${day === today ? ' today' : ''}${day < today ? ' past' : ''}`;
      html += `<div class="${cls}"><div class="cw-h">${esc(ctx.fmt.weekdayShort(day))}<b>${Number(day.slice(8))}</b></div>${chips}${more}</div>`;
    }
    return `<div class="cw">${html}</div>`;
  };

  const monthHtml = (g, today) => {
    const head = Array.from({ length: 7 }, (_, i) => `<div class="cm-wd">${esc(ctx.fmt.weekdayShort(addDays(g.from, i)))}</div>`).join('');
    let cells = '';
    for (let day = g.from; day <= g.to; day = addDays(day, 1)) {
      const evs = eventsOnDay(g.events, day, dk);
      const colors = [...new Set(evs.map((e) => e.color))].slice(0, MAX_DOTS);
      const holiday = evs.find((e) => e.kind === 'holiday');
      const cls = `cm-d${day.slice(0, 7) !== g.month ? ' out' : ''}${day === today ? ' today' : ''}${day < today ? ' past' : ''}`;
      cells += `<div class="${cls}"><span class="cm-n"${holiday ? ` style="color:${esc(holiday.color)}"` : ''}>${Number(day.slice(8))}</span><span class="cm-dots">${colors.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></div>`;
    }
    const title = ctx.fmt.f({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${g.month}-15T12:00:00Z`));
    return `<div class="cm-wrap"><div class="cm-title">${esc(title)}</div><div class="cm">${head}${cells}</div></div>`;
  };

  const legend = () => {
    if (!s.showLegend) return '';
    const items = s.calendars.filter((c) => c.enabled).map((c) => ({ name: c.name, color: c.color, icon: c.icon }));
    if (s.showPublicHolidays) items.push({ name: t('Public holidays'), color: s.publicHolidayColor, icon: s.publicHolidayIcon });
    if (s.showSchoolHolidays && s.holidayState) items.push({ name: t('School holidays'), color: s.schoolHolidayColor, icon: s.schoolHolidayIcon });
    if (items.length < 2) return '';
    return `<div class="cal-legend small">${items
      .map((c) => `<span class="cal-leg">${s.style === 'dot' ? `<span class="cal-mark dot" style="background:${esc(c.color)}"></span>` : `<span class="cal-mark icon" style="color:${esc(c.color)}">${calIcons[c.icon] || calIcons.calendar}</span>`}${esc(c.name)}</span>`)
      .join('')}</div>`;
  };

  // ---- "time to leave" card: text redrawn on every tick, the map only when the route changes.
  // Compact on purpose: a small map beside the text, so the next events stay visible below.
  let shell = null; // { slot, main }
  let tv = null; // { id, card, info, mapEl, map, routeKey, obs }
  const pointsOf = (x) => (x.legs ? x.legs.flatMap((l) => l.coords || []) : x.geometry || []);
  const routeKey = (x) => {
    const pts = pointsOf(x);
    return `${x.mode}|${x.leaveAt}|${pts.length}|${pts[0]}|${pts.at(-1)}|${x.to.lat},${x.to.lon}`;
  };

  const countdown = (x, now, nowText) => {
    const ms = new Date(x.leaveAt) - now;
    const state = ms <= 0 ? 'late' : ms <= WARN_MS ? 'warn' : '';
    return `<span class="cal-tv-cd${state ? ` ${state}` : ''}">${esc(ms <= 0 ? nowText : relative(ms))}</span>`;
  };
  const head = (icon, text, cd, extra = '') => `<div class="cal-tv-head"><span class="cal-tv-ico">${icon}</span><span class="cal-tv-leave">${esc(text)}</span>${extra}${cd}</div>`;
  // One-line card ("mini"): the first ride next to the leave time.
  const firstRide = (x) => {
    const l = x.legs.find((y) => !y.walk);
    return l ? `<span class="cal-tv-first"><span class="line cat-${esc(l.category)}">${esc(l.line)}</span>${esc(l.from.name)} ${esc(ctx.fmt.time(new Date(l.from.time)))}</span>` : '';
  };
  // "{duration} … to <b>title</b>" with the title bold.
  const toTitle = (text, title) => {
    const [pre, post] = esc(text).split('\u0000');
    return `${pre}<b>${esc(title)}</b>${post || ''}`;
  };

  const legsHtml = (x) => x.legs.map((l) => {
    if (l.walk) return `<div class="tvl walk">${MODE_ICONS.foot}<span>${esc(t('{m} min', { m: l.min }))}</span></div>`;
    const late = (d) => (d > 0 ? `<span class="tvl-late">+${d}</span>` : '');
    // one row per leg: [line] 17:53 Hauptbahnhof → 18:05 Angerbrücke
    return `<div class="tvl ride"><span class="line cat-${esc(l.category)}">${esc(l.line)}</span>`
      + `<span class="tvl-stop"><b>${esc(ctx.fmt.time(new Date(l.from.time)))}</b>${late(l.from.delay)} ${esc(l.from.name)}</span>`
      + `<span class="tvl-arr">→</span><span class="tvl-stop">${esc(ctx.fmt.time(new Date(l.to.time)))} ${esc(l.to.name)}</span></div>`;
  }).join('');

  const travelInfo = (x, now) => {
    const leave = new Date(x.leaveAt);
    const note = [t('Starts {time}', { time: ctx.fmt.time(new Date(x.start)) }), x.location];
    if (x.mode === 'transit') {
      const changes = x.interchanges > 0 ? t('{n}× change', { n: x.interchanges }) : t('no change');
      const sub = t('{duration} to {place}', { duration: duration(x.durationMin * 60000), place: '\u0000' });
      return head(TRANSIT_ICON, t('Leave by {time}', { time: ctx.fmt.time(leave) }), countdown(x, now, t('Go now!')), firstRide(x))
        + `<div class="cal-tv-sub">${toTitle(sub, x.title)}<span class="dim"> · ${esc(changes)}</span></div>`
        + `<div class="cal-tv-legs">${legsHtml(x)}</div>`
        + `<div class="cal-tv-note">${note.map(esc).join(' · ')}</div>`;
    }
    const foot = x.mode === 'foot';
    const km = x.distanceKm.toLocaleString(ctx.fmt.locale, { maximumFractionDigits: x.distanceKm < 10 ? 1 : 0 });
    const sub = t('{duration} ({km} km) to {place}', { duration: duration(x.durationMin * 60000), km, place: '\u0000' });
    if (x.mode === 'car') note.push(t('without live traffic'));
    return head(x.mode === 'car' ? calIcons.car : MODE_ICONS[x.mode] || calIcons.car, t(foot ? 'Start walking at {time}' : 'Leave at {time}', { time: ctx.fmt.time(leave) }), countdown(x, now, t(foot ? 'Leave now on foot!' : 'Leave now!')))
      + `<div class="cal-tv-sub">${toTitle(sub, x.title)}</div>`
      + `<div class="cal-tv-note">${note.filter(Boolean).map(esc).join(' · ')}</div>`;
  };

  const fitRoute = () => {
    if (!tv?.map || !tv.mapEl.offsetWidth || !tv.mapEl.offsetHeight) return;
    tv.map.invalidateSize({ pan: false, animate: false });
    const L = window.L;
    const x = last.travel;
    const bounds = L.latLngBounds([[x.from.lat, x.from.lon], [x.to.lat, x.to.lon], ...pointsOf(x)]);
    tv.map.fitBounds(bounds, { padding: [10, 10], maxZoom: 16, animate: false });
  };

  const drawRoute = () => {
    const L = window.L;
    const x = last?.travel;
    if (!tv || !tv.mapEl || !L || !x) return;
    if (!tv.map) {
      if (!tv.mapEl.offsetWidth) return; // hidden page: try again on show()/tick
      tv.map = L.map(tv.mapEl, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false });
      tv.map.attributionControl.setPrefix('');
      const tiles = TILES.esri_dark;
      L.tileLayer(tiles.url, { maxZoom: 18, attribution: `${tiles.attribution}${x.legs ? '' : ' · OSRM'}`, className: tiles.className }).addTo(tv.map);
      tv.layer = L.layerGroup().addTo(tv.map);
      if (window.ResizeObserver) {
        let timer = 0;
        tv.obs = new ResizeObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(fitRoute, 80);
        });
        tv.obs.observe(tv.mapEl);
      }
    }
    const key = routeKey(x);
    if (key === tv.routeKey) return;
    tv.routeKey = key;
    const accent = ctx.general.accentColor || '#7dd3fc';
    const line = (pts, color, opts = {}) => {
      if (pts.length < 2) return;
      if (!opts.dashArray) L.polyline(pts, { color: '#000', weight: 6, opacity: 0.55, interactive: false }).addTo(tv.layer);
      L.polyline(pts, { color, weight: 3.5, opacity: 0.95, interactive: false, ...opts }).addTo(tv.layer);
    };
    tv.layer.clearLayers();
    if (x.legs) {
      for (const l of x.legs) line(l.coords || [], l.walk ? '#9ca3af' : accent, l.walk ? { weight: 2.5, dashArray: '3 5' } : {});
      for (const l of x.legs) {
        if (l.walk || !l.coords?.length) continue;
        for (const p of [l.coords[0], l.coords.at(-1)]) L.circleMarker(p, { radius: 3.5, color: '#000', weight: 1.5, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(tv.layer);
      }
    } else {
      line(x.geometry, accent);
    }
    L.circleMarker([x.from.lat, x.from.lon], { radius: 4.5, color: '#fff', weight: 2, fillColor: accent, fillOpacity: 1, interactive: false }).addTo(tv.layer);
    L.circleMarker([x.to.lat, x.to.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#f87171', fillOpacity: 1, interactive: false }).addTo(tv.layer);
    fitRoute();
  };

  const closeTravel = () => {
    if (!tv) return;
    tv.obs?.disconnect();
    tv.map?.remove();
    tv.card.remove();
    tv = null;
  };

  const drawTravel = (now) => {
    const x = s.travelCard ? last?.travel : null;
    const visible = x && now >= new Date(x.leaveAt).getTime() - x.lead * 60000 && now < new Date(x.start);
    if (!visible) return closeTravel();
    const id = `${x.start}|${x.location}`;
    if (tv && tv.id !== id) closeTravel();
    if (!tv) {
      const card = document.createElement('div');
      const withMap = s.travelMap !== false;
      card.className = `cal-tv${withMap ? ' with-map' : ''}`;
      const max = Number(s.travelMapHeight) > 0 ? ` style="max-height:${Number(s.travelMapHeight)}vh;min-height:min(5.5em,${Number(s.travelMapHeight)}vh)"` : '';
      card.innerHTML = `<div class="cal-tv-info"></div>${withMap ? `<div class="cal-tv-map"${max}></div>` : ''}`;
      shell.slot.append(card);
      tv = { id, card, info: card.querySelector('.cal-tv-info'), mapEl: card.querySelector('.cal-tv-map'), map: null, routeKey: '' };
      if (withMap) loadLeaflet().then(drawRoute).catch(() => {});
    }
    tv.card.classList.toggle('transit', x.mode === 'transit');
    const html = travelInfo(x, now);
    if (html !== tv.infoHtml) tv.info.innerHTML = tv.infoHtml = html;
    if (window.L && tv.mapEl) drawRoute();
  };

  // Keeps the next events visible: if the card would push the 3rd event out of the region,
  // it drops the note line and the map ("tight" – all legs stay), then the walks and the
  // duration line ("tiny"), then shrinks to one line ("mini").
  const FIT = ['tight', 'tiny', 'mini'];
  const fitCard = () => {
    const region = el.closest('.region');
    if (!tv || !region || !el.offsetHeight) return;
    const before = FIT.find((c) => tv.card.classList.contains(c)) || '';
    tv.card.classList.remove(...FIT);
    const rows = shell.main.querySelectorAll('.cal-ev, .cw, .cm-wrap');
    const target = rows[Math.min(3, rows.length) - 1] || tv.card;
    const bottom = region.getBoundingClientRect().bottom;
    let state = '';
    for (const cls of FIT) {
      if (target.getBoundingClientRect().bottom <= bottom + 1) break;
      tv.card.classList.add(cls);
      state = cls;
    }
    if (state !== before && tv.map) setTimeout(fitRoute, 0);
  };

  const draw = () => {
    const d = last;
    if (!d) return;
    if (!shell) {
      el.innerHTML = '<div class="cal-tv-slot"></div><div class="cal-main"></div>';
      shell = { slot: el.firstChild, main: el.lastChild };
    }
    const now = new Date();
    drawTravel(now);
    const today = dk(now);
    const events = d.events.filter((e) => !ended(e, now, today));
    const errors = d.errors.map((x) => `<div class="err small">${esc(x)}</div>`).join('');
    const g = d.grid && (s.view === 'week' || s.view === 'month') ? d.grid : null;
    let html;
    if (!g && !events.length) {
      const empty = s.calendars.length || s.showPublicHolidays || s.showSchoolHolidays ? t('No events') : t('No calendar set up');
      html = `<div class="dim">${esc(empty)}</div>${errors}`;
    } else {
      html = `<div class="cal lines-${esc(s.titleLines)} view-${g ? esc(s.view) : 'list'}">${legend()}`;
      if (g && s.view === 'week') html += weekHtml(g, now, today);
      else if (g) html += monthHtml(g, today) + (s.monthAgenda && events.length ? `<div class="cal-agenda">${agendaHtml(events, now, today)}</div>` : '');
      else html += agendaHtml(events, now, today);
      html += `${errors}</div>`;
    }
    if (html !== lastHtml) shell.main.innerHTML = lastHtml = html;
    fitCard();
  };

  return {
    update(data) {
      last = data;
      draw();
    },
    tick: draw,
    tickEvery: 30000,
    show() {
      if (tv) setTimeout(() => {
        fitCard();
        if (!tv?.mapEl) return;
        if (tv.map) fitRoute();
        else drawRoute();
      }, 50);
    },
    destroy: closeTravel,
  };
}
