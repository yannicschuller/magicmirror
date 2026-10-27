// Public holidays (computed locally, no network) and school holidays
// (OpenHolidays API, https://openholidaysapi.org – free, no key).
// Country-ready: add a country to PUBLIC_RULES and the select in the schema.
import { cached, fetchJson } from '../util.js';
import { addDays } from '../../public/shared/calendar-days.js';

export { addDays };

const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Easter Sunday (Gregorian calendar, anonymous algorithm by Meeus/Jones/Butcher).
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return key(year, month, day);
}

// Wednesday before 23 November (Buß- und Bettag).
function repentanceDay(year) {
  const nov22 = new Date(Date.UTC(year, 10, 22));
  const back = (nov22.getUTCDay() - 3 + 7) % 7; // 3 = Wednesday
  return key(year, 11, 22 - back);
}

// Rule: { name, date(year, easter) => key, states?: [...] (absent = nationwide), from?: first year }
const fixed = (m, d) => (y) => key(y, m, d);
const easter = (offset) => (y, e) => addDays(e, offset);

const PUBLIC_RULES = {
  DE: [
    { name: "New Year's Day", date: fixed(1, 1) },
    { name: 'Epiphany', date: fixed(1, 6), states: ['BW', 'BY', 'ST'] },
    { name: "International Women's Day", date: fixed(3, 8), states: ['BE'], from: 2019 },
    { name: "International Women's Day", date: fixed(3, 8), states: ['MV'], from: 2023 },
    { name: 'Good Friday', date: easter(-2) },
    { name: 'Easter Sunday', date: easter(0), states: ['BB'] },
    { name: 'Easter Monday', date: easter(1) },
    { name: 'Labour Day', date: fixed(5, 1) },
    { name: 'Ascension Day', date: easter(39) },
    { name: 'Whit Sunday', date: easter(49), states: ['BB'] },
    { name: 'Whit Monday', date: easter(50) },
    { name: 'Corpus Christi', date: easter(60), states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'] },
    // Bavaria: officially only in communities with a Catholic majority – simplified to the whole state.
    { name: 'Assumption Day', date: fixed(8, 15), states: ['BY', 'SL'] },
    { name: "World Children's Day", date: fixed(9, 20), states: ['TH'], from: 2019 },
    { name: 'German Unity Day', date: fixed(10, 3) },
    { name: 'Reformation Day', date: fixed(10, 31), states: ['BB', 'MV', 'SN', 'ST', 'TH'] },
    { name: 'Reformation Day', date: fixed(10, 31), states: ['HB', 'HH', 'NI', 'SH'], from: 2018 },
    { name: "All Saints' Day", date: fixed(11, 1), states: ['BW', 'BY', 'NW', 'RP', 'SL'] },
    { name: 'Day of Repentance and Prayer', date: repentanceDay, states: ['SN'] },
    { name: 'Christmas Day', date: fixed(12, 25) },
    { name: 'Boxing Day', date: fixed(12, 26) },
    // Augsburger Friedensfest (8 Aug) applies to the city of Augsburg only – not included.
  ],
};

export const HOLIDAY_COUNTRIES = Object.keys(PUBLIC_RULES);

// Public holidays of one year: [{ date: 'YYYY-MM-DD', name: English message id }], sorted.
// state = '' → nationwide holidays only.
export function publicHolidays(year, state = '', country = 'DE') {
  const rules = PUBLIC_RULES[country] || [];
  const e = easterSunday(year);
  const seen = new Set();
  const out = [];
  for (const r of rules) {
    if (r.from && year < r.from) continue;
    if (r.states && !r.states.includes(state)) continue;
    const date = r.date(year, e);
    if (seen.has(date + r.name)) continue;
    seen.add(date + r.name);
    out.push({ date, name: r.name });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// Public holidays between two day keys (inclusive).
export function publicHolidaysBetween(fromKey, toKey, state = '', country = 'DE') {
  const out = [];
  for (let y = Number(fromKey.slice(0, 4)); y <= Number(toKey.slice(0, 4)); y++) {
    for (const h of publicHolidays(y, state, country)) if (h.date >= fromKey && h.date <= toKey) out.push(h);
  }
  return out;
}

// ---- school holidays ------------------------------------------------------------------------

const API = 'https://openholidaysapi.org/SchoolHolidays';

function pickName(names, lang) {
  if (!Array.isArray(names) || !names.length) return '';
  const want = String(lang || 'en').toUpperCase();
  return (names.find((n) => n.language === want) || names.find((n) => n.language === 'EN') || names[0]).text || '';
}

async function schoolYear(country, state, year) {
  const url = `${API}?countryIsoCode=${country}&subdivisionCode=${country}-${state}&validFrom=${year}-01-01&validTo=${year}-12-31`;
  return cached(`school-holidays:${country}-${state}:${year}`, 86400, () => fetchJson(url, { timeout: 15000 }));
}

// School holidays overlapping [fromKey, toKey]:
// [{ id, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' (exclusive, like iCal), name }].
export async function schoolHolidaysBetween(fromKey, toKey, state, { country = 'DE', lang = 'de' } = {}) {
  if (!state) return [];
  const years = [];
  for (let y = Number(fromKey.slice(0, 4)); y <= Number(toKey.slice(0, 4)); y++) years.push(y);
  const lists = await Promise.all(years.map((y) => schoolYear(country, state, y)));
  const byId = new Map();
  for (const list of lists) {
    for (const h of Array.isArray(list) ? list : []) {
      if (!h.startDate || !h.endDate || h.endDate < fromKey || h.startDate > toKey) continue;
      byId.set(h.id || `${h.startDate}/${h.endDate}`, { id: h.id, start: h.startDate, end: addDays(h.endDate, 1), name: pickName(h.name, lang) });
    }
  }
  return [...byId.values()].sort((a, b) => a.start.localeCompare(b.start));
}
