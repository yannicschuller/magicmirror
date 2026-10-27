// Calendar – events from several iCal/ICS feeds plus computed public holidays
// and school holidays (OpenHolidays API). Overrides the core `calendar` entry
// of MODULE_TYPES (plug-ins are applied after the core modules).
import { CALENDAR_ICONS } from '../calendar-icons.js';
// modules.js imports this file (circular): EFA_PRESETS is only read lazily, once modules.js has run.
import { EFA_PRESETS } from '../modules.js';

// Field whose `options` are built on first access (and then stored as a plain value).
function lazyOptions(field, build) {
  return Object.defineProperty(field, 'options', {
    configurable: true,
    enumerable: true,
    get() {
      const options = build();
      Object.defineProperty(field, 'options', { value: options, enumerable: true, writable: true, configurable: true });
      return options;
    },
  });
}

// German states (ISO 3166-2:DE without the "DE-" prefix).
export const DE_STATES = [
  { value: 'BW', label: 'Baden-Württemberg' },
  { value: 'BY', label: 'Bavaria' },
  { value: 'BE', label: 'Berlin' },
  { value: 'BB', label: 'Brandenburg' },
  { value: 'HB', label: 'Bremen' },
  { value: 'HH', label: 'Hamburg' },
  { value: 'HE', label: 'Hesse' },
  { value: 'MV', label: 'Mecklenburg-Western Pomerania' },
  { value: 'NI', label: 'Lower Saxony' },
  { value: 'NW', label: 'North Rhine-Westphalia' },
  { value: 'RP', label: 'Rhineland-Palatinate' },
  { value: 'SL', label: 'Saarland' },
  { value: 'SN', label: 'Saxony' },
  { value: 'ST', label: 'Saxony-Anhalt' },
  { value: 'SH', label: 'Schleswig-Holstein' },
  { value: 'TH', label: 'Thuringia' },
];

export default {
  type: 'calendar',
  label: 'Calendar',
  description: 'Events from multiple iCal/ICS calendars',
  defaultRegion: 'middle_left',
  defaultTitle: 'Events',
  refresh: 600,
  fields: [
    { key: 'calendars', label: 'Calendar', type: 'list', itemLabel: 'Calendar', default: [], fields: [
      { key: 'name', label: 'Name', type: 'text', default: 'Calendar' },
      { key: 'url', label: 'iCal URL (https:// or webcal://)', type: 'text', default: '', secret: true, placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics' },
      { key: 'color', label: 'Color', type: 'color', default: '#7dd3fc' },
      { key: 'icon', label: 'Icon', type: 'select', default: 'calendar', options: CALENDAR_ICONS },
      { key: 'enabled', label: 'Enabled', type: 'bool', default: true },
      { key: 'birthdays', label: 'Birthday calendar (show age)', type: 'bool', default: false },
      { key: 'busyOnly', label: 'Busy only (hide titles and places)', type: 'bool', default: false,
        help: 'Titles, places and descriptions of this calendar never leave the server – the mirror only shows "Busy".' },
      { key: 'daysAhead', label: 'Days ahead (0 = module setting)', type: 'number', default: 0, min: 0, max: 365 },
    ] },

    { key: 'view', label: 'View', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List (agenda)' },
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ] },
    { key: 'weekStart', label: 'Week starts', type: 'select', default: 'monday', showIf: { view: 'week' }, options: [
      { value: 'monday', label: 'On Monday' },
      { value: 'today', label: 'Today' },
    ] },
    { key: 'monthAgenda', label: 'Show agenda below the month', type: 'bool', default: true, showIf: { view: 'month' } },

    { key: 'style', label: 'Style', type: 'select', default: 'badge', options: [
      { value: 'badge', label: 'Icon on colored circle' },
      { value: 'icon', label: 'Icon in calendar color' },
      { value: 'bar', label: 'Colored bar + icon' },
      { value: 'dot', label: 'Colored dot only' },
    ] },
    { key: 'colorTitle', label: 'Event title in calendar color', type: 'bool', default: false },
    { key: 'showLegend', label: 'Show legend (calendars with icon & color)', type: 'bool', default: false },
    { key: 'iconRules', label: 'Icons by event keyword (overrides the calendar icon)', type: 'list', itemLabel: 'Rule', default: [
      { keywords: 'geburtstag, birthday, bday', icon: 'cake' },
      { keywords: 'arzt, zahnarzt, termin praxis, impfung, physio, doctor, dentist, vaccination', icon: 'medical' },
      { keywords: 'urlaub, flug, reise, vacation, holiday, flight, trip', icon: 'plane' },
      { keywords: 'training, fitness, gym, laufen, yoga, schwimmen, running, swimming', icon: 'sport' },
      { keywords: 'werkstatt, tüv, reifen, garage, mot, tyres', icon: 'car' },
      { keywords: 'konzert, festival, concert, gig', icon: 'music' },
      { keywords: 'party, feier, hochzeit, wedding, celebration', icon: 'party' },
    ], fields: [
      { key: 'keywords', label: 'Keywords (comma-separated)', type: 'text', default: '' },
      { key: 'icon', label: 'Icon', type: 'select', default: 'star', options: CALENDAR_ICONS },
    ] },
    { key: 'daysAhead', label: 'Days ahead', type: 'number', default: 14, min: 1, max: 365 },
    { key: 'maxEvents', label: 'Max. events', type: 'number', default: 10, min: 1, max: 50 },
    { key: 'groupByDay', label: 'Group by day', type: 'bool', default: true },
    { key: 'showLocation', label: 'Show location', type: 'bool', default: false },
    { key: 'showCalendarName', label: 'Show calendar name', type: 'bool', default: false },

    // ---- times & highlighting
    { key: 'timeFormat', label: 'Time display', type: 'select', default: 'start', options: [
      { value: 'start', label: 'Start only' },
      { value: 'startEnd', label: 'Start – end' },
      { value: 'duration', label: 'Start + duration' },
    ] },
    { key: 'relativeToday', label: 'Relative times for today ("in 2 h")', type: 'bool', default: false },
    { key: 'showProgress', label: 'Progress bar for running events', type: 'bool', default: true },
    { key: 'showNext', label: 'Show time until the next event today', type: 'bool', default: true },
    { key: 'soonMinutes', label: 'Emphasize events starting within (minutes, 0 = off)', type: 'number', default: 15, min: 0, max: 240 },
    { key: 'multiDayLabel', label: 'Multi-day events: show "Day 2 of 5"', type: 'bool', default: true },

    // ---- appearance
    { key: 'fade', label: 'Fade out later entries', type: 'select', default: 'off', options: [
      { value: 'off', label: 'Off' },
      { value: 'subtle', label: 'Subtle' },
      { value: 'strong', label: 'Strong' },
    ] },
    { key: 'titleLines', label: 'Max. lines per title', type: 'select', default: '1', options: [
      { value: '1', label: '1 line' },
      { value: '2', label: '2 lines' },
      { value: '0', label: 'Unlimited' },
    ] },
    { key: 'birthdayAge', label: 'Birthdays: show age ("Anna turns 31")', type: 'bool', default: false,
      help: 'Uses a year of birth (1900 – today) in the title or description of birthday events – events of birthday calendars or matching a keyword rule with the birthday icon. The year is removed from the title.' },

    // ---- filters
    { key: 'excludeKeywords', label: 'Hide events containing (comma-separated)', type: 'text', default: '', placeholder: 'Rufbereitschaft, Backup' },
    { key: 'includeKeywords', label: 'Only show events containing (comma-separated, empty = all)', type: 'text', default: '' },
    { key: 'hideAllDay', label: 'Hide all-day events', type: 'bool', default: false },
    { key: 'hideCancelled', label: 'Hide cancelled events', type: 'bool', default: true },
    { key: 'hidePrivate', label: 'Hide private/confidential events', type: 'bool', default: false },

    // ---- time to leave
    { key: 'travelCard', label: "Show a 'time to leave' card for events with a location", type: 'bool', default: false,
      help: 'Shortly before it is time to leave for a timed event with a place, a card with travel time and route map appears above the events. Places are looked up with OpenStreetMap (Nominatim), routes with OSRM – without live traffic. All-day events, online meetings and busy-only calendars are skipped.' },
    { key: 'travelMode', label: 'Travel by', type: 'select', default: 'car', showIf: { travelCard: true }, options: [
      { value: 'car', label: 'Car' },
      { value: 'bike', label: 'Bike' },
      { value: 'foot', label: 'On foot' },
      { value: 'transit', label: 'Bus & train' },
      { value: 'auto', label: 'Automatic (public transport nearby, otherwise car)' },
    ] },
    { key: 'travelTransitRadiusKm', label: 'Automatic: public transport up to (km from the start)', type: 'number', default: 15, min: 1, max: 100, showIf: { travelCard: true, travelMode: 'auto' } },
    lazyOptions({ key: 'travelTransitNetwork', label: 'Public transport network', type: 'select', default: '', showIf: { travelCard: true },
      help: 'Used for "Bus & train" and "Automatic": connections (EFA) arriving in time, with the latest departure. Without a departures module VVS is used. If no connection is found, the card falls back to walking or driving.' },
    () => [{ value: '', label: 'Same as the departures module' }, ...EFA_PRESETS.map(({ value, label }) => ({ value, label }))]),
    { key: 'travelTransitUrl', label: 'EFA base URL', type: 'text', default: '', placeholder: 'https://efa.example.de/efa/', showIf: { travelCard: true, travelTransitNetwork: 'custom' } },
    { key: 'travelLeadMinutes', label: 'Show the card this many minutes before leaving', type: 'number', default: 30, min: 0, max: 180, showIf: { travelCard: true } },
    { key: 'travelBufferMinutes', label: 'Buffer added to the travel time (minutes)', type: 'number', default: 5, min: 0, max: 60, showIf: { travelCard: true } },
    { key: 'travelFrom', label: 'Start of the route', type: 'location', default: null, showIf: { travelCard: true },
      help: 'Leave empty to use the location from "General".' },
    { key: 'travelFromAddress', label: 'Start address (optional, more exact than a city)', type: 'text', default: '', secret: true, showIf: { travelCard: true },
      placeholder: 'Musterstraße 1, 04109 Leipzig',
      help: 'Looked up once with OpenStreetMap (Nominatim) and preferred over the start location above. Stays on the server.' },
    { key: 'travelMap', label: 'Show route map', type: 'bool', default: true, showIf: { travelCard: true } },
    { key: 'travelMapHeight', label: 'Max. map height (% of screen height, 0 = auto)', type: 'number', default: 0, min: 0, max: 80, showIf: { travelCard: true, travelMap: true },
      help: 'The map sits small beside the text so that the next events stay visible.' },

    // ---- holidays
    { key: 'holidayCountry', label: 'Holidays: country', type: 'select', default: 'DE', options: [
      { value: 'DE', label: 'Germany' },
    ] },
    { key: 'holidayState', label: 'State', type: 'select', default: '', options: [
      { value: '', label: 'None (nationwide holidays only)' },
      ...DE_STATES,
    ] },
    { key: 'showPublicHolidays', label: 'Show public holidays', type: 'bool', default: false },
    { key: 'publicHolidayColor', label: 'Color of public holidays', type: 'color', default: '#f87171', showIf: { showPublicHolidays: true } },
    { key: 'publicHolidayIcon', label: 'Icon of public holidays', type: 'select', default: 'flag', options: CALENDAR_ICONS, showIf: { showPublicHolidays: true } },
    { key: 'showSchoolHolidays', label: 'Show school holidays', type: 'bool', default: false,
      help: 'Needs a state. Data: openholidaysapi.org, refreshed daily.' },
    { key: 'schoolHolidayColor', label: 'Color of school holidays', type: 'color', default: '#a3e635', showIf: { showSchoolHolidays: true } },
    { key: 'schoolHolidayIcon', label: 'Icon of school holidays', type: 'select', default: 'school', options: CALENDAR_ICONS, showIf: { showSchoolHolidays: true } },
    { key: 'holidaysCountTowardsMax', label: 'Holidays count towards max. events', type: 'bool', default: true },
  ],
};
