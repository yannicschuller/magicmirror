// Countdown – days until dates the user enters (birthdays, holidays, trips …).
// Computed in the browser (public/shared/countdown.js); the tiny server provider
// only hands the events back so "only show when …" can decide on visibility.

export default {
  type: 'countdown',
  label: 'Countdown',
  description: 'Days until birthdays, anniversaries, holidays and other dates you enter',
  defaultRegion: 'middle_left',
  defaultTitle: 'Countdown',
  refresh: 0,
  fields: [
    { key: 'events', label: 'Events', type: 'list', itemLabel: 'Event', default: [], fields: [
      { key: 'name', label: 'Name', type: 'text', default: '', placeholder: 'Holiday in Italy' },
      { key: 'date', label: 'Date', type: 'date', default: '',
        help: 'For yearly events enter the original date (e.g. the date of birth) – its year is used for "turns N".' },
      { key: 'time', label: 'Time (optional)', type: 'time', default: '' },
      { key: 'repeat', label: 'Repeat', type: 'select', default: 'none', options: [
        { value: 'none', label: 'Once' },
        { value: 'yearly', label: 'Every year (birthday, anniversary)' },
      ] },
      { key: 'years', label: 'Show years', type: 'select', default: 'none', showIf: { repeat: 'yearly' }, options: [
        { value: 'none', label: 'No' },
        { value: 'age', label: '"turns 40" (birthday)' },
        { value: 'count', label: '"10 years" (anniversary)' },
      ] },
      { key: 'icon', label: 'Icon (emoji or short text, optional)', type: 'text', default: '', placeholder: '🎂' },
      { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
      { key: 'enabled', label: 'Enabled', type: 'bool', default: true },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List' },
      { value: 'big', label: 'Next event large (big number of days)' },
      { value: 'compact', label: 'Compact (one line)' },
    ] },
    { key: 'precision', label: 'Remaining time', type: 'select', default: 'days', options: [
      { value: 'days', label: 'Days only ("in 3 days", "tomorrow", "today")' },
      { value: 'precise', label: 'With hours shortly before (events with a time, from 2 days before)' },
    ] },
    { key: 'showDate', label: 'Show the date', type: 'bool', default: true },
    { key: 'maxItems', label: 'Max. entries', type: 'number', default: 5, min: 1, max: 50 },
    { key: 'sort', label: 'Sort order', type: 'select', default: 'next', options: [
      { value: 'next', label: 'Next event first' },
      { value: 'list', label: 'As entered' },
    ] },
    { key: 'withinDays', label: 'Only show events from … days before (0 = always)', type: 'number', default: 0, min: 0, max: 3650,
      help: 'Events further away are left out. Also used by "only show when an event is coming up".' },
    { key: 'hidePast', label: 'Hide past events', type: 'bool', default: true,
      help: 'One-time events disappear the day after; yearly events always move on to the next year.' },
  ],
};
