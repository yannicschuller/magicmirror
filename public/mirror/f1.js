// Formula 1 renderer: next race weekend, live positions (OpenF1), qualifying/sprint grid,
// track info, session times in track time and a compact one/two-line layout.
import { esc, num, countdown } from './renderers.js';
import { icons, weatherInfo } from './icons.js';

const TEAM_COLORS = [
  ['red bull', '#3671C6'], ['ferrari', '#E8002D'], ['mercedes', '#27F4D2'], ['mclaren', '#FF8000'], ['aston', '#229971'],
  ['alpine', '#FF87BC'], ['williams', '#64C4FF'], ['rb f1', '#6692FF'], ['racing bulls', '#6692FF'], ['sauber', '#52E252'],
  ['audi', '#F50537'], ['haas', '#B6BABD'], ['cadillac', '#D4AF37'],
];
const teamColor = (name = '') => TEAM_COLORS.find(([k]) => name.toLowerCase().includes(k))?.[1] || '#888';
const bar = (color) => `<span class="team" style="background:${esc(color)}"></span>`;
const TYRES = { S: 'soft', M: 'medium', H: 'hard', I: 'inter', W: 'wet' };
const tyre = (c) => (c ? `<span class="f1-tyre ${TYRES[c] || ''}">${esc(c)}</span>` : '');

export const f1 = (el, mod, ctx) => {
  const s = mod.settings;
  const t = ctx.fmt.t;
  const fav = s.favoriteDrivers.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  const compact = s.layout === 'compact';
  const trackMode = s.trackTime || 'off';
  let last = null;

  // "So 21:00" in the mirror's zone, the track's zone, or both.
  const wd = () => ctx.fmt.f({ weekday: 'short' });
  const localParts = (iso) => ({ wd: wd().format(new Date(iso)).replace('.', ''), time: ctx.fmt.time(new Date(iso)) });
  const when = (x) => {
    const local = localParts(x.start);
    if (!x.track || trackMode === 'off') return `${local.wd} ${local.time}`;
    if (trackMode === 'only') return `${x.track.wd} ${x.track.time} ${t('track time')}`;
    return `${local.wd} ${local.time} · ${x.track.wd === local.wd ? '' : `${x.track.wd} `}${x.track.time} ${t('track time')}`;
  };

  const liveBlock = (d) => {
    const l = d.live;
    if (!l) return '';
    if (l.status === 'waiting') return `<div class="f1-live-note dim small">${esc(l.label)} · ${t('Waiting for timing data …')}</div>`;
    if (l.status === 'restricted') return `<div class="f1-live-note dim small">${t('Live data only for OpenF1 sponsors – the result follows about 30 min after the session.')}</div>`;
    if (!l.rows?.length) return '';
    const race = l.key === 'Race' || l.key === 'Sprint';
    const delayed = l.status === 'delayed';
    const head = delayed
      ? `${esc(l.label)} · ${t('Final classification')} <span class="f1-delayed">${t('delayed')}</span>`
      : `<span class="f1-live-dot">●</span> ${t('Live positions')} · ${esc(l.label)}${l.lap ? ` · ${t('Lap {n}', { n: l.lap })}` : ''}`;
    const rows = l.rows
      .map((r) => {
        const gap = race && !delayed ? r.interval : r.gap;
        const extra = race ? `<td class="r dim small">${r.pits ? `${r.pits}×` : ''}</td>` : `<td class="r dim small">${esc(r.best || '')}</td>`;
        return `<tr class="${fav.includes(r.code) ? 'fav' : ''}"><td class="r dim">${r.pos}</td><td>${bar(r.color || teamColor(r.team))}${esc(r.code)}</td><td class="r">${esc(gap || '')}</td><td class="c">${tyre(r.tyre)}</td>${extra}</tr>`;
      })
      .join('');
    return `<div class="f1-sub f1-live-head${delayed ? '' : ' live'} small">${head}</div><table class="f1-live">${rows}</table>`;
  };

  const gridBlock = (d) => {
    const g = d.grid;
    if (!g?.rows?.length) return '';
    const title = g.key === 'Qualifying' ? t('Qualifying result') : g.key === 'Sprint' ? t('Sprint result') : t('Sprint Quali result');
    return `<div class="f1-sub dim small">${title}</div><div class="f1-grid">${g.rows
      .map((r) => `<div class="f1-slot${r.pos % 2 ? '' : ' even'}${fav.includes(r.code) ? ' fav' : ''}"><span class="dim">${r.pos}</span>${bar(r.color || teamColor(r.team))}<b>${esc(r.code || r.name)}</b><span class="dim small">${esc(r.time || '')}</span></div>`)
      .join('')}</div>`;
  };

  const infoLines = (d, withFirstGp) => {
    const i = d.trackInfo;
    const tr = d.track;
    const first = [];
    if (i?.laps) first.push(`${i.laps} ${t('laps')}`);
    const len = i?.lengthKm || (tr?.length && tr.length / 1000);
    if (len) first.push(`${num(len, 3)} km`);
    if (i?.distanceKm) first.push(`${num(i.distanceKm, 1)} km ${t('race distance')}`);
    if (i?.corners) first.push(`${i.corners} ${t('corners')}`);
    if (i?.drsZones) first.push(`${i.drsZones} ${t('DRS zones')}`);
    if (withFirstGp && tr?.firstGp) first.push(t('first GP {year}', { year: tr.firstGp }));
    let html = first.length ? `<div>${esc(first.join(' · '))}</div>` : '';
    const rec = i?.lapRecord;
    if (rec) html += `<div>${t('Lap record')} ${esc(rec.time)} · ${esc(rec.driver)} (${rec.year})</div>`;
    return html;
  };

  const renderCompact = (d, next, ms, live) => {
    const l = d.live;
    let second;
    if (l?.status === 'live' && l.rows?.length) {
      const lead = l.rows[0];
      const p2 = l.rows[1];
      second = `<span class="f1-live-dot">●</span> ${esc(l.label)}${l.lap ? ` · ${t('Lap {n}', { n: l.lap })}` : ''} · P1 ${bar(lead.color || teamColor(lead.team))}<b>${esc(lead.code)}</b>${p2 ? ` <span class="dim">· ${esc(p2.code)} ${esc(p2.interval || p2.gap || '')}</span>` : ''}`;
    } else {
      second = `${esc(next.label)} <span class="dim">${esc(when(next))}</span> · <span class="f1-cd-value${live ? ' live' : ''}">${live ? '● LIVE' : t('in {time}', { time: countdown(ms) })}</span>`;
    }
    return `<div class="f1 f1-compact"><div class="f1-c1"><span class="dim small">R${d.round}</span> <span class="f1-c-name">${esc(d.raceName)}</span> <span class="dim small">${esc(d.locality)}</span></div><div class="f1-c2">${second}</div></div>`;
  };

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
    if (compact) {
      el.innerHTML = renderCompact(d, next, ms, live);
      return;
    }
    let html = `<div class="f1">
      <div class="f1-meta dim small">${t('Round {n}', { n: d.round })}${d.totalRounds ? ` / ${d.totalRounds}` : ''} · ${t('Season {n}', { n: d.season })}${d.isSprint ? ` · <span class="accent">${t('Sprint weekend')}</span>` : ''}</div>
      <div class="f1-name">${esc(d.raceName)}</div>
      <div class="f1-circuit dim">${icons.pin} ${esc(d.circuit)} · ${esc(d.locality)}, ${esc(d.country)}</div>`;
    if (s.showTrackMap && d.track) {
      const tr = d.track;
      const pad = 6;
      const facts = d.trackInfo
        ? infoLines(d, true)
        : esc([tr.length && `${num(tr.length / 1000, 3)} km`, tr.firstGp && t('first GP {year}', { year: tr.firstGp })].filter(Boolean).join(' · '));
      html += `<div class="f1-track size-${esc(s.trackMapSize || 'medium')}"><svg viewBox="${-pad} ${-pad} ${tr.w + 2 * pad} ${tr.h + 2 * pad}" role="img" aria-label="${esc(tr.name || d.circuit)}"><path class="f1-track-glow" d="${tr.d}"/><path class="f1-track-line" d="${tr.d}"/><circle class="f1-track-start" cx="${tr.start[0]}" cy="${tr.start[1]}" r="2.6"/></svg>${facts ? `<div class="f1-track-facts dim small">${facts}</div>` : ''}</div>`;
    } else if (d.trackInfo) {
      const info = infoLines(d, false);
      if (info) html += `<div class="f1-track-facts f1-info dim small">${info}</div>`;
    }
    if (s.showCountdown) {
      html += `<div class="f1-countdown${live ? ' live' : ''}"><span class="f1-cd-label">${esc(next.label)}</span><span class="f1-cd-value">${live ? '● LIVE' : t('in {time}', { time: countdown(ms) })}</span></div>`;
    }
    html += liveBlock(d);
    if (s.showSessions) {
      const showTrack = trackMode !== 'off' && d.sessions.some((x) => x.track);
      const only = showTrack && trackMode === 'only';
      const head = showTrack ? `<tr class="f1-tt-head dim small"><td colspan="3" class="r">${only ? t('Track time') : ''}</td>${only ? '' : `<td class="r" colspan="2">${t('Track time')}</td>`}</tr>` : '';
      html += `<table class="f1-sessions">${head}${d.sessions
        .map((x) => {
          const start = new Date(x.start);
          const past = start.getTime() + 2 * 3600 * 1000 < now;
          const cls = x.key === next.key ? 'next' : past ? 'past' : '';
          const local = localParts(x.start);
          const [w, tm] = only ? [x.track.wd, x.track.time] : [local.wd, local.time];
          const tt = showTrack && !only ? `<td class="r dim f1-tt">${esc(x.track?.wd || '')}</td><td class="r dim f1-tt">${esc(x.track?.time || '')}</td>` : '';
          return `<tr class="${cls}"><td>${esc(x.label)}</td><td class="r">${esc(w)}</td><td class="r">${esc(tm)}</td>${tt}</tr>`;
        })
        .join('')}</table>`;
    }
    html += gridBlock(d);
    const facts = [];
    if (d.trackWeather) {
      const w = d.trackWeather;
      const wi = weatherInfo(w.code);
      facts.push(`<span>${wi.icon} ${t('Race day')} ${num(w.max)}° · ${icons.drop}${num(w.pop)} %</span>`);
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
        .map((x) => `<tr class="${fav.includes(x.code) ? 'fav' : ''}"><td class="r dim">${x.pos}</td><td>${bar(teamColor(x.team))}${esc(x.name)}</td><td class="r">${x.points}</td></tr>`)
        .join('')}</table>`;
    }
    if (d.constructorStandings?.length) {
      html += `<div class="f1-sub dim small">${t('Constructor standings')}</div><table class="f1-standings">${d.constructorStandings
        .map((x) => `<tr><td class="r dim">${x.pos}</td><td>${bar(teamColor(x.name))}${esc(x.name)}</td><td class="r">${x.points}</td></tr>`)
        .join('')}</table>`;
    }
    el.innerHTML = html + '</div>';
  };
  return {
    update(d) { last = d; render(); },
    tick: render,
    tickEvery: 30000,
    // Polling hint from the server: fast while a session is live, otherwise the module default.
    refreshSeconds: () => last?.refresh || 0,
  };
};
