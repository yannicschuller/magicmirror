// Football – live scores, fixtures and tables from OpenLigaDB (https://api.openligadb.de,
// free, no key). Kick-off times are passed on as UTC ISO strings; the mirror formats
// them in its own time zone.
import { translator, langOf } from '../../public/shared/i18n.js';
import { cached, fetchJson } from '../util.js';

export const api = { base: 'https://api.openligadb.de', now: () => Date.now() };

const MIN = 60000;
// A match counts as "live" from kick-off until it is flagged finished (capped, in
// case OpenLigaDB never sets the flag).
const LIVE_WINDOW = { league: 150 * MIN, cup: 190 * MIN };
const TTL_NORMAL = 300;
const TTL_LIVE = 60;

// Start times of not-yet-finished matches we have seen, per league – used to pick
// a short cache TTL while a game is (about to be) running.
const kickoffs = new Map();

export function cacheTtl(league, now = api.now()) {
  const list = kickoffs.get(league) || [];
  let ttl = TTL_NORMAL;
  for (const start of list) {
    if (now >= start - 2 * MIN && now < start + LIVE_WINDOW.cup) return TTL_LIVE;
    if (start > now) ttl = Math.min(ttl, Math.max(TTL_LIVE, Math.ceil((start - now) / 1000)));
  }
  return ttl;
}

function remember(league, matches) {
  const set = new Set(kickoffs.get(league) || []);
  for (const m of matches) {
    const start = Date.parse(m.matchDateTimeUTC);
    if (!m.matchIsFinished && Number.isFinite(start)) set.add(start);
    else set.delete(start);
  }
  const now = api.now();
  kickoffs.set(league, [...set].filter((s) => s > now - 6 * 3600 * 1000).sort((a, b) => a - b).slice(0, 60));
}

async function get(league, path) {
  const url = `${api.base}${path}`;
  const data = await cached(`football:${url}`, cacheTtl(league), () => fetchJson(url, { timeout: 15000 }));
  if (Array.isArray(data) && data.length && data[0]?.matchDateTimeUTC) remember(league, data);
  return data;
}

// Season start year: football seasons start in July.
export function autoSeason(now = new Date(), timeZone = 'Europe/Berlin') {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
  return m >= 7 ? y : y - 1;
}

// Lower-case, umlauts spelled out, only letters/digits – "München" == "muenchen".
export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Find the favorite team among {id, name, short} candidates (exact match first,
// then substring).
export function resolveTeam(query, teams) {
  const q = norm(query);
  if (!q) return null;
  const list = teams.filter((t) => t && t.name);
  return (
    list.find((t) => norm(t.name) === q || norm(t.short) === q) ||
    list.find((t) => norm(t.name).includes(q) || (t.short && norm(t.short).includes(q))) ||
    list.find((t) => q.includes(norm(t.name)) || (t.short && norm(t.short).length > 3 && q.includes(norm(t.short)))) ||
    null
  );
}

const team = (t) => ({ id: t.teamId ?? t.teamInfoId, name: t.teamName, short: t.shortName || t.teamName, icon: t.teamIconUrl || null });

// Final/live score of an OpenLigaDB match.
export function parseScore(m) {
  const results = (m.matchResults || []).slice().sort((a, b) => (a.resultOrderID ?? 0) - (b.resultOrderID ?? 0));
  const byType = (id) => results.find((r) => r.resultTypeID === id);
  const pensR = results.find((r) => r.resultTypeID === 5 || /elfmeter|penalt/i.test(r.resultName || ''));
  const main = results.filter((r) => r !== pensR).at(-1);
  const half = byType(1);
  let score = main ? [main.pointsTeam1, main.pointsTeam2] : null;
  // While a match is running, the goal list is often ahead of the results.
  const goals = (m.goals || []).filter((g) => g.scoreTeam1 != null && g.scoreTeam2 != null);
  const lastGoal = goals.at(-1);
  if (!m.matchIsFinished && lastGoal && (!score || lastGoal.scoreTeam1 + lastGoal.scoreTeam2 > score[0] + score[1])) {
    score = [lastGoal.scoreTeam1, lastGoal.scoreTeam2];
  }
  // Anything after the regular final result (type 2) is extra time ("Verlängerung"/"Nachspielzeit").
  const regular = byType(2);
  const aet = !!(main && regular && main !== regular && (main.resultOrderID ?? 0) > (regular.resultOrderID ?? 0));
  return {
    score,
    half: half && half !== main ? [half.pointsTeam1, half.pointsTeam2] : null,
    pens: pensR ? [pensR.pointsTeam1, pensR.pointsTeam2] : null,
    aet,
  };
}

export function parseMatch(m, { now = Date.now(), cup = false, fav = null } = {}) {
  const start = m.matchDateTimeUTC || null;
  const t0 = Date.parse(start);
  const { score, half, pens, aet } = parseScore(m);
  let state = 'scheduled';
  if (m.matchIsFinished) state = 'finished';
  else if (Number.isFinite(t0) && now >= t0) {
    if (now < t0 + (cup ? LIVE_WINDOW.cup : LIVE_WINDOW.league)) state = 'live';
    else if (score) state = 'finished';
  }
  const home = team(m.team1 || {});
  const away = team(m.team2 || {});
  const isFav = (x) => !!fav && (x.id === fav.id || x.name === fav.name);
  home.fav = isFav(home);
  away.fav = isFav(away);
  return {
    id: m.matchID,
    start,
    state,
    home,
    away,
    score: score || (state === 'live' ? [0, 0] : null),
    half,
    pens,
    aet,
    group: m.group?.groupName || null,
  };
}

// Matchday names come in German ("7. Spieltag"); translate the common pattern.
export function groupLabel(name, t) {
  const md = /^(\d+)\.\s*Spieltag$/i.exec(String(name || '').trim());
  if (md) return t('Matchday {n}', { n: md[1] });
  return name || '';
}

// Which matchday to show: the current one; once all its games are over, switch to
// the next one halfway between the last final whistle (+12 h at least) and the
// next kick-off.
export function pickGroup(current, next, now = Date.now()) {
  if (!next?.length || !current?.length) return current?.length ? current : next || [];
  const done = current.every((m) => m.matchIsFinished);
  if (!done) return current;
  const lastEnd = Math.max(...current.map((m) => Date.parse(m.matchDateTimeUTC))) + 2 * 3600 * 1000;
  const firstNext = Math.min(...next.map((m) => Date.parse(m.matchDateTimeUTC)));
  const switchAt = Math.max(lastEnd + 12 * 3600 * 1000, lastEnd + (firstNext - lastEnd) / 2);
  return now >= Math.min(switchAt, firstNext - 3600 * 1000) ? next : current;
}

export function buildTable(rows, { count = 6, fav = null } = {}) {
  const all = (rows || []).map((r, i) => ({
    pos: i + 1,
    ...team(r),
    played: r.matches,
    won: r.won,
    draw: r.draw,
    lost: r.lost,
    goals: r.goals,
    against: r.opponentGoals,
    diff: r.goalDiff,
    points: r.points,
  }));
  for (const r of all) r.fav = !!fav && (r.id === fav.id || r.name === fav.name);
  const top = all.slice(0, count);
  const favRow = all.find((r) => r.fav);
  if (favRow && favRow.pos > count) top.push({ ...favRow, gap: favRow.pos > count + 1 });
  return { rows: top, total: all.length, favorite: favRow || null };
}

const sortByStart = (a, b) => String(a.matchDateTimeUTC).localeCompare(String(b.matchDateTimeUTC));

// Last result, live game and upcoming fixtures of one team from its season list.
export function teamSchedule(matches, opts) {
  const list = (matches || []).slice().sort(sortByStart).map((m) => parseMatch(m, opts));
  const live = list.find((m) => m.state === 'live') || null;
  const last = list.filter((m) => m.state === 'finished').at(-1) || null;
  const upcoming = list.filter((m) => m.state === 'scheduled' && m.start && Date.parse(m.start) > (opts?.now ?? Date.now()) - 3 * 3600 * 1000);
  return { live, last, upcoming };
}

export async function provider(settings, cfg) {
  const t = translator(langOf(cfg.general.locale));
  const tz = cfg.general.timezone || 'Europe/Berlin';
  const league = (settings.league === 'custom' ? String(settings.customLeague || '') : settings.league).trim();
  if (!league) return { needsSetup: true };
  const L = encodeURIComponent(league);
  const cup = league === 'dfb';
  const now = api.now();

  // Current matchday (also tells us the season and the league's name).
  let season = Number(settings.season) || 0;
  let current;
  if (!season) {
    current = await get(league, `/getmatchdata/${L}`);
    season = current[0]?.leagueSeason || autoSeason(new Date(now), tz);
  } else {
    const auto = autoSeason(new Date(now), tz);
    if (season === auto) current = await get(league, `/getmatchdata/${L}`);
    if (!current?.length || current[0].leagueSeason !== season) {
      const groups = await get(league, `/getavailablegroups/${L}/${season}`);
      const order = groups.length ? (season < auto ? groups.at(-1) : groups[0]).groupOrderID : 1;
      current = await get(league, `/getmatchdata/${L}/${season}/${order}`);
    }
  }
  if (!Array.isArray(current) || !current.length) {
    throw new Error(t('No matches found for league "{league}" (season {season})', { league, season }));
  }
  current = current.slice().sort(sortByStart);
  const groupOrder = current[0].group?.groupOrderID;
  let following = [];
  const allDone = current.every((m) => m.matchIsFinished);
  if (groupOrder && (allDone || (settings.showNext && !settings.favoriteTeam))) {
    following = await get(league, `/getmatchdata/${L}/${season}/${groupOrder + 1}`).catch(() => []);
    following = (Array.isArray(following) ? following : []).slice().sort(sortByStart);
  }
  const shown = pickGroup(current, following, now);
  const info = shown[0] || current[0];

  const wantTable = !cup && (settings.showTable || settings.onlyMyTeam);
  const tableRaw = wantTable ? await get(league, `/getbltable/${L}/${season}`).catch(() => []) : [];

  // Favorite team: resolve against the table and the loaded matches.
  let fav = null;
  if (settings.favoriteTeam) {
    const candidates = [...(tableRaw || []).map(team)];
    for (const m of [...current, ...following]) candidates.push(team(m.team1 || {}), team(m.team2 || {}));
    fav = resolveTeam(settings.favoriteTeam, candidates);
  }
  const opts = { now, cup, fav };

  const result = {
    league: { shortcut: league, name: info.leagueName || league, season, id: info.leagueId, cup },
    favorite: fav ? { name: fav.name, short: fav.short, icon: fav.icon } : null,
    favoriteNotFound: !!settings.favoriteTeam && !fav,
  };

  const onlyTeam = !!(settings.onlyMyTeam && fav);
  result.onlyMyTeam = onlyTeam;
  if (settings.showMatchday && !onlyTeam) {
    result.matchday = {
      name: groupLabel(info.group?.groupName, t),
      order: info.group?.groupOrderID ?? null,
      matches: shown.map((m) => parseMatch(m, opts)),
    };
  }
  const table = wantTable && Array.isArray(tableRaw) && tableRaw.length ? buildTable(tableRaw, { count: settings.tableRows, fav }) : null;
  // In "only my team" mode the table is only used for the team's position.
  if (table && settings.showTable && !onlyTeam) result.table = { rows: table.rows, total: table.total };

  // Favorite team's own fixtures (one request for the whole season).
  if (fav && (onlyTeam || settings.showNext)) {
    const list = await get(league, `/getmatchdata/${L}/${season}/${encodeURIComponent(fav.name)}`).catch(() => []);
    const sched = teamSchedule(Array.isArray(list) ? list : [], opts);
    const row = table?.favorite;
    result.team = {
      live: sched.live,
      last: onlyTeam ? sched.last : null,
      next: sched.upcoming.slice(0, settings.showNext ? settings.nextCount : 1),
      position: row?.pos ?? null,
      points: row?.points ?? null,
      played: row?.played ?? null,
      diff: row?.diff ?? null,
      teams: table?.total ?? null,
    };
  } else if (settings.showNext) {
    const shownIds = new Set(settings.showMatchday ? shown.map((m) => m.matchID) : []);
    result.next = [...current, ...following]
      .filter((m) => !shownIds.has(m.matchID))
      .map((m) => parseMatch(m, opts))
      .filter((m) => m.state === 'scheduled')
      .slice(0, settings.nextCount);
  }

  const matches = [...(result.matchday?.matches || []), ...(result.team?.live ? [result.team.live] : [])];
  result.live = matches.some((m) => m.state === 'live');
  return result;
}
