import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  api, provider, parseMatch, parseScore, resolveTeam, buildTable, pickGroup, groupLabel, autoSeason, cacheTtl, teamSchedule, norm,
} from '../src/providers/football.js';
import schema from '../public/shared/modules/football.js';
import { applyDefaults } from '../public/shared/modules.js';
import { translator } from '../public/shared/i18n.js';
import de from '../public/shared/locales/de/modules/football.js';

// Trimmed responses recorded from api.openligadb.de (bl1 2026/27 matchdays 7 & 8,
// table, VfB Stuttgart season list; DFB-Pokal 2025/26 round 1 shoot-out).
const FX = {"md7":[{"matchID":83212,"matchDateTime":"2026-10-23T20:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-23T18:30:00Z","group":{"groupName":"7. Spieltag","groupOrderID":7,"groupID":50639},"team1":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"team2":{"teamId":87,"teamName":"Borussia Mönchengladbach","shortName":"Gladbach","teamIconUrl":"https://i.imgur.com/KSIk0Eu.png"},"matchIsFinished":true,"matchResults":[{"resultName":"Halbzeit","pointsTeam1":1,"pointsTeam2":1,"resultOrderID":1,"resultTypeID":1},{"resultName":"Endergebnis","pointsTeam1":2,"pointsTeam2":3,"resultOrderID":2,"resultTypeID":2}],"goals":[{"scoreTeam1":1,"scoreTeam2":0,"matchMinute":5,"goalGetterName":"E. Demirovic"},{"scoreTeam1":1,"scoreTeam2":1,"matchMinute":38,"goalGetterName":"J. Scally"},{"scoreTeam1":1,"scoreTeam2":2,"matchMinute":51,"goalGetterName":"S. Machino"},{"scoreTeam1":1,"scoreTeam2":3,"matchMinute":66,"goalGetterName":"W. Mohya"},{"scoreTeam1":2,"scoreTeam2":3,"matchMinute":83,"goalGetterName":"E. Demirovic"}]},{"matchID":83210,"matchDateTime":"2026-10-24T18:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-24T16:30:00Z","group":{"groupName":"7. Spieltag","groupOrderID":7,"groupID":50639},"team1":{"teamId":7,"teamName":"Borussia Dortmund","shortName":"Dortmund","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Borussia_Dortmund_logo.svg/960px-Borussia_Dortmund_logo.svg.png"},"team2":{"teamId":91,"teamName":"Eintracht Frankfurt","shortName":"Frankfurt","teamIconUrl":"https://i.imgur.com/X8NFkOb.png"},"matchIsFinished":true,"matchResults":[{"resultName":"Halbzeit","pointsTeam1":0,"pointsTeam2":0,"resultOrderID":1,"resultTypeID":1},{"resultName":"Endergebnis","pointsTeam1":1,"pointsTeam2":0,"resultOrderID":2,"resultTypeID":2}],"goals":[{"scoreTeam1":1,"scoreTeam2":0,"matchMinute":80,"goalGetterName":"M. Beier"}]},{"matchID":83214,"matchDateTime":"2026-10-25T17:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-25T16:30:00Z","group":{"groupName":"7. Spieltag","groupOrderID":7,"groupID":50639},"team1":{"teamId":112,"teamName":"SC Freiburg","shortName":"Freiburg","teamIconUrl":"https://i.imgur.com/r3mvi0h.png"},"team2":{"teamId":40,"teamName":"FC Bayern München","shortName":"Bayern","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/1/1f/Logo_FC_Bayern_M%C3%BCnchen_%282002%E2%80%932017%29.svg"},"matchIsFinished":true,"matchResults":[{"resultName":"Halbzeit","pointsTeam1":0,"pointsTeam2":2,"resultOrderID":1,"resultTypeID":1},{"resultName":"Endergebnis","pointsTeam1":1,"pointsTeam2":3,"resultOrderID":2,"resultTypeID":2}],"goals":[{"scoreTeam1":0,"scoreTeam2":1,"matchMinute":16,"goalGetterName":"D. Upamecano"},{"scoreTeam1":0,"scoreTeam2":2,"matchMinute":42,"goalGetterName":"S. Gnabry"},{"scoreTeam1":1,"scoreTeam2":2,"matchMinute":82,"goalGetterName":"T. Bischof"},{"scoreTeam1":1,"scoreTeam2":3,"matchMinute":95,"goalGetterName":"M. Olise"}]}],"md8":[{"matchID":83219,"matchDateTime":"2026-10-31T18:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-31T17:30:00Z","group":{"groupName":"8. Spieltag","groupOrderID":8,"groupID":50640},"team1":{"teamId":40,"teamName":"FC Bayern München","shortName":"Bayern","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/1/1f/Logo_FC_Bayern_M%C3%BCnchen_%282002%E2%80%932017%29.svg"},"team2":{"teamId":7,"teamName":"Borussia Dortmund","shortName":"Dortmund","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Borussia_Dortmund_logo.svg/960px-Borussia_Dortmund_logo.svg.png"},"matchIsFinished":false,"matchResults":[],"goals":[]},{"matchID":83227,"matchDateTime":"2026-10-30T20:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-30T19:30:00Z","group":{"groupName":"8. Spieltag","groupOrderID":8,"groupID":50640},"team1":{"teamId":198,"teamName":"SV 07 Elversberg","shortName":"Elversberg","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/SV_Elversberg_Logo.svg/500px-SV_Elversberg_Logo.svg.png"},"team2":{"teamId":81,"teamName":"1. FSV Mainz 05","shortName":"Mainz","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_Mainz_05.svg"},"matchIsFinished":false,"matchResults":[],"goals":[]},{"matchID":83220,"matchDateTime":"2026-10-31T15:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-31T14:30:00Z","group":{"groupName":"8. Spieltag","groupOrderID":8,"groupID":50640},"team1":{"teamId":6,"teamName":"Bayer 04 Leverkusen","shortName":"Leverkusen","teamIconUrl":"https://upload.wikimedia.org/wikipedia/de/f/f7/Bayer_Leverkusen_Logo.svg"},"team2":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"matchIsFinished":false,"matchResults":[],"goals":[]}],"table":[{"teamInfoId":40,"teamName":"FC Bayern München","shortName":"Bayern","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/1/1f/Logo_FC_Bayern_M%C3%BCnchen_%282002%E2%80%932017%29.svg","points":17,"opponentGoals":6,"goals":25,"matches":7,"won":5,"lost":0,"draw":2,"goalDiff":19},{"teamInfoId":7,"teamName":"Borussia Dortmund","shortName":"Dortmund","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Borussia_Dortmund_logo.svg/960px-Borussia_Dortmund_logo.svg.png","points":17,"opponentGoals":4,"goals":12,"matches":7,"won":5,"lost":0,"draw":2,"goalDiff":8},{"teamInfoId":112,"teamName":"SC Freiburg","shortName":"Freiburg","teamIconUrl":"https://i.imgur.com/r3mvi0h.png","points":13,"opponentGoals":9,"goals":16,"matches":7,"won":4,"lost":2,"draw":1,"goalDiff":7},{"teamInfoId":6,"teamName":"Bayer 04 Leverkusen","shortName":"Leverkusen","teamIconUrl":"https://upload.wikimedia.org/wikipedia/de/f/f7/Bayer_Leverkusen_Logo.svg","points":13,"opponentGoals":12,"goals":16,"matches":7,"won":4,"lost":2,"draw":1,"goalDiff":4},{"teamInfoId":1635,"teamName":"RB Leipzig","shortName":"Leipzig","teamIconUrl":"https://i.imgur.com/Rpwsjz1.png","points":12,"opponentGoals":11,"goals":20,"matches":7,"won":4,"lost":3,"draw":0,"goalDiff":9},{"teamInfoId":134,"teamName":"SV Werder Bremen","shortName":"Bremen","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/b/be/SV-Werder-Bremen-Logo.svg","points":12,"opponentGoals":14,"goals":15,"matches":7,"won":3,"lost":1,"draw":3,"goalDiff":1},{"teamInfoId":81,"teamName":"1. FSV Mainz 05","shortName":"Mainz","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/9/9e/Logo_Mainz_05.svg","points":10,"opponentGoals":13,"goals":16,"matches":7,"won":3,"lost":3,"draw":1,"goalDiff":3},{"teamInfoId":198,"teamName":"SV 07 Elversberg","shortName":"Elversberg","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/SV_Elversberg_Logo.svg/500px-SV_Elversberg_Logo.svg.png","points":10,"opponentGoals":15,"goals":12,"matches":7,"won":3,"lost":3,"draw":1,"goalDiff":-3},{"teamInfoId":95,"teamName":"FC Augsburg","shortName":"Augsburg","teamIconUrl":"https://i.imgur.com/sdE62e2.png","points":9,"opponentGoals":13,"goals":17,"matches":7,"won":2,"lost":2,"draw":3,"goalDiff":4},{"teamInfoId":175,"teamName":"TSG Hoffenheim","shortName":"Hoffenheim","teamIconUrl":"https://i.imgur.com/gF0PfEl.png","points":9,"opponentGoals":14,"goals":14,"matches":7,"won":3,"lost":4,"draw":0,"goalDiff":0},{"teamInfoId":100,"teamName":"Hamburger SV","shortName":"HSV","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/f/f7/Hamburger_SV_logo.svg","points":9,"opponentGoals":16,"goals":6,"matches":7,"won":3,"lost":4,"draw":0,"goalDiff":-10},{"teamInfoId":65,"teamName":"1. FC Köln","shortName":"Köln","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/0/01/1._FC_Koeln_Logo_2014%E2%80%93.svg","points":8,"opponentGoals":11,"goals":8,"matches":7,"won":2,"lost":3,"draw":2,"goalDiff":-3},{"teamInfoId":31,"teamName":"SC Paderborn 07","shortName":"Paderborn","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/e/e3/SC_Paderborn_07_Logo.svg","points":8,"opponentGoals":9,"goals":6,"matches":7,"won":2,"lost":3,"draw":2,"goalDiff":-3},{"teamInfoId":91,"teamName":"Eintracht Frankfurt","shortName":"Frankfurt","teamIconUrl":"https://i.imgur.com/X8NFkOb.png","points":8,"opponentGoals":17,"goals":10,"matches":7,"won":2,"lost":3,"draw":2,"goalDiff":-7},{"teamInfoId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png","points":6,"opponentGoals":13,"goals":10,"matches":7,"won":2,"lost":5,"draw":0,"goalDiff":-3},{"teamInfoId":9,"teamName":"FC Schalke 04","shortName":"S04","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/9/97/FC_Schalke_04_Logo.png","points":6,"opponentGoals":7,"goals":4,"matches":7,"won":1,"lost":3,"draw":3,"goalDiff":-3},{"teamInfoId":80,"teamName":"1. FC Union Berlin","shortName":"Union Berlin","teamIconUrl":"https://assets.dfb.de/uploads/000/018/232/small_union-Berlin.jpg","points":6,"opponentGoals":18,"goals":6,"matches":7,"won":1,"lost":3,"draw":3,"goalDiff":-12},{"teamInfoId":87,"teamName":"Borussia Mönchengladbach","shortName":"Gladbach","teamIconUrl":"https://i.imgur.com/KSIk0Eu.png","points":3,"opponentGoals":22,"goals":11,"matches":7,"won":1,"lost":6,"draw":0,"goalDiff":-11}],"stuttgart":[{"matchID":83206,"matchDateTime":"2026-10-17T15:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-17T13:30:00Z","group":{"groupName":"6. Spieltag","groupOrderID":6,"groupID":50638},"team1":{"teamId":100,"teamName":"Hamburger SV","shortName":"HSV","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/f/f7/Hamburger_SV_logo.svg"},"team2":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"matchIsFinished":true,"matchResults":[{"resultName":"Halbzeit","pointsTeam1":0,"pointsTeam2":0,"resultOrderID":1,"resultTypeID":1},{"resultName":"Endergebnis","pointsTeam1":1,"pointsTeam2":0,"resultOrderID":2,"resultTypeID":2}],"goals":[]},{"matchID":83212,"matchDateTime":"2026-10-23T20:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-23T18:30:00Z","group":{"groupName":"7. Spieltag","groupOrderID":7,"groupID":50639},"team1":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"team2":{"teamId":87,"teamName":"Borussia Mönchengladbach","shortName":"Gladbach","teamIconUrl":"https://i.imgur.com/KSIk0Eu.png"},"matchIsFinished":true,"matchResults":[{"resultName":"Halbzeit","pointsTeam1":1,"pointsTeam2":1,"resultOrderID":1,"resultTypeID":1},{"resultName":"Endergebnis","pointsTeam1":2,"pointsTeam2":3,"resultOrderID":2,"resultTypeID":2}],"goals":[]},{"matchID":83220,"matchDateTime":"2026-10-31T15:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-10-31T14:30:00Z","group":{"groupName":"8. Spieltag","groupOrderID":8,"groupID":50640},"team1":{"teamId":6,"teamName":"Bayer 04 Leverkusen","shortName":"Leverkusen","teamIconUrl":"https://upload.wikimedia.org/wikipedia/de/f/f7/Bayer_Leverkusen_Logo.svg"},"team2":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"matchIsFinished":false,"matchResults":[],"goals":[]},{"matchID":83230,"matchDateTime":"2026-11-07T18:30:00","leagueId":4937,"leagueName":"1. Fußball-Bundesliga 2026/2027","leagueSeason":2026,"leagueShortcut":"bl1","matchDateTimeUTC":"2026-11-07T17:30:00Z","group":{"groupName":"9. Spieltag","groupOrderID":9,"groupID":50641},"team1":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"team2":{"teamId":134,"teamName":"SV Werder Bremen","shortName":"Bremen","teamIconUrl":"https://upload.wikimedia.org/wikipedia/commons/b/be/SV-Werder-Bremen-Logo.svg"},"matchIsFinished":false,"matchResults":[],"goals":[]}],"dfbPens":[{"matchID":77184,"matchDateTime":"2025-08-26T20:45:00","leagueId":4848,"leagueName":"DFB Pokal 2025/2026","leagueSeason":2025,"leagueShortcut":"dfb","matchDateTimeUTC":"2025-08-26T18:45:00Z","group":{"groupName":"1. Runde","groupOrderID":1,"groupID":48475},"team1":{"teamId":74,"teamName":"Eintracht Braunschweig","shortName":"Braunschweig","teamIconUrl":"https://upload.wikimedia.org/wikipedia/de/4/45/Logo_Eintracht_Braunschweig.svg"},"team2":{"teamId":16,"teamName":"VfB Stuttgart","shortName":"Stuttgart","teamIconUrl":"https://i.imgur.com/v0tkpNx.png"},"matchIsFinished":true,"matchResults":[{"resultName":"Halbzeit","pointsTeam1":1,"pointsTeam2":1,"resultOrderID":1,"resultTypeID":1},{"resultName":"Endergebnis","pointsTeam1":3,"pointsTeam2":4,"resultOrderID":2,"resultTypeID":2},{"resultName":"Nachspielzeit","pointsTeam1":4,"pointsTeam2":4,"resultOrderID":3,"resultTypeID":3},{"resultName":"Elfmeterschießen","pointsTeam1":11,"pointsTeam2":12,"resultOrderID":4,"resultTypeID":5}],"goals":[{"scoreTeam1":5,"scoreTeam2":4,"matchMinute":1,"goalGetterName":"L. Szabo"},{"scoreTeam1":5,"scoreTeam2":5,"matchMinute":1,"goalGetterName":"N. Woltemade"},{"scoreTeam1":5,"scoreTeam2":6,"matchMinute":2,"goalGetterName":"Mittelstädt, Maximilian"},{"scoreTeam1":6,"scoreTeam2":6,"matchMinute":4,"goalGetterName":"Mehmet Can Aydin"},{"scoreTeam1":7,"scoreTeam2":7,"matchMinute":5,"goalGetterName":"J. Leweling"},{"scoreTeam1":7,"scoreTeam2":6,"matchMinute":5,"goalGetterName":"S. Polter"},{"scoreTeam1":8,"scoreTeam2":7,"matchMinute":6,"goalGetterName":"L. Bell Bell"},{"scoreTeam1":8,"scoreTeam2":8,"matchMinute":6,"goalGetterName":"E. Demirovic"},{"scoreTeam1":9,"scoreTeam2":8,"matchMinute":7,"goalGetterName":"S. Ba"},{"scoreTeam1":9,"scoreTeam2":9,"matchMinute":7,"goalGetterName":"R. Hendriks"},{"scoreTeam1":1,"scoreTeam2":0,"matchMinute":8,"goalGetterName":"S. Köhler"},{"scoreTeam1":10,"scoreTeam2":9,"matchMinute":8,"goalGetterName":"K. Ehlers"},{"scoreTeam1":10,"scoreTeam2":10,"matchMinute":8,"goalGetterName":"J. Vagnoman"},{"scoreTeam1":11,"scoreTeam2":10,"matchMinute":9,"goalGetterName":"C. Conteh"},{"scoreTeam1":11,"scoreTeam2":11,"matchMinute":9,"goalGetterName":"Atakan Karazor"},{"scoreTeam1":11,"scoreTeam2":12,"matchMinute":10,"goalGetterName":"L. Assignon"},{"scoreTeam1":1,"scoreTeam2":1,"matchMinute":11,"goalGetterName":"E. Demirovic"},{"scoreTeam1":1,"scoreTeam2":2,"matchMinute":60,"goalGetterName":"E. Demirovic"},{"scoreTeam1":2,"scoreTeam2":2,"matchMinute":77,"goalGetterName":"F. Di Michele Sanchez"},{"scoreTeam1":3,"scoreTeam2":2,"matchMinute":85,"goalGetterName":"F. Di Michele Sanchez"},{"scoreTeam1":3,"scoreTeam2":3,"matchMinute":89,"goalGetterName":"N. Woltemade"},{"scoreTeam1":3,"scoreTeam2":4,"matchMinute":92,"goalGetterName":"S. Ba"},{"scoreTeam1":4,"scoreTeam2":4,"matchMinute":104,"goalGetterName":"C. Conteh"}]}]};

const clone = (x) => JSON.parse(JSON.stringify(x));
const NOW_TUE = Date.parse('2026-10-27T10:00:00Z'); // matchday 7 over, 8 starts Fri
const cfg = { general: { locale: 'de-DE', timezone: 'Europe/Berlin' } };
const settings = (over) => applyDefaults(schema.fields, over);
const t = translator('en');

let server;
let routes = {};
const hits = [];
before(async () => {
  server = http.createServer((req, res) => {
    const path = decodeURIComponent(req.url);
    hits.push(path);
    const body = routes[path];
    // Like OpenLigaDB: unknown leagues/matchdays answer 200 with an empty list.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body ?? []));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
});
after(() => server.close());

// Each provider test gets its own base URL so the shared cache does not leak.
let n = 0;
function useApi(r, now = NOW_TUE) {
  routes = r;
  api.base = `http://127.0.0.1:${server.address().port}/v${++n}`;
  api.now = () => now;
  return `/v${n}`;
}

test('parseScore: regular, live (goals ahead of results), extra time + penalties', () => {
  const finished = FX.md7.find((m) => m.team1.shortName === 'Stuttgart');
  assert.deepEqual(parseScore(finished), { score: [2, 3], half: [1, 1], pens: null, aet: false });

  const live = clone(FX.md8[0]);
  live.matchResults = [{ resultName: 'Halbzeit', pointsTeam1: 0, pointsTeam2: 0, resultOrderID: 1, resultTypeID: 1 }];
  live.goals = [{ scoreTeam1: 1, scoreTeam2: 0, matchMinute: 52 }];
  assert.deepEqual(parseScore(live).score, [1, 0]);

  const pens = parseScore(FX.dfbPens[0]);
  assert.deepEqual(pens.score, [4, 4]);
  assert.deepEqual(pens.pens, [11, 12]);
  assert.equal(pens.aet, true);
});

test('parseMatch: state from kick-off and finished flag', () => {
  const m = clone(FX.md8.find((x) => x.team1.shortName === 'Bayern'));
  const start = Date.parse(m.matchDateTimeUTC);
  assert.equal(parseMatch(m, { now: start - 60000 }).state, 'scheduled');
  assert.equal(parseMatch(m, { now: start - 60000 }).score, null);
  const live = parseMatch(m, { now: start + 30 * 60000 });
  assert.equal(live.state, 'live');
  assert.deepEqual(live.score, [0, 0]);
  // Never flagged finished and no score long after kick-off: keep as scheduled.
  assert.equal(parseMatch(m, { now: start + 5 * 3600000 }).state, 'scheduled');
  m.matchIsFinished = true;
  assert.equal(parseMatch(m, { now: start + 30 * 60000 }).state, 'finished');
  const fav = { id: 40, name: 'FC Bayern München' };
  const p = parseMatch(m, { fav });
  assert.equal(p.home.fav, true);
  assert.equal(p.away.fav, false);
  assert.equal(p.home.short, 'Bayern');
});

test('resolveTeam: case-insensitive, umlauts and substrings', () => {
  assert.equal(FX.table[14].shortName, 'Stuttgart');
  const teams = FX.table.map((r) => ({ id: r.teamInfoId, name: r.teamName, short: r.shortName }));
  assert.equal(resolveTeam('vfb stuttgart', teams).id, 16);
  assert.equal(resolveTeam('STUTTGART', teams).id, 16);
  assert.equal(resolveTeam('Bayern Muenchen', teams).id, 40);
  assert.equal(resolveTeam('fc bayern münchen', teams).id, 40);
  assert.equal(resolveTeam('schalke', teams).id, 9);
  assert.equal(resolveTeam('Hertha', teams), null);
  assert.equal(resolveTeam('', teams), null);
  assert.equal(norm('Borussia Mönchengladbach'), 'borussia moenchengladbach');
});

test('buildTable: top rows plus the favorite row with a gap', () => {
  const fav = { id: 16, name: 'VfB Stuttgart' };
  const tbl = buildTable(FX.table, { count: 4, fav });
  assert.equal(tbl.rows.length, 5);
  assert.deepEqual(tbl.rows.slice(0, 4).map((r) => r.pos), [1, 2, 3, 4]);
  const last = tbl.rows.at(-1);
  assert.equal(last.short, 'Stuttgart');
  assert.equal(last.fav, true);
  assert.equal(last.gap, true);
  assert.equal(tbl.favorite.points, last.points);
  // Favorite already within the top rows → no extra row.
  assert.equal(buildTable(FX.table, { count: 3, fav: { id: 40, name: 'FC Bayern München' } }).rows.length, 3);
});

test('pickGroup: switches to the next matchday between the two', () => {
  const fri = Date.parse(FX.md8.map((m) => m.matchDateTimeUTC).sort()[0]);
  assert.equal(pickGroup(FX.md7, FX.md8, Date.parse('2026-10-26T08:00:00Z')), FX.md7); // Monday: results
  assert.equal(pickGroup(FX.md7, FX.md8, Date.parse('2026-10-29T08:00:00Z')), FX.md8); // Thursday: fixtures
  assert.equal(pickGroup(FX.md7, FX.md8, fri), FX.md8);
  const running = clone(FX.md7);
  running[0].matchIsFinished = false;
  assert.equal(pickGroup(running, FX.md8, fri), running);
  assert.equal(pickGroup(FX.md7, [], fri), FX.md7);
});

test('groupLabel, autoSeason', () => {
  assert.equal(groupLabel('7. Spieltag', t), 'Matchday 7');
  const tDe = (id, p) => (de[id] ?? id).replace(/\{(\w+)\}/g, (_, k) => p[k]);
  assert.equal(groupLabel('7. Spieltag', tDe), '7. Spieltag');
  assert.equal(groupLabel('2. Runde', t), '2. Runde');
  assert.equal(autoSeason(new Date('2026-06-30T12:00:00Z')), 2025);
  assert.equal(autoSeason(new Date('2026-07-01T12:00:00Z')), 2026);
  assert.equal(autoSeason(new Date('2027-01-15T12:00:00Z')), 2026);
});

test('teamSchedule: last result and upcoming matches', () => {
  const s = teamSchedule(FX.stuttgart, { now: NOW_TUE });
  assert.equal(s.live, null);
  assert.equal(s.last.away.short, 'Gladbach');
  assert.deepEqual(s.last.score, [2, 3]);
  assert.deepEqual(s.upcoming.map((m) => m.home.short), ['Leverkusen', 'Stuttgart']);
});

const leagueRoutes = (p, extra = {}) => ({
  [`${p}/getmatchdata/bl1`]: FX.md7,
  [`${p}/getmatchdata/bl1/2026/8`]: FX.md8,
  [`${p}/getbltable/bl1/2026`]: FX.table,
  [`${p}/getmatchdata/bl1/2026/VfB Stuttgart`]: FX.stuttgart,
  ...extra,
});

test('provider: matchday, table and favorite highlighting', async () => {
  const p = useApi({});
  routes = leagueRoutes(p);
  const d = await provider(settings({ favoriteTeam: 'vfb stuttgart', tableRows: 3 }), cfg);
  assert.equal(d.league.season, 2026);
  assert.equal(d.league.name, '1. Fußball-Bundesliga 2026/2027');
  assert.equal(d.matchday.order, 7);
  assert.equal(d.matchday.matches.length, 3);
  assert.equal(d.live, false);
  assert.ok(d.matchday.matches.some((m) => m.home.fav && m.home.short === 'Stuttgart'));
  assert.deepEqual(d.table.rows.map((r) => r.pos), [1, 2, 3, 15]);
  assert.equal(d.table.rows.at(-1).fav, true);
  assert.equal(d.favorite.name, 'VfB Stuttgart');
  assert.equal(d.onlyMyTeam, false);
  assert.equal(d.team, undefined);
});

test('provider: shows next matchday later in the week', async () => {
  const p = useApi({}, Date.parse('2026-10-29T12:00:00Z'));
  routes = leagueRoutes(p);
  const d = await provider(settings({ showTable: false }), cfg);
  assert.equal(d.matchday.order, 8);
  assert.ok(d.matchday.matches.every((m) => m.state === 'scheduled' && m.score === null));
  assert.equal(d.table, undefined);
  assert.ok(!hits.includes(`${p}/getbltable/bl1/2026`));
});

test('provider: only-my-team mode', async () => {
  const p = useApi({});
  routes = leagueRoutes(p);
  const d = await provider(settings({ favoriteTeam: 'Stuttgart', onlyMyTeam: true }), cfg);
  assert.equal(d.onlyMyTeam, true);
  assert.equal(d.matchday, undefined);
  assert.equal(d.table, undefined);
  assert.equal(d.team.position, 15);
  assert.equal(d.team.points, FX.table[14].points);
  assert.deepEqual(d.team.last.score, [2, 3]);
  assert.equal(d.team.next.length, 1);
  assert.equal(d.team.next[0].home.short, 'Leverkusen');
});

test('provider: live game → live flag and 60 s cache', async () => {
  const kickoff = Date.parse('2026-10-31T14:30:00Z');
  const md8 = clone(FX.md8);
  const lev = md8.find((m) => m.team1.shortName === 'Leverkusen');
  lev.goals = [{ scoreTeam1: 0, scoreTeam2: 1, matchMinute: 12 }];
  const p = useApi({}, kickoff + 20 * 60000);
  routes = { [`${p}/getmatchdata/bl1`]: md8, [`${p}/getbltable/bl1/2026`]: FX.table };
  const d = await provider(settings({ favoriteTeam: 'stuttgart' }), cfg);
  const m = d.matchday.matches.find((x) => x.home.short === 'Leverkusen');
  assert.equal(m.state, 'live');
  assert.deepEqual(m.score, [0, 1]);
  assert.equal(m.away.fav, true);
  assert.equal(d.live, true);
  assert.equal(cacheTtl('bl1', kickoff + 20 * 60000), 60);
  assert.equal(cacheTtl('bl1', kickoff - 3 * 3600000), 300);
  assert.equal(cacheTtl('bl1', kickoff - 90000), 60);
});

test('provider: upcoming league matches without a favorite', async () => {
  const p = useApi({});
  routes = leagueRoutes(p);
  const d = await provider(settings({ showNext: true, nextCount: 2 }), cfg);
  assert.equal(d.next.length, 2);
  assert.ok(d.next.every((m) => m.group === '8. Spieltag'));
});

test('provider: unknown league and missing shortcut', async () => {
  useApi({});
  await assert.rejects(provider(settings({ league: 'custom', customLeague: 'nope' }), cfg), /No matches found|Keine Spiele/);
  assert.deepEqual(await provider(settings({ league: 'custom', customLeague: ' ' }), cfg), { needsSetup: true });
});

test('every football string has a German translation', () => {
  const missing = [];
  const check = (s) => s && !(s in de) && missing.push(s);
  check(schema.label);
  check(schema.description);
  check(schema.defaultTitle);
  for (const f of schema.fields) {
    check(f.label);
    check(f.placeholder);
    (f.options || []).forEach((o) => check(o.label));
  }
  assert.deepEqual(missing, []);
});
