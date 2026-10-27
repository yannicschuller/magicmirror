// Football renderer: matchday results/fixtures with live scores, league table,
// upcoming matches and an "only my team" card.
import { esc } from '../renderers.js';

// Pick which matches to show when there are more than `max` (cup rounds):
// live games and the favorite first, then the ones closest to now.
export function selectMatches(matches, max, now = Date.now()) {
  if (matches.length <= max) return matches;
  const score = (m) => (m.state === 'live' ? -2 : m.home.fav || m.away.fav ? -1 : 0);
  const dist = (m) => Math.abs(Date.parse(m.start) - now) || 0;
  const keep = new Set(matches.slice().sort((a, b) => score(a) - score(b) || dist(a) - dist(b)).slice(0, max));
  return matches.filter((m) => keep.has(m));
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  let data = null;

  const logo = (team) =>
    s.showLogos && team.icon
      ? `<img class="fb-logo${s.grayscaleLogos ? ' gray' : ''}" src="${esc(team.icon)}" alt="" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`
      : '';
  const name = (team) => `<span class="fb-name">${esc(team.short || team.name)}</span>`;
  const dateLabel = (iso) => ctx.fmt.dayLabel(ctx.fmt.dayKey(new Date(iso)));
  const extra = (m) => (m.pens ? ` <span class="fb-x">${t('pen.')} ${m.pens[0]}:${m.pens[1]}</span>` : m.aet ? ` <span class="fb-x">${t('a.e.t.')}</span>` : '');

  // Middle column: score (finished/live) or kick-off time.
  const centre = (m) => {
    if (m.state === 'live') return `<span class="fb-score live">${m.score[0]}:${m.score[1]}</span>`;
    if (m.score) return `<span class="fb-score">${m.score[0]}:${m.score[1]}</span>`;
    return `<span class="fb-time dim">${ctx.fmt.time(new Date(m.start))}</span>`;
  };
  const row = (m) => {
    const cls = [m.state, m.home.fav || m.away.fav ? 'fav' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}">
      <td class="r fb-home${m.home.fav ? ' me' : ''}">${name(m.home)}${logo(m.home)}</td>
      <td class="fb-mid">${centre(m)}</td>
      <td class="fb-away${m.away.fav ? ' me' : ''}">${logo(m.away)}${name(m.away)}${extra(m)}</td>
    </tr>`;
  };
  // Rows grouped by day, with a small day header whenever the date changes.
  const matchRows = (list) => {
    let lastDay = null;
    return list
      .map((m) => {
        const day = m.start ? ctx.fmt.dayKey(new Date(m.start)) : '';
        const head = day !== lastDay ? `<tr class="fb-day"><td colspan="3">${esc(day ? ctx.fmt.dayLabel(day) : '')}</td></tr>` : '';
        lastDay = day;
        return head + row(m);
      })
      .join('');
  };
  const sub = (text, live = false) => `<div class="fb-sub dim small">${esc(text)}${live ? ` <span class="fb-live-dot">● ${t('LIVE')}</span>` : ''}</div>`;

  const tableHtml = (tbl) =>
    `<table class="fb-table">${tbl.rows
      .map(
        (r) => `${r.gap ? '<tr class="fb-gap"><td colspan="5">⋯</td></tr>' : ''}<tr class="${r.fav ? 'fav' : ''}">
          <td class="r dim">${r.pos}</td>
          <td>${logo(r)}${name(r)}</td>
          <td class="r dim small">${r.played}</td>
          <td class="r dim small">${r.diff > 0 ? '+' : ''}${r.diff}</td>
          <td class="r fb-pts">${r.points}</td>
        </tr>`,
      )
      .join('')}</table>`;

  const teamCard = (d) => {
    const tm = d.team;
    const f = d.favorite;
    const facts = [];
    if (tm.position) facts.push(t('Position {n}', { n: tm.position }));
    if (tm.points !== null && tm.points !== undefined) facts.push(t('{n} pts', { n: tm.points }));
    if (tm.played) facts.push(t('{n} games', { n: tm.played }));
    let html = `<div class="fb-team"><div class="fb-team-name">${logo(f)}${esc(f.name)}</div>`;
    if (facts.length) html += `<div class="fb-team-facts dim">${facts.join(' · ')}</div>`;
    html += '</div>';
    if (tm.live) html += sub(t('Now'), true) + `<table class="fb-matches">${row(tm.live)}</table>`;
    if (tm.last) html += sub(`${t('Last match')} · ${dateLabel(tm.last.start)}`) + `<table class="fb-matches">${row(tm.last)}</table>`;
    if (tm.next.length) {
      html += sub(tm.next.length > 1 ? t('Upcoming matches') : t('Next match')) + `<table class="fb-matches">${matchRows(tm.next)}</table>`;
    } else if (!tm.live) html += `<div class="dim small">${t('No upcoming matches')}</div>`;
    return html;
  };

  const draw = () => {
    const d = data;
    if (!d) return;
    if (d.needsSetup) {
      el.innerHTML = `<div class="dim">${t('Please enter a league shortcut in the admin panel.')}</div>`;
      return;
    }
    let html = '';
    if (d.favoriteNotFound) html += `<div class="dim small">${t('Team "{name}" not found in this league.', { name: s.favoriteTeam })}</div>`;
    if (d.onlyMyTeam && d.team) {
      html += teamCard(d);
    } else {
      if (d.matchday?.matches?.length) {
        const list = selectMatches(d.matchday.matches, s.maxMatches || 9);
        html += sub(d.matchday.name, d.live) + `<table class="fb-matches">${matchRows(list)}</table>`;
      }
      if (d.team && (d.team.live || d.team.next.length) && s.showNext) {
        html += sub(t('Upcoming matches') + (d.favorite ? ` · ${d.favorite.short || d.favorite.name}` : ''));
        html += `<table class="fb-matches">${matchRows([...(d.team.live && !d.matchday ? [d.team.live] : []), ...d.team.next])}</table>`;
      } else if (d.next?.length) {
        html += sub(t('Upcoming matches')) + `<table class="fb-matches">${matchRows(d.next)}</table>`;
      }
      if (d.table?.rows?.length) html += sub(t('Table')) + tableHtml(d.table);
    }
    el.innerHTML = `<div class="fb">${html || `<div class="dim">${t('No matches')}</div>`}</div>`;
  };

  // Re-render once a minute so "Today/Tomorrow" labels stay correct.
  return { update(d) { data = d; draw(); }, tick: draw, tickEvery: 60000 };
}
