// Shared module/page/layout schema – used by the server (defaults, validation,
// secret stripping) and by the admin panel (form generation).
// Labels are English message ids; translations live in ./locales/.

import { translator, langOf } from './i18n.js';
import { locationFields } from './fields.js';
import { normalizeSchedule, normalizePageOptions } from './schedule.js';
import PLUGIN_MODULES from './modules/index.js';

export const DEFAULT_LOCALE = 'en-GB';

export const REGIONS = [
  { id: 'top_bar', label: 'Top – full width' },
  { id: 'top_left', label: 'Top left' },
  { id: 'top_center', label: 'Top center' },
  { id: 'top_right', label: 'Top right' },
  { id: 'middle_left', label: 'Middle left' },
  { id: 'middle_center', label: 'Center' },
  { id: 'middle_right', label: 'Middle right' },
  { id: 'bottom_left', label: 'Bottom left' },
  { id: 'bottom_center', label: 'Bottom center' },
  { id: 'bottom_right', label: 'Bottom right' },
  { id: 'bottom_bar', label: 'Bottom – full width' },
  { id: 'fullscreen', label: 'Fullscreen background' },
];
const REGION_IDS = new Set(REGIONS.map((r) => r.id));

export const EFA_PRESETS = [
  { value: 'vvs', label: 'VVS Stuttgart', url: 'https://www3.vvs.de/mngvvs/' },
  { value: 'bw', label: 'Baden-Württemberg (bwegt / NVBW)', url: 'https://www.efa-bw.de/nvbw/' },
  { value: 'mvv', label: 'MVV Munich', url: 'https://efa.mvv-muenchen.de/ng/' },
  { value: 'bayern', label: 'Bavaria (bahnland bayern)', url: 'https://bahnland-bayern.de/efa/' },
  { value: 'vgn', label: 'VGN Nuremberg', url: 'https://efa.vgn.de/vgnExt_oeffi/' },
  { value: 'vrr', label: 'VRR / NRW', url: 'https://efa.vrr.de/vrr/' },
  { value: 'sachsen', label: 'Saxony (VVO – incl. Leipzig/MDV, Dresden, Chemnitz)', url: 'https://efa.vvo-online.de/VMSSL3/' },
  { value: 'custom', label: 'Custom EFA URL', url: '' },
];

export const TRANSIT_CATEGORIES = [
  { value: 'train', label: 'Train (RE/RB/IC/ICE)' },
  { value: 'sbahn', label: 'S-Bahn' },
  { value: 'ubahn', label: 'Subway' },
  { value: 'tram', label: 'Tram / light rail' },
  { value: 'bus', label: 'Bus' },
  { value: 'ferry', label: 'Ferry' },
  { value: 'other', label: 'Other' },
];

export function transitBaseUrl(s) {
  if (s.provider === 'hafas') return (s.baseUrl || '').replace(/\/+$/, '');
  const preset = EFA_PRESETS.find((p) => p.value === s.efaPreset);
  let url = preset && preset.value !== 'custom' ? preset.url : s.baseUrl || '';
  if (url && !url.endsWith('/')) url += '/';
  return url;
}

export { CALENDAR_ICONS } from './calendar-icons.js';


// Keywords cover German and English collection calendars.
const defaultWasteTypes = (t) => [
  { name: t('General waste'), keywords: 'rest, restmüll, hausmüll, restabfall, general, residual, refuse, rubbish', color: '#9ca3af', enabled: true },
  { name: t('Organic waste'), keywords: 'bio, organic, food, compost', color: '#a16207', enabled: true },
  { name: t('Paper'), keywords: 'papier, pappe, altpapier, blaue, paper, cardboard', color: '#3b82f6', enabled: true },
  { name: t('Recycling (yellow bag)'), keywords: 'gelb, verpackung, wertstoff, leichtverpackung, lvp, recycling, packaging, plastic', color: '#facc15', enabled: true },
  { name: t('Glass'), keywords: 'glas, glass', color: '#22c55e', enabled: true },
  { name: t('Garden waste'), keywords: 'grün, grünschnitt, baum, garten, garden, green', color: '#4ade80', enabled: true },
  { name: t('Bulky waste'), keywords: 'sperr, bulky', color: '#c084fc', enabled: true },
  { name: t('Hazardous waste'), keywords: 'schadstoff, problemstoff, hazardous', color: '#ef4444', enabled: true },
];

export const MODULE_TYPES = {
  clock: {
    label: 'Clock & date',
    description: 'Time, date and week number',
    defaultRegion: 'top_left',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'format24', label: '24-hour format', type: 'bool', default: true },
      { key: 'showSeconds', label: 'Show seconds', type: 'bool', default: true },
      { key: 'showDate', label: 'Show date', type: 'bool', default: true },
      { key: 'dateStyle', label: 'Date format', type: 'select', default: 'full', options: [
        { value: 'full', label: 'Saturday, 24 October 2026' },
        { value: 'long', label: '24 October 2026' },
        { value: 'medium', label: '24/10/2026' },
      ] },
      { key: 'showWeek', label: 'Show week number', type: 'bool', default: true },
      { key: 'size', label: 'Size', type: 'select', default: 'large', options: [
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }, { value: 'huge', label: 'Huge' },
      ] },
      { key: 'style', label: 'Clock style', type: 'select', default: 'digital', options: [
        { value: 'digital', label: 'Digital' }, { value: 'analog', label: 'Analog' }, { value: 'word', label: 'Word clock' }, { value: 'analogDigital', label: 'Analog + digital' },
      ] },
      { key: 'analogFace', label: 'Clock face', type: 'select', default: 'ticks', help: 'Analog styles only', options: [
        { value: 'minimal', label: 'Minimal' }, { value: 'ticks', label: 'Tick marks' }, { value: 'numbers', label: 'Numbers' }, { value: 'roman', label: 'Roman numerals' },
      ] },
      { key: 'showSecondHand', label: 'Second hand', type: 'bool', default: true, help: 'Analog styles only' },
      { key: 'wordStyle', label: 'Word clock layout', type: 'select', default: 'sentence', showIf: { style: 'word' }, options: [
        { value: 'sentence', label: 'Sentence' }, { value: 'grid', label: 'Letter grid' },
      ] },
      { key: 'wordDialect', label: 'Quarter hours (German)', type: 'select', default: 'standard', showIf: { style: 'word' }, options: [
        { value: 'standard', label: 'viertel nach drei / viertel vor vier' }, { value: 'east', label: 'viertel vier / dreiviertel vier (East German)' },
      ] },
    ],
  },

  weather: {
    label: 'Weather',
    description: 'Current weather, hourly and daily forecast (Open-Meteo)',
    defaultRegion: 'top_right',
    defaultTitle: '',
    refresh: 600,
    fields: [
      ...locationFields,
      { key: 'showCurrent', label: 'Current weather', type: 'bool', default: true },
      { key: 'showDetails', label: 'Feels like, wind & humidity', type: 'bool', default: true },
      { key: 'showSun', label: 'Sunrise and sunset', type: 'bool', default: true },
      { key: 'showHourly', label: 'Hourly forecast', type: 'bool', default: true },
      { key: 'hourlyCount', label: 'Number of hours', type: 'number', default: 6, min: 1, max: 24 },
      { key: 'hourlyStep', label: 'Hour step', type: 'number', default: 2, min: 1, max: 6 },
      { key: 'forecastDays', label: 'Forecast days (0 = off)', type: 'number', default: 5, min: 0, max: 7 },
      { key: 'units', label: 'Units', type: 'select', default: 'metric', options: [
        { value: 'metric', label: '°C, km/h, mm' }, { value: 'imperial', label: '°F, mph, inch' },
      ] },
      { key: 'layout', label: 'Layout', type: 'select', default: 'detailed', options: [
        { value: 'detailed', label: 'Detailed' }, { value: 'compact', label: 'Compact' },
      ] },
      { key: 'extras', label: 'Additional values', type: 'multiselect', default: ['uv', 'windDirection'], options: [
        { value: 'uv', label: 'UV index (now and today\'s maximum)' },
        { value: 'precipitation', label: 'Precipitation today (amount & probability)' },
        { value: 'windDirection', label: 'Wind direction' },
        { value: 'gusts', label: 'Wind gusts' },
        { value: 'pressure', label: 'Air pressure' },
        { value: 'visibility', label: 'Visibility' },
        { value: 'dewPoint', label: 'Dew point' },
        { value: 'cloudCover', label: 'Cloud cover' },
        { value: 'sunshine', label: 'Sunshine duration today' },
      ] },
      { key: 'airQuality', label: 'Air quality (European AQI)', type: 'bool', default: false },
      { key: 'pollen', label: 'Pollen (Europe only)', type: 'multiselect', default: [], options: [
        { value: 'alder', label: 'Alder' }, { value: 'birch', label: 'Birch' }, { value: 'grass', label: 'Grass' },
        { value: 'mugwort', label: 'Mugwort' }, { value: 'ragweed', label: 'Ragweed' },
      ] },
      { key: 'chartStyle', label: 'Hourly forecast display', type: 'select', default: 'icons', options: [
        { value: 'icons', label: 'Icons' },
        { value: 'line', label: 'Temperature curve' },
        { value: 'lineBars', label: 'Temperature curve + precipitation bars' },
      ] },
      { key: 'chartBars', label: 'Bars show', type: 'select', default: 'probability', showIf: { chartStyle: 'lineBars' }, options: [
        { value: 'probability', label: 'Precipitation probability' }, { value: 'amount', label: 'Precipitation amount' },
      ] },
      { key: 'dailyStyle', label: 'Daily forecast display', type: 'select', default: 'table', options: [
        { value: 'table', label: 'Table' }, { value: 'bars', label: 'Temperature range bars' },
      ] },
      { key: 'dailyUv', label: 'UV index per forecast day', type: 'bool', default: false },
      { key: 'animation', label: 'Animated weather icons', type: 'select', default: 'subtle', options: [
        { value: 'off', label: 'Off' },
        { value: 'subtle', label: 'Subtle (current weather only)' },
        { value: 'full', label: 'Full (all icons)' },
      ] },
      { key: 'animatedBackground', label: 'Background effect for rain & snow', type: 'bool', default: false, showIf: { animation: 'full' } },
    ],
  },

  weather_hints: {
    label: 'Weather hints',
    description: 'Umbrella, sunscreen, frost, heat, storm & DWD warnings',
    defaultRegion: 'top_center',
    defaultTitle: '',
    refresh: 600,
    fields: [
      ...locationFields,
      { key: 'lookaheadHours', label: 'Look-ahead (hours)', type: 'number', default: 12, min: 1, max: 48 },
      { key: 'rain', label: 'Rain → "Don\'t forget your umbrella"', type: 'bool', default: true },
      { key: 'rainProbability', label: 'Rain probability from (%)', type: 'number', default: 50, min: 0, max: 100, showIf: { rain: true } },
      { key: 'rainMinMm', label: 'Minimum amount per hour (mm)', type: 'number', default: 0.3, min: 0, max: 20, step: 0.1, showIf: { rain: true } },
      { key: 'uv', label: 'UV index → "Don\'t forget sunscreen"', type: 'bool', default: true },
      { key: 'uvThreshold', label: 'UV index from', type: 'number', default: 5, min: 1, max: 12, showIf: { uv: true } },
      { key: 'snow', label: 'Snowfall', type: 'bool', default: true },
      { key: 'frost', label: 'Frost / ice', type: 'bool', default: true },
      { key: 'frostTemp', label: 'Frost hint at (°C) and below', type: 'number', default: 1, min: -20, max: 10, showIf: { frost: true } },
      { key: 'heat', label: 'Heat', type: 'bool', default: true },
      { key: 'heatTemp', label: 'Heat hint from (°C)', type: 'number', default: 30, min: 20, max: 45, showIf: { heat: true } },
      { key: 'wind', label: 'Storm gusts', type: 'bool', default: true },
      { key: 'windGust', label: 'Gusts from (km/h)', type: 'number', default: 60, min: 20, max: 150, showIf: { wind: true } },
      { key: 'dwdWarnings', label: 'Official DWD warnings (Germany only)', type: 'bool', default: true },
      { key: 'showWhenNone', label: 'Show a positive message in good weather', type: 'bool', default: false },
    ],
  },

  // calendar: plug-in module, see ./modules/calendar.js

  waste: {
    label: 'Waste calendar',
    description: 'Collection dates from an iCal file or fixed intervals',
    defaultRegion: 'middle_right',
    defaultTitle: 'Waste collection',
    refresh: 3600,
    fields: [
      { key: 'service', label: 'Find by town / address (no iCal needed)', type: 'wasteService', default: null, secret: true, help: 'Search your town or waste management company, enter your address and test it. Needs the optional "waste" service (installer question or COMPOSE_PROFILES=waste). Collection types are mapped onto the waste types below via their keywords.' },
      { key: 'sources', label: 'iCal sources (from your waste management company)', type: 'list', itemLabel: 'Source', default: [], fields: [
        { key: 'name', label: 'Name', type: 'text', default: 'Abfuhrkalender' },
        { key: 'url', label: 'iCal URL', type: 'text', default: '', secret: true },
      ] },
      { key: 'manual', label: 'Fixed intervals (without iCal)', type: 'list', itemLabel: 'Interval', default: [], fields: [
        { key: 'type', label: 'Waste type (name as below)', type: 'text', default: 'General waste' },
        { key: 'startDate', label: 'First date', type: 'date', default: '' },
        { key: 'intervalWeeks', label: 'Every x weeks', type: 'number', default: 2, min: 1, max: 52 },
      ] },
      { key: 'types', label: 'Waste types & colors', type: 'list', itemLabel: 'Waste type', default: defaultWasteTypes, fields: [
        { key: 'name', label: 'Name', type: 'text', default: '' },
        { key: 'keywords', label: 'Keywords in entry (comma-separated)', type: 'text', default: '' },
        { key: 'color', label: 'Color', type: 'color', default: '#9ca3af' },
        { key: 'enabled', label: 'Show', type: 'bool', default: true },
      ] },
      { key: 'daysAhead', label: 'Days ahead', type: 'number', default: 21, min: 1, max: 120 },
      { key: 'maxEntries', label: 'Max. collection days', type: 'number', default: 4, min: 1, max: 20 },
      { key: 'showUnknown', label: 'Show unmatched entries', type: 'bool', default: true },
      { key: 'reminderHour', label: '"Put the bin out today" reminder from hour (day before)', type: 'number', default: 15, min: 0, max: 23 },
    ],
  },

  f1: {
    label: 'Formula 1',
    description: 'Next race with sessions, countdown, track weather & standings',
    defaultRegion: 'middle_left',
    defaultTitle: 'Formula 1',
    refresh: 1800,
    fields: [
      { key: 'showCountdown', label: 'Countdown', type: 'bool', default: true },
      { key: 'showSessions', label: 'Schedule of all sessions', type: 'bool', default: true },
      { key: 'showTrackMap', label: 'Track layout', type: 'bool', default: true },
      { key: 'trackMapSize', label: 'Size of the track layout', type: 'select', default: 'medium', options: [
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
      ], showIf: { showTrackMap: true } },
      { key: 'showTrackWeather', label: 'Track weather (race day)', type: 'bool', default: true },
      { key: 'showPreviousWinner', label: 'Last year\'s winner', type: 'bool', default: true },
      { key: 'showLastRace', label: 'Last race podium', type: 'bool', default: true },
      { key: 'showDriverStandings', label: 'Driver standings', type: 'bool', default: true },
      { key: 'showConstructorStandings', label: 'Constructor standings', type: 'bool', default: false },
      { key: 'standingsCount', label: 'Standings entries', type: 'number', default: 5, min: 1, max: 22 },
      { key: 'favoriteDrivers', label: 'Highlight favorite drivers (codes, e.g. VER, HAM)', type: 'text', default: '' },
      { key: 'layout', label: 'Layout', type: 'select', default: 'full', options: [
        { value: 'full', label: 'Full' }, { value: 'compact', label: 'Compact (one or two lines)' },
      ], help: 'Compact shows only the race, the next session with countdown and the leader while a session is live – for small areas.' },
      { key: 'liveTiming', label: 'Live positions during a session', type: 'bool', default: true,
        help: 'From OpenF1 (free). Real-time data during a session is reserved for OpenF1 sponsors – without it the classification appears about 30 minutes after the session ends (marked as delayed).' },
      { key: 'liveCount', label: 'Positions shown (live / qualifying)', type: 'number', default: 10, min: 1, max: 22 },
      { key: 'showQualifying', label: 'Qualifying / sprint result of the weekend', type: 'bool', default: true },
      { key: 'trackTime', label: 'Session times in track time', type: 'select', default: 'off', options: [
        { value: 'off', label: 'Off' }, { value: 'beside', label: 'Beside the local time' }, { value: 'only', label: 'Track time only' },
      ] },
      { key: 'showTrackInfo', label: 'Track info (laps, distance, lap record)', type: 'bool', default: true },
    ],
  },

  transit: {
    label: 'Public transport',
    description: 'Live departure board for a stop (EFA networks or HAFAS-REST)',
    defaultRegion: 'bottom_left',
    defaultTitle: 'Departures',
    refresh: 30,
    fields: [
      { key: 'provider', label: 'Provider', type: 'select', default: 'efa', options: [
        { value: 'efa', label: 'EFA (transit association)' }, { value: 'hafas', label: 'HAFAS-REST (e.g. db-rest / transport.rest)' },
      ] },
      { key: 'efaPreset', label: 'Transit network', type: 'select', default: 'vvs', options: EFA_PRESETS.map(({ value, label }) => ({ value, label })), showIf: { provider: 'efa' },
        help: 'Most networks also find stops all over Germany, but real-time data usually only comes from the network of your region.' },
      { key: 'baseUrl', label: 'Base URL', type: 'text', default: '', placeholder: 'https://v6.vbb.transport.rest', showIf: { _transitCustom: true },
        help: 'HAFAS-REST: e.g. https://v6.vbb.transport.rest (Berlin/Brandenburg) or your own db-rest instance. The public v6.db.transport.rest has been shut down. Outside Berlin, EFA is usually the better choice.' },
      { key: 'stop', label: 'Stop', type: 'transitStop', default: null },
      { key: 'limit', label: 'Number of departures', type: 'number', default: 8, min: 1, max: 30 },
      { key: 'walkMinutes', label: 'Walk to stop (min., hide earlier departures)', type: 'number', default: 0, min: 0, max: 60 },
      { key: 'categories', label: 'Modes of transport', type: 'multiselect', default: TRANSIT_CATEGORIES.map((c) => c.value), options: TRANSIT_CATEGORIES },
      { key: 'lines', label: 'Only these lines (comma-separated, empty = all)', type: 'text', default: '' },
      { key: 'excludeDestinations', label: 'Hide destinations (comma-separated)', type: 'text', default: '' },
      { key: 'timeMode', label: 'Time display', type: 'select', default: 'relative', options: [
        { value: 'relative', label: 'in x min' }, { value: 'absolute', label: 'Time' }, { value: 'both', label: 'Both' },
      ] },
      { key: 'showPlatform', label: 'Show platform', type: 'bool', default: true },
      { key: 'showDelay', label: 'Show delay', type: 'bool', default: true },
      { key: 'goNow', label: 'Leave-now indicator', type: 'bool', default: false, help: 'Traffic light based on the walking time to the stop' },
      { key: 'bufferMinutes', label: 'Buffer (min.)', type: 'number', default: 2, min: 0, max: 30, showIf: { goNow: true } },
      { key: 'rushMinutes', label: 'Time saved by hurrying (min.)', type: 'number', default: 3, min: 0, max: 30, showIf: { goNow: true } },
      { key: 'hideUnreachable', label: 'Hide unreachable departures', type: 'bool', default: true, showIf: { goNow: true } },
      { key: 'goNowStyle', label: 'Indicator style', type: 'select', default: 'dot', showIf: { goNow: true }, options: [
        { value: 'dot', label: 'Coloured dot' }, { value: 'row', label: 'Tinted row' }, { value: 'banner', label: 'Banner above the table' },
      ] },
      { key: 'goNowLines', label: 'Banner: only these lines (comma-separated, empty = all)', type: 'text', default: '', showIf: { goNow: true, goNowStyle: 'banner' } },
    ],
  },

  flights: {
    label: 'Aircraft map',
    description: 'Live map of nearby aircraft (own ADS-B stick or adsb.lol)',
    defaultRegion: 'middle_center',
    defaultTitle: 'Airspace',
    refresh: 5,
    fields: [
      { key: 'source', label: 'Data source', type: 'select', default: 'adsblol', options: [
        { value: 'local', label: 'Own ADS-B receiver (readsb / ultrafeeder)' },
        { value: 'adsblol', label: 'adsb.lol (online, no stick)' },
        { value: 'airplaneslive', label: 'airplanes.live (online, no stick)' },
      ] },
      { key: 'localUrl', label: 'aircraft.json URL', type: 'text', default: 'http://ultrafeeder/data/aircraft.json', showIf: { source: 'local' } },
      ...locationFields,
      { key: 'display', label: 'Display', type: 'select', default: 'map', options: [
        { value: 'map', label: 'Map with all aircraft' },
        { value: 'nearest', label: 'Nearest aircraft (photo, route, map)' },
        { value: 'both', label: 'Map with all aircraft + nearest aircraft' },
      ] },
      { key: 'radiusKm', label: 'Radius (km)', type: 'number', default: 40, min: 5, max: 400 },
      { key: 'zoom', label: 'Zoom level', type: 'number', default: 9, min: 4, max: 14 },
      { key: 'height', label: 'Map height (% of screen height, 0 = fit to free space)', type: 'number', default: 0, min: 0, max: 100 },
      { key: 'refreshSeconds', label: 'Refresh (sec.)', type: 'number', default: 5, min: 2, max: 600,
        help: 'Applies to your own receiver. Online sources are updated at most every 3 minutes (adsb.lol allows about 500 requests per day) – for a live map use your own ADS-B stick.' },
      { key: 'maxAltitudeFt', label: 'Max. altitude (ft, 0 = all)', type: 'number', default: 0, min: 0, max: 60000 },
      { key: 'showLabels', label: 'Callsigns on the map', type: 'bool', default: true },
      { key: 'showRings', label: 'Range rings', type: 'bool', default: true },
      { key: 'showList', label: 'List of nearest aircraft', type: 'bool', default: true },
      { key: 'listCount', label: 'Entries in list', type: 'number', default: 5, min: 1, max: 20 },
      { key: 'units', label: 'Units', type: 'select', default: 'ft_kmh', options: [
        { value: 'ft_kmh', label: 'ft, km/h, km' }, { value: 'metric', label: 'm, km/h, km' },
        { value: 'aviation', label: 'ft, kt, NM' }, { value: 'imperial', label: 'ft, mph, mi' },
      ] },
      { key: 'spotAirborneOnly', label: 'Nearest aircraft: only airborne', type: 'bool', default: true },
      { key: 'spotMinAltitudeFt', label: 'Nearest aircraft: min. altitude (ft, 0 = any)', type: 'number', default: 0, min: 0, max: 40000 },
      { key: 'spotRequireCallsign', label: 'Nearest aircraft: ignore aircraft without callsign', type: 'bool', default: false },
      { key: 'showRoute', label: 'Nearest aircraft: route (adsb.lol)', type: 'bool', default: true },
      { key: 'showPhoto', label: 'Nearest aircraft: photo (planespotters.net)', type: 'bool', default: true },
      { key: 'showSquawk', label: 'Nearest aircraft: squawk', type: 'bool', default: false },
      { key: 'trailLength', label: 'Nearest aircraft: track trail (positions, 0 = off)', type: 'number', default: 20, min: 0, max: 120 },
      { key: 'tiles', label: 'Map style', type: 'select', default: 'esri_dark', options: [
        { value: 'esri_dark', label: 'Dark (Esri Dark Gray)' }, { value: 'osm_dark', label: 'OpenStreetMap dark' }, { value: 'osm', label: 'OpenStreetMap light' }, { value: 'custom', label: 'Custom tile URL' },
      ] },
      { key: 'tileUrl', label: 'Tile URL ({z}/{x}/{y})', type: 'text', default: '', placeholder: 'https://tile.example.com/{z}/{x}/{y}.png', showIf: { tiles: 'custom' } },
    ],
  },

  camera: {
    label: 'Camera (RTSP)',
    description: 'RTSP camera streams via go2rtc – live video or snapshot',
    defaultRegion: 'bottom_right',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'streams', label: 'Streams', type: 'list', itemLabel: 'Stream', default: [], fields: [
        { key: 'name', label: 'Name', type: 'text', default: 'Kamera' },
        { key: 'url', label: 'RTSP URL', type: 'text', default: '', secret: true, placeholder: 'rtsp://user:pass@192.168.1.20:554/stream2' },
        { key: 'enabled', label: 'Enabled', type: 'bool', default: true },
      ] },
      { key: 'mode', label: 'Mode', type: 'select', default: 'snapshot', options: [
        { value: 'snapshot', label: 'Snapshot (easy on the Raspberry Pi)' }, { value: 'live', label: 'Live video (MSE/WebRTC)' },
      ] },
      { key: 'refreshSeconds', label: 'Snapshot refresh (sec.)', type: 'number', default: 5, min: 1, max: 600, showIf: { mode: 'snapshot' } },
      { key: 'width', label: 'Width (% of column)', type: 'number', default: 70, min: 20, max: 100 },
      { key: 'columns', label: 'Columns', type: 'number', default: 1, min: 1, max: 4 },
      { key: 'showName', label: 'Show names', type: 'bool', default: true },
    ],
  },

  greeting: {
    label: 'Greeting',
    description: 'Rotating messages depending on the time of day',
    defaultRegion: 'bottom_center',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'name', label: 'Name (for {name})', type: 'text', default: '' },
      { key: 'morning', label: 'Morning (5–11 am), one line per message', type: 'textarea', default: (t) => t('Good morning{name}!\nHave a great day!\nHad your coffee yet?') },
      { key: 'afternoon', label: 'Afternoon (11 am–5 pm)', type: 'textarea', default: (t) => t('Good afternoon{name}!\nHalfway there – keep it up!') },
      { key: 'evening', label: 'Evening (5–10 pm)', type: 'textarea', default: (t) => t('Good evening{name}!\nTime to relax.\nNice to see you.') },
      { key: 'night', label: 'Night (10 pm–5 am)', type: 'textarea', default: (t) => t('Good night{name}!\nSleep well.') },
      { key: 'intervalSeconds', label: 'Change every (sec.)', type: 'number', default: 60, min: 5, max: 3600 },
      { key: 'size', label: 'Size', type: 'select', default: 'large', options: [
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
      ] },
    ],
  },

  text: {
    label: 'Free text',
    description: 'Custom text, note or Wi-Fi info',
    defaultRegion: 'bottom_bar',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'content', label: 'Text', type: 'textarea', default: '' },
      { key: 'align', label: 'Alignment', type: 'select', default: 'center', options: [
        { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' },
      ] },
      { key: 'size', label: 'Size', type: 'select', default: 'medium', options: [
        { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
      ] },
    ],
  },
};

for (const { type, ...schema } of PLUGIN_MODULES) MODULE_TYPES[type] = schema;

export const GENERAL_FIELDS = [
  { key: 'name', label: 'Mirror name', type: 'text', default: 'Magic Mirror' },
  { key: 'location', label: 'Location (weather, flights, …)', type: 'location', default: { name: 'Berlin', lat: 52.52, lon: 13.405 } },
  { key: 'timezone', label: 'Time zone', type: 'text', default: 'Europe/Berlin' },
  { key: 'locale', label: 'Language & format', type: 'select', default: DEFAULT_LOCALE, options: [
    { value: 'de-DE', label: 'Deutsch (Deutschland)' }, { value: 'de-AT', label: 'Deutsch (Österreich)' }, { value: 'de-CH', label: 'Deutsch (Schweiz)' }, { value: 'en-GB', label: 'English (UK)' }, { value: 'en-US', label: 'English (US)' },
  ] },
  { key: 'rotatePages', label: 'Rotate pages automatically', type: 'bool', default: true },
  { key: 'pageIndicator', label: 'Show page indicator', type: 'bool', default: true },
  { key: 'indicatorStyle', label: 'Page indicator style', type: 'select', default: 'dots', options: [
    { value: 'dots', label: 'Dots' }, { value: 'bar', label: 'Progress bar until the next page' }, { value: 'both', label: 'Dots and progress bar' },
  ], showIf: { pageIndicator: true } },
  { key: 'transition', label: 'Page transition', type: 'select', default: 'fade', options: [
    { value: 'fade', label: 'Fade' }, { value: 'slide', label: 'Slide' }, { value: 'none', label: 'None' },
  ] },
  { key: 'background', label: 'Background', type: 'color', default: '#000000' },
  { key: 'textColor', label: 'Text color', type: 'color', default: '#ffffff' },
  { key: 'accentColor', label: 'Accent color', type: 'color', default: '#7dd3fc' },
  { key: 'fontScale', label: 'Font size (factor)', type: 'number', default: 1, min: 0.5, max: 3, step: 0.05 },
  { key: 'padding', label: 'Margin (% of screen size)', type: 'number', default: 3, min: 0, max: 15, step: 0.5 },
  { key: 'rotation', label: 'Rotate screen', type: 'select', default: '0', options: [
    { value: '0', label: '0°' }, { value: '90', label: '90° (portrait)' }, { value: '180', label: '180°' }, { value: '270', label: '270° (portrait)' },
  ] },
  { key: 'showTitles', label: 'Show module titles', type: 'bool', default: true },
  { key: 'hideCursor', label: 'Hide mouse cursor', type: 'bool', default: true },
  { key: 'dimEnabled', label: 'Night mode (dimming)', type: 'bool', default: false },
  { key: 'dimFrom', label: 'Dim from', type: 'time', default: '23:00', showIf: { dimEnabled: true } },
  { key: 'dimTo', label: 'Dim until', type: 'time', default: '06:00', showIf: { dimEnabled: true } },
  { key: 'dimBrightness', label: 'Brightness at night (%)', type: 'number', default: 30, min: 0, max: 100, showIf: { dimEnabled: true } },
  { key: 'autoReloadHours', label: 'Reload page automatically every x hours (0 = never)', type: 'number', default: 12, min: 0, max: 168 },
];

export function uid(prefix = 'm') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const identity = (s) => s;

function coerce(field, value, t) {
  const def = typeof field.default === 'function' ? field.default(t) : field.default;
  if (value === undefined || value === null) {
    return field.type === 'location' || field.type === 'transitStop' ? (value === null ? null : clone(def)) : clone(def);
  }
  switch (field.type) {
    case 'bool': return value === true || value === 'true';
    case 'number': {
      let n = Number(value);
      if (!Number.isFinite(n)) n = def;
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      return n;
    }
    case 'select': return field.options.some((o) => o.value === String(value)) ? String(value) : def;
    case 'multiselect': return Array.isArray(value) ? value.filter((v) => field.options.some((o) => o.value === v)) : clone(def);
    case 'list': return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object').map((item) => applyDefaults(field.fields, item, t)) : clone(def);
    case 'location': {
      const lat = Number(value.lat), lon = Number(value.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { name: String(value.name || ''), lat, lon } : null;
    }
    case 'transitStop': return value.id ? { id: String(value.id), name: String(value.name || value.id) } : null;
    case 'wasteService': {
      if (typeof value !== 'object' || !/^[a-z0-9_]+$/.test(String(value.source || ''))) return null;
      const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? clone(o) : {});
      return { source: String(value.source), title: String(value.title || value.source), args: obj(value.args), labels: obj(value.labels) };
    }
    default: return String(value);
  }
}

export function applyDefaults(fields, values = {}, t = identity) {
  const out = {};
  for (const f of fields) out[f.key] = coerce(f, values[f.key], t);
  return out;
}

export function defaultModule(type, extra = {}, locale = DEFAULT_LOCALE) {
  const t = MODULE_TYPES[type];
  const tr = translator(langOf(locale));
  return {
    id: uid('m'),
    type,
    enabled: true,
    title: tr(t.defaultTitle),
    pages: ['*'],
    region: t.defaultRegion,
    order: 0,
    height: 'auto',
    schedule: normalizeSchedule(null),
    settings: applyDefaults(t.fields, {}, tr),
    ...extra,
  };
}

export function defaultConfig(locale = DEFAULT_LOCALE) {
  const t = translator(langOf(locale));
  const m = (type, region, pages, order, extra = {}) => {
    const mod = defaultModule(type, { region, pages, order, ...extra }, locale);
    mod.id = 'm_' + type;
    return mod;
  };
  return {
    version: 1,
    general: applyDefaults(GENERAL_FIELDS, { locale }, t),
    pages: [
      { id: 'home', name: t('Home'), duration: 45, enabled: true },
      { id: 'more', name: t('On the go'), duration: 25, enabled: true },
    ],
    modules: [
      m('clock', 'top_left', ['*'], 0),
      m('weather', 'top_right', ['*'], 0),
      m('weather_hints', 'top_center', ['*'], 0),
      m('calendar', 'middle_left', ['home'], 0),
      m('waste', 'middle_right', ['home'], 0),
      m('greeting', 'bottom_center', ['home'], 0),
      m('f1', 'middle_left', ['more'], 0),
      m('flights', 'middle_center', ['more'], 0),
      m('transit', 'middle_right', ['more'], 0, { enabled: false }),
      m('camera', 'bottom_right', ['more'], 0, { enabled: false }),
    ],
  };
}

// fallbackLocale decides the language of defaults when the input has none.
// Older configs had a "use global location" switch next to the location.
function migrateSettings(settings) {
  if (!settings || typeof settings !== 'object' || !('useGlobalLocation' in settings)) return settings || {};
  const { useGlobalLocation, ...rest } = settings;
  return useGlobalLocation === false ? rest : { ...rest, location: null };
}

export function normalizeConfig(input, fallbackLocale = DEFAULT_LOCALE) {
  const c = input && typeof input === 'object' ? input : {};
  const d = defaultConfig(c.general?.locale || fallbackLocale);
  const tr = translator(langOf(d.general.locale));
  const general = applyDefaults(GENERAL_FIELDS, { ...d.general, ...(c.general || {}) }, tr);

  const seen = new Set();
  let pages = (Array.isArray(c.pages) && c.pages.length ? c.pages : d.pages)
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      let id = String(p.id || uid('p')).replace(/[^\w-]/g, '_');
      while (seen.has(id) || id === '*') id = uid('p');
      seen.add(id);
      const duration = Math.min(3600, Math.max(5, Number(p.duration) || 30));
      return { id, name: String(p.name || tr('Page')), duration, enabled: p.enabled !== false, ...normalizePageOptions(p) };
    });
  if (!pages.length) pages = d.pages;
  const pageIds = new Set(pages.map((p) => p.id));

  const seenMods = new Set();
  const modules = (Array.isArray(c.modules) ? c.modules : d.modules)
    .filter((m) => m && MODULE_TYPES[m.type])
    .map((m, i) => {
      const t = MODULE_TYPES[m.type];
      let id = String(m.id || uid('m')).replace(/[^\w-]/g, '_');
      while (seenMods.has(id)) id = uid('m');
      seenMods.add(id);
      let mp = Array.isArray(m.pages) ? m.pages.filter((p) => p === '*' || pageIds.has(p)) : ['*'];
      if (mp.includes('*')) mp = ['*'];
      if (!mp.length) mp = [pages[0].id];
      return {
        id,
        type: m.type,
        enabled: m.enabled !== false,
        title: typeof m.title === 'string' ? m.title : tr(t.defaultTitle),
        pages: mp,
        region: REGION_IDS.has(m.region) ? m.region : t.defaultRegion,
        order: Number.isFinite(Number(m.order)) ? Number(m.order) : i,
        // "fill" = take all free space in its column (extends into empty areas below/above)
        height: m.height === 'fill' ? 'fill' : 'auto',
        schedule: normalizeSchedule(m.schedule),
        settings: applyDefaults(t.fields, migrateSettings(m.settings), tr),
      };
    });

  return { version: 1, general, pages, modules, updatedAt: c.updatedAt || null };
}

function stripFields(fields, values) {
  for (const f of fields) {
    if (f.secret) delete values[f.key];
    else if (f.type === 'list' && Array.isArray(values[f.key])) values[f.key].forEach((item) => stripFields(f.fields, item));
  }
}

// Config for the (unauthenticated) mirror – without URLs/credentials.
export function publicConfig(cfg) {
  const c = clone(cfg);
  for (const m of c.modules) stripFields(MODULE_TYPES[m.type].fields, m.settings);
  return c;
}

export function resolveLocation(settings, general) {
  if (settings?.location) return settings.location;
  return general.location || { name: '', lat: 52.52, lon: 13.405 };
}
