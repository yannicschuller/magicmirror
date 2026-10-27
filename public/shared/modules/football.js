// Football (soccer) – Bundesliga & more via OpenLigaDB (free, no API key).

export const FOOTBALL_LEAGUES = [
  { value: 'bl1', label: '1. Bundesliga' },
  { value: 'bl2', label: '2. Bundesliga' },
  { value: 'bl3', label: '3. Liga' },
  { value: 'dfb', label: 'DFB-Pokal' },
  { value: 'custom', label: 'Other league (OpenLigaDB shortcut)' },
];

export default {
  type: 'football',
  label: 'Football',
  description: 'Bundesliga & more: live scores, fixtures and table (OpenLigaDB)',
  defaultRegion: 'middle_right',
  defaultTitle: 'Bundesliga',
  // The mirror polls every minute; the server caches 5 min (60 s during live games).
  refresh: 60,
  fields: [
    { key: 'league', label: 'League', type: 'select', default: 'bl1', options: FOOTBALL_LEAGUES },
    { key: 'customLeague', label: 'League shortcut', type: 'text', default: '', placeholder: 'e.g. pl, la1, ucl', showIf: { league: 'custom' } },
    { key: 'season', label: 'Season (start year, 0 = current)', type: 'number', default: 0, min: 0, max: 2100 },
    { key: 'favoriteTeam', label: 'Favorite team (highlighted)', type: 'text', default: '', placeholder: 'e.g. VfB Stuttgart' },
    { key: 'onlyMyTeam', label: 'Only my team (last result, next match, table position)', type: 'bool', default: false },
    { key: 'showMatchday', label: 'Current matchday (results & fixtures)', type: 'bool', default: true },
    { key: 'maxMatches', label: 'Max. matches shown', type: 'number', default: 9, min: 1, max: 40, showIf: { showMatchday: true } },
    { key: 'showTable', label: 'League table', type: 'bool', default: true },
    { key: 'tableRows', label: 'Table rows', type: 'number', default: 6, min: 1, max: 20, showIf: { showTable: true } },
    { key: 'showNext', label: 'Upcoming matches (of my team, if set)', type: 'bool', default: false },
    { key: 'nextCount', label: 'Number of upcoming matches', type: 'number', default: 3, min: 1, max: 10, showIf: { showNext: true } },
    { key: 'showLogos', label: 'Team logos', type: 'bool', default: false },
    { key: 'grayscaleLogos', label: 'Logos in grayscale', type: 'bool', default: true, showIf: { showLogos: true } },
  ],
};
