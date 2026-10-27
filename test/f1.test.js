import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveSessionAt, parseLive, parseSessionResult, parseQualifying, parseSprint, trackTimeParts, trackInfo, f1 } from '../src/providers/f1.js';
import { computeLaps, TRACKS } from '../src/providers/f1-tracks.js';
import { MODULE_TYPES } from '../public/shared/modules.js';
import de from '../public/shared/locales/de/f1.js';
import deAll from '../public/shared/locales/de/index.js';

// ---- recorded fixtures (trimmed real answers, captured 2026-10-27) -----------------
// OpenF1, 2026 United States GP race (session 11396), around 21:05 UTC (lap 37).
const POSITION = [
  { date: '2026-10-25T19:07:03.047000+00:00', position: 1, driver_number: 12 },
  { date: '2026-10-25T19:07:03.047000+00:00', position: 2, driver_number: 3 },
  { date: '2026-10-25T19:07:03.047000+00:00', position: 4, driver_number: 16 },
  { date: '2026-10-25T19:07:03.047000+00:00', position: 5, driver_number: 44 },
  { date: '2026-10-25T20:56:34.746000+00:00', position: 3, driver_number: 44 },
  { date: '2026-10-25T20:56:41.150000+00:00', position: 5, driver_number: 3 },
  { date: '2026-10-25T20:57:29.149000+00:00', position: 1, driver_number: 12 },
  { date: '2026-10-25T20:57:29.149000+00:00', position: 2, driver_number: 16 },
];
const INTERVALS = [
  { date: '2026-10-25T21:04:50.918000+00:00', driver_number: 44, gap_to_leader: 8.518, interval: 5.854 },
  { date: '2026-10-25T21:04:53.496000+00:00', driver_number: 16, gap_to_leader: 2.731, interval: 2.731 },
  { date: '2026-10-25T21:04:58.324000+00:00', driver_number: 3, gap_to_leader: 17.208, interval: 3.848 },
  { date: '2026-10-25T21:04:59.355000+00:00', driver_number: 44, gap_to_leader: 8.543, interval: 5.812 },
  { date: '2026-10-25T21:04:59.589000+00:00', driver_number: 3, gap_to_leader: 17.199, interval: 3.803 },
];
const DRIVERS = [
  { driver_number: 3, name_acronym: 'VER', full_name: 'Max VERSTAPPEN', team_name: 'Red Bull Racing', team_colour: '4781D7' },
  { driver_number: 12, name_acronym: 'ANT', full_name: 'Kimi ANTONELLI', team_name: 'Mercedes', team_colour: '00D7B6' },
  { driver_number: 16, name_acronym: 'LEC', full_name: 'Charles LECLERC', team_name: 'Ferrari', team_colour: 'ED1131' },
  { driver_number: 44, name_acronym: 'HAM', full_name: 'Lewis HAMILTON', team_name: 'Ferrari', team_colour: 'ED1131' },
];
const STINTS = [
  { driver_number: 3, stint_number: 1, lap_start: 1, lap_end: 13, compound: 'SOFT' },
  { driver_number: 44, stint_number: 1, lap_start: 1, lap_end: 14, compound: 'SOFT' },
  { driver_number: 16, stint_number: 1, lap_start: 1, lap_end: 15, compound: 'SOFT' },
  { driver_number: 12, stint_number: 1, lap_start: 1, lap_end: 24, compound: 'MEDIUM' },
  { driver_number: 3, stint_number: 2, lap_start: 14, lap_end: 31, compound: 'SOFT' },
  { driver_number: 44, stint_number: 2, lap_start: 15, lap_end: 38, compound: 'MEDIUM' },
  { driver_number: 16, stint_number: 2, lap_start: 16, lap_end: 39, compound: 'MEDIUM' },
  { driver_number: 12, stint_number: 2, lap_start: 25, lap_end: 56, compound: 'HARD' },
  { driver_number: 16, stint_number: 3, lap_start: 40, lap_end: 56, compound: 'HARD' },
  { driver_number: 3, stint_number: 3, lap_start: 32, lap_end: 56, compound: 'MEDIUM' },
  { driver_number: 44, stint_number: 3, lap_start: 39, lap_end: 56, compound: 'HARD' },
];
const PIT = [
  { date: '2026-10-25T20:26:15.407000+00:00', driver_number: 3, lap_number: 13, pit_duration: 23.9 },
  { date: '2026-10-25T20:28:02.922000+00:00', driver_number: 44, lap_number: 14, pit_duration: 24.1 },
  { date: '2026-10-25T20:29:40.350000+00:00', driver_number: 16, lap_number: 15, pit_duration: 24.0 },
  { date: '2026-10-25T20:44:46.495000+00:00', driver_number: 12, lap_number: 24, pit_duration: 23.5 },
  { date: '2026-10-25T20:56:47.056000+00:00', driver_number: 3, lap_number: 31, pit_duration: 25.3 },
];
const LAPS = [
  { driver_number: 12, lap_number: 37, lap_duration: null, is_pit_out_lap: false },
  { driver_number: 16, lap_number: 36, lap_duration: 98.112, is_pit_out_lap: false },
];
// OpenF1 /session_result, qualifying 11392 (segments Q1–Q3).
const QUALI_RESULT = [
  { position: 1, driver_number: 12, duration: [95.39, 94.278, 94.035], gap_to_leader: [0.361, 0.08, 0.0] },
  { position: 2, driver_number: 3, duration: [95.215, 94.471, 94.214], gap_to_leader: [0.186, 0.273, 0.179] },
  { position: null, driver_number: 16, dnf: true },
];
// Jolpica qualifying (2026 round 18) and sprint (round 17).
const drv = (code, givenName, familyName) => ({ code, givenName, familyName });
const ERGAST_QUALI = { MRData: { total: '22', RaceTable: { Races: [{ QualifyingResults: [
  { position: '1', Driver: drv('ANT', 'Andrea Kimi', 'Antonelli'), Constructor: { name: 'Mercedes' }, Q1: '1:35.390', Q2: '1:34.278', Q3: '1:34.035' },
  { position: '2', Driver: drv('VER', 'Max', 'Verstappen'), Constructor: { name: 'Red Bull' }, Q1: '1:35.215', Q2: '1:34.471', Q3: '1:34.214' },
  { position: '16', Driver: drv('BEA', 'Oliver', 'Bearman'), Constructor: { name: 'Haas F1 Team' }, Q1: '1:36.175', Q2: '1:36.031' },
] }] } } };
const ERGAST_SPRINT = { MRData: { RaceTable: { Races: [{ SprintResults: [
  { position: '1', Driver: drv('VER', 'Max', 'Verstappen'), Constructor: { name: 'Red Bull' }, status: 'Finished', Time: { millis: '2388162', time: '39:48.162' } },
  { position: '2', Driver: drv('NOR', 'Lando', 'Norris'), Constructor: { name: 'McLaren' }, status: 'Finished', Time: { millis: '2390753', time: '+2.591' } },
  { position: '20', Driver: drv('STR', 'Lance', 'Stroll'), Constructor: { name: 'Aston Martin' }, status: 'Retired' },
] }] } } };

const AUSTIN = [
  { key: 'FirstPractice', label: 'Practice 1', start: '2026-10-23T17:30:00Z' },
  { key: 'SecondPractice', label: 'Practice 2', start: '2026-10-23T21:00:00Z' },
  { key: 'ThirdPractice', label: 'Practice 3', start: '2026-10-24T17:30:00Z' },
  { key: 'Qualifying', label: 'Qualifying', start: '2026-10-24T21:00:00Z' },
  { key: 'Race', label: 'Race', start: '2026-10-25T20:00:00Z' },
];

test('live session detection: soon / live / after, later sessions take over', () => {
  const at = (iso, ends) => {
    const r = liveSessionAt(AUSTIN, Date.parse(iso), ends);
    return r && `${r.session.key}:${r.phase}`;
  };
  assert.equal(at('2026-10-23T12:00:00Z'), null); // Friday morning, nothing yet
  assert.equal(at('2026-10-23T17:25:00Z'), 'FirstPractice:soon'); // 5 min before FP1
  assert.equal(at('2026-10-23T17:45:00Z'), 'FirstPractice:live');
  assert.equal(at('2026-10-23T18:50:00Z'), 'FirstPractice:live'); // up to 30 min after the end (OpenF1 live window)
  assert.equal(at('2026-10-23T19:10:00Z'), 'FirstPractice:after'); // classification free → delayed result
  assert.equal(at('2026-10-23T20:55:00Z'), 'SecondPractice:soon'); // FP2 takes over FP1's "after" phase
  assert.equal(at('2026-10-24T12:00:00Z'), null); // overnight
  assert.equal(at('2026-10-25T22:20:00Z'), 'Race:live'); // planned 150 min + 30
  assert.equal(at('2026-10-25T22:20:00Z', { Race: Date.parse('2026-10-25T21:40:00Z') }), 'Race:after'); // real end from OpenF1
  assert.equal(at('2026-10-26T03:00:00Z'), null);
});

test('OpenF1 live parsing: order, interval, gap, current tyre, pit stops, lap', () => {
  const { rows, lap } = parseLive({ position: POSITION, intervals: INTERVALS, stints: STINTS, pit: PIT, drivers: DRIVERS, laps: LAPS }, { count: 3 });
  assert.equal(lap, 37);
  assert.deepEqual(rows.map((r) => [r.pos, r.code, r.interval, r.gap, r.tyre, r.pits, r.color]), [
    [1, 'ANT', '', '', 'H', 1, '#00D7B6'],
    [2, 'LEC', '+2.731', '+2.731', 'M', 1, '#ED1131'], // 3rd stint starts on lap 40 – not yet at lap 37
    [3, 'HAM', '+5.812', '+8.543', 'M', 1, '#ED1131'],
  ]);
  // practice / qualifying: gap from best laps, no interval
  const q = parseLive({ position: POSITION, drivers: DRIVERS, laps: [
    { driver_number: 12, lap_number: 5, lap_duration: 95.2 }, { driver_number: 16, lap_number: 4, lap_duration: 95.45 }, { driver_number: 16, lap_number: 5, lap_duration: 94.9, is_pit_out_lap: true },
  ] }, { count: 2, race: false });
  assert.equal(q.lap, null);
  assert.deepEqual(q.rows.map((r) => [r.code, r.best, r.gap, r.tyre]), [['ANT', '1:35.200', '', null], ['LEC', '1:35.450', '+0.250', null]]);
});

test('OpenF1 session result: segments use the last time, unclassified drivers dropped', () => {
  const { rows } = parseSessionResult({ result: QUALI_RESULT, drivers: DRIVERS });
  assert.deepEqual(rows.map((r) => [r.pos, r.code, r.best, r.gap]), [[1, 'ANT', '1:34.035', ''], [2, 'VER', '1:34.214', '+0.179']]);
  const race = parseSessionResult({ result: [{ position: 1, driver_number: 3, duration: 5716.65, gap_to_leader: 0 }, { position: 2, driver_number: 44, gap_to_leader: '+1 LAP' }], drivers: DRIVERS });
  assert.deepEqual(race.rows.map((r) => r.gap), ['', '+1 LAP']);
});

test('qualifying and sprint parsing (Jolpica)', () => {
  assert.deepEqual(parseQualifying(ERGAST_QUALI, 3).map((r) => [r.pos, r.code, r.time, r.segment, r.team]), [
    [1, 'ANT', '1:34.035', 'Q3', 'Mercedes'], [2, 'VER', '1:34.214', 'Q3', 'Red Bull'], [16, 'BEA', '1:36.031', 'Q2', 'Haas F1 Team'],
  ]);
  assert.equal(parseQualifying(ERGAST_QUALI, 1).length, 1);
  assert.equal(parseQualifying({ MRData: { RaceTable: { Races: [] } } }), null);
  assert.deepEqual(parseSprint(ERGAST_SPRINT).map((r) => [r.code, r.time]), [['VER', '39:48.162'], ['NOR', '+2.591'], ['STR', 'Retired']]);
});

test('track time formatting', () => {
  assert.deepEqual(trackTimeParts('2026-11-01T20:00:00Z', 'America/Mexico_City', 'de-DE'), { wd: 'So', time: '14:00' });
  assert.deepEqual(trackTimeParts('2026-11-22T04:00:00Z', 'America/Los_Angeles', 'en-GB'), { wd: 'Sat', time: '20:00' }); // Las Vegas: Saturday night
  assert.deepEqual(trackTimeParts('2026-03-08T04:00:00Z', 'Australia/Melbourne', 'de-DE'), { wd: 'So', time: '15:00' });
});

test('lap computation and track info', () => {
  assert.equal(computeLaps(4304), 71); // Mexico City
  assert.equal(computeLaps(5891), 52); // Silverstone
  assert.equal(computeLaps(3337, 'monaco'), 78); // Monaco: 260 km
  assert.equal(computeLaps(null), null);
  const mex = trackInfo('rodriguez', 4304, '2026');
  assert.deepEqual([mex.laps, mex.lapsComputed, mex.distanceKm, mex.corners, mex.drsZones, mex.lapRecord.driver], [71, false, 305.6, 17, null, 'Valtteri Bottas']);
  assert.equal(trackInfo('rodriguez', 4304, '2025').drsZones, 3); // DRS only before 2026
  const madrid = trackInfo('madring', 5416, '2026');
  assert.deepEqual([madrid.laps, madrid.lapsComputed, madrid.lapRecord], [57, true, null]);
  assert.equal(trackInfo('unknown_track', null, '2026'), null);
  for (const [id, x] of Object.entries(TRACKS)) if (x.lapRecord) assert.match(x.lapRecord.time, /^\d:\d\d\.\d{3}$/, id);
});

test('provider: replaying a past race gives live rows, grid is hidden after the race result', async () => {
  const schedule = { MRData: { RaceTable: { Races: [{
    season: '2026', round: '18', raceName: 'United States Grand Prix', date: '2026-10-25', time: '20:00:00Z',
    Circuit: { circuitId: 'americas', circuitName: 'Circuit of the Americas', Location: { lat: '30.1328', long: '-97.6411', locality: 'Austin', country: 'USA' } },
    FirstPractice: { date: '2026-10-23', time: '17:30:00Z' }, SecondPractice: { date: '2026-10-23', time: '21:00:00Z' },
    ThirdPractice: { date: '2026-10-24', time: '17:30:00Z' }, Qualifying: { date: '2026-10-24', time: '21:00:00Z' },
  }] } } };
  const sessions = [{ session_key: 11392, date_start: '2026-10-24T21:00:00+00:00', date_end: '2026-10-24T22:00:00+00:00' }, { session_key: 11396, date_start: '2026-10-25T20:00:00+00:00', date_end: '2026-10-25T22:00:00+00:00' }];
  const calls = [];
  let raceResults = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const route = [
      [/\/current\.json/, schedule],
      [/open-meteo/, { timezone: 'America/Chicago' }],
      [/f1-circuits/, { features: [] }],
      [/\/sessions\?/, sessions],
      [/position\?session_key=11392/, null],
      [/position\?/, POSITION], [/drivers\?/, DRIVERS], [/stints\?/, STINTS], [/pit\?/, PIT], [/intervals\?/, INTERVALS], [/laps\?/, LAPS],
      [/18\/results\.json/, { MRData: { total: String(raceResults) } }],
      [/18\/qualifying\.json/, ERGAST_QUALI],
    ].find(([re]) => re.test(u));
    if (!route) return { ok: false, status: 404, json: async () => ({}) };
    if (route[1] === null) return { ok: false, status: 401, json: async () => ({ detail: 'live data for sponsors' }) };
    return { ok: true, status: 200, json: async () => route[1] };
  };
  try {
    const settings = { ...Object.fromEntries(MODULE_TYPES.f1.fields.map((f) => [f.key, f.default])), showTrackWeather: false, showPreviousWinner: false, showLastRace: false, showDriverStandings: false, trackTime: 'beside', liveCount: 3 };
    const cfg = { general: { locale: 'de-DE' } };
    // during qualifying: OpenF1 refuses (free tier) → clearly marked, slower polling
    const q = await f1(settings, cfg, {}, { now: Date.parse('2026-10-24T21:20:00Z') });
    assert.equal(q.live.status, 'restricted');
    assert.equal(q.refresh, 120);
    // during the race (fixtures: lap 37)
    const d = await f1(settings, cfg, {}, { now: Date.parse('2026-10-25T20:58:00Z') });
    assert.equal(d.live.status, 'live');
    assert.equal(d.live.lap, 37);
    assert.deepEqual(d.live.rows.map((r) => r.code), ['ANT', 'LEC', 'HAM']);
    assert.equal(d.refresh, 15);
    assert.equal(d.trackTz, 'America/Chicago');
    assert.deepEqual(d.nextSession.track, { wd: 'So', time: '15:00' });
    assert.equal(d.trackInfo.laps, 56);
    assert.deepEqual(d.grid.rows.map((r) => r.code), ['ANT', 'VER', 'BEA']);
    assert.ok(calls.some((u) => /intervals\?session_key=11396&date>=2026-10-25T20:57:00&date<=2026-10-25T20:58:00/.test(u)));
    // race result published → qualifying grid disappears
    raceResults = 22;
    const after = await f1(settings, cfg, {}, { now: Date.parse('2026-10-25T22:05:00Z') });
    assert.equal(after.grid, undefined);
    // feature switches off → nothing extra
    const plain = await f1({ ...settings, liveTiming: false, showQualifying: false, trackTime: 'off', showTrackInfo: false }, cfg, {}, { now: Date.parse('2026-10-25T21:05:30Z') });
    assert.deepEqual([plain.live, plain.grid, plain.trackTz, plain.trackInfo, plain.refresh], [undefined, undefined, undefined, undefined, undefined]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('F1 extras: schema defaults and German strings', () => {
  const f = Object.fromEntries(MODULE_TYPES.f1.fields.map((x) => [x.key, x]));
  assert.deepEqual([f.liveTiming.default, f.liveCount.default, f.showQualifying.default, f.trackTime.default, f.showTrackInfo.default, f.layout.default], [true, 10, true, 'off', true, 'full']);
  for (const k of Object.keys(de)) assert.ok(deAll[k], k);
  assert.equal(deAll['Lap record'], 'Rundenrekord');
  assert.equal(deAll['Live positions'], 'Live-Positionen');
  assert.equal(deAll['Track time'], 'Streckenzeit');
  assert.equal(deAll['Qualifying result'], 'Qualifying-Ergebnis');
});
