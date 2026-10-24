import IcalExpander from 'ical-expander';
import { cached, fetchText, dateKey } from '../util.js';

function normalizeUrl(url) {
  return String(url).trim().replace(/^webcals?:\/\//i, 'https://');
}

async function loadIcs(url) {
  return cached(`ics:${url}`, 600, () => fetchText(normalizeUrl(url), { timeout: 20000, headers: { Accept: 'text/calendar, */*' } }));
}

function toItem(src) {
  const allDay = src.startDate.isDate;
  const start = allDay ? src.startDate.toString().slice(0, 10) : src.startDate.toJSDate().toISOString();
  let end = null;
  if (src.endDate) end = allDay ? src.endDate.toString().slice(0, 10) : src.endDate.toJSDate().toISOString();
  return { allDay, start, end };
}

// Expands one ICS feed (incl. recurrences, exceptions, EXDATEs) into a flat list.
export async function expandIcs(url, from, to) {
  const ics = await loadIcs(url);
  const expander = new IcalExpander({ ics, maxIterations: 5000, skipInvalidDates: true });
  const { events, occurrences } = expander.between(from, to);
  const items = [];
  for (const e of events) {
    items.push({ title: e.summary || '', location: e.location || '', description: e.description || '', ...toItem(e) });
  }
  for (const o of occurrences) {
    items.push({ title: o.item.summary || '', location: o.item.location || '', description: o.item.description || '', ...toItem(o) });
  }
  return items;
}

// Day key (YYYY-MM-DD) of an event start in the mirror's time zone.
export function eventDay(item, timeZone) {
  return item.allDay ? item.start : dateKey(new Date(item.start), timeZone);
}
