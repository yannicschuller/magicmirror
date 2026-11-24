// Football (src/providers/football.js): Bundesliga matchday – finished, live and upcoming
// matches – plus the table.
import { iso, addMin, LONG } from './index.js';

const TEAMS = [
  ['FC Bayern München', 'Bayern', 40], ['RB Leipzig', 'Leipzig', 1635], ['Borussia Dortmund', 'Dortmund', 7], ['Bayer 04 Leverkusen', 'Leverkusen', 6],
  ['VfB Stuttgart', 'Stuttgart', 16], ['Eintracht Frankfurt', 'Frankfurt', 91], ['SC Freiburg', 'Freiburg', 112], ['1. FSV Mainz 05', 'Mainz', 81],
  ['TSG Hoffenheim', 'Hoffenheim', 175], ['Borussia Mönchengladbach', 'Gladbach', 87], ['VfL Wolfsburg', 'Wolfsburg', 131], ['1. FC Union Berlin', 'Union Berlin', 80],
  ['SV Werder Bremen', 'Bremen', 134], ['FC Augsburg', 'Augsburg', 95], ['1. FC Köln', 'Köln', 65], ['Hamburger SV', 'HSV', 100],
  ['FC St. Pauli', 'St. Pauli', 98], ['1. FC Heidenheim 1846', 'Heidenheim', 199],
];
const LONG_NAMES = {
  'Borussia Mönchengladbach': 'Borussia VfL 1900 Mönchengladbach',
  'TSG Hoffenheim': 'TSG 1899 Hoffenheim Fußball-Spielbetriebs GmbH',
  'FC St. Pauli': `FC St. Pauli von 1910 ${LONG}`,
  '1. FC Heidenheim 1846': '1. FC Heidenheim 1846 an der Brenz',
};

export default ({ now, settings, long }) => {
  const team = (i, fav) => {
    const [name0, short0, id] = TEAMS[i];
    const name = long ? LONG_NAMES[name0] || name0 : name0;
    const short = long ? name : short0;
    return { id, name, short, icon: `https://i.imgur.com/team${id}.png`, fav: !!fav && fav === name0 };
  };
  const favQ = String(settings.favoriteTeam || '').toLowerCase();
  const favName = favQ ? TEAMS.find(([n, s]) => n.toLowerCase().includes(favQ) || s.toLowerCase().includes(favQ))?.[0] || null : null;
  // matchday 12: Friday evening done, Saturday 15:30 live, Saturday 18:30 and Sunday still to come
  const slots = [-26 * 60, -45, -45, -45, -45, -45, 135, 22 * 60, 24 * 60];
  const pairs = [[2, 13], [1, 9], [0, 7], [4, 12], [6, 16], [10, 17], [5, 3], [11, 14], [8, 15]];
  const scores = [[3, 1], [2, 1], [1, 1], [0, 2], [1, 0], [2, 2], null, null, null];
  const matches = pairs.map(([h, a], i) => {
    const start = addMin(now, slots[i]);
    const state = slots[i] <= -150 ? 'finished' : slots[i] <= 0 ? 'live' : 'scheduled';
    return {
      id: 77000 + i,
      start: iso(start),
      state,
      home: team(h, favName),
      away: team(a, favName),
      score: scores[i],
      half: state === 'finished' ? [1, 0] : null,
      pens: null,
      aet: false,
      group: '12. Spieltag',
    };
  });
  const result = {
    league: { shortcut: 'bl1', name: '1. Fußball-Bundesliga 2026/2027', season: 2026, id: 5000, cup: false },
    favorite: favName ? (({ name, short, icon }) => ({ name, short, icon }))(team(TEAMS.findIndex((x) => x[0] === favName))) : null,
    favoriteNotFound: !!settings.favoriteTeam && !favName,
    onlyMyTeam: false,
  };
  if (settings.showMatchday) result.matchday = { name: 'Spieltag 12', order: 12, matches };
  if (settings.showTable) {
    const count = long ? 18 : Number(settings.tableRows) || 6;
    const rows = TEAMS.map((_, i) => {
      const played = 11;
      const pts = 29 - Math.round(i * 1.4);
      const won = Math.floor(pts / 3);
      const draw = Math.min(played - won, pts - won * 3);
      const lost = played - won - draw;
      const goals = 30 - i;
      const against = 8 + i;
      return { pos: i + 1, ...team(i, favName), played, won, draw, lost: Math.max(0, lost), goals, against, diff: goals - against, points: long ? won * 3 + draw + 100 : won * 3 + draw };
    });
    result.table = { rows: rows.slice(0, count), total: 18 };
  }
  if (settings.showNext) {
    const nextCount = long ? 10 : Number(settings.nextCount) || 3;
    result.next = Array.from({ length: nextCount }, (_, i) => {
      const [h, a] = [(i * 5) % 18, (i * 5 + 7) % 18];
      return { id: 78000 + i, start: iso(addMin(now, 7 * 24 * 60 + i * 150)), state: 'scheduled', home: team(h, favName), away: team(a, favName), score: null, half: null, pens: null, aet: false, group: '13. Spieltag' };
    });
  }
  result.live = matches.some((m) => m.state === 'live');
  return result;
};
