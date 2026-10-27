// Calendar renderer – agenda list, week columns or month grid. Overrides the
// core `calendar` renderer. Ticks every 30 s locally (progress bars, relative
// times, ended events) without refetching.
import { esc } from '../renderers.js';
import { calIcons } from '../icons.js';
import { eventSpan, dayOfSpan, groupByDay, eventsOnDay, addDays } from '/shared/calendar-days.js';

const FADE = { subtle: { start: 0.5, min: 0.45 }, strong: { start: 0.25, min: 0.15 } };
const MAX_CHIPS = 6;
const MAX_DOTS = 4;

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

  const draw = () => {
    const d = last;
    if (!d) return;
    const now = new Date();
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
    if (html !== lastHtml) el.innerHTML = lastHtml = html;
  };

  return {
    update(data) {
      last = data;
      draw();
    },
    tick: draw,
    tickEvery: 30000,
  };
}
