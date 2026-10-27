// "Moon & sun" – computed locally in the browser (public/shared/astro.js), no API.
import { locationFields } from '../fields.js';

export const SKY_TIMES = [
  { value: 'nauticalDawn', label: 'Nautical dawn' },
  { value: 'dawn', label: 'Dawn (civil)' },
  { value: 'sunrise', label: 'Sunrise' },
  { value: 'goldenHourEnd', label: 'Morning golden hour ends' },
  { value: 'solarNoon', label: 'Solar noon' },
  { value: 'goldenHour', label: 'Evening golden hour begins' },
  { value: 'sunset', label: 'Sunset' },
  { value: 'dusk', label: 'Dusk (civil)' },
  { value: 'nauticalDusk', label: 'Nautical dusk' },
  { value: 'moonrise', label: 'Moonrise' },
  { value: 'moonset', label: 'Moonset' },
];

export default {
  type: 'sky',
  label: 'Moon & sun',
  description: 'Moon phase, sun path, sunrise/sunset, golden hour and day length – calculated locally',
  defaultRegion: 'middle_right',
  defaultTitle: 'Sky',
  refresh: 0,
  fields: [
    ...locationFields,
    { key: 'showMoon', label: 'Moon phase (drawing)', type: 'bool', default: true },
    { key: 'showSunArc', label: "Sun arc with the sun's current position", type: 'bool', default: true },
    { key: 'showSunPosition', label: 'Sun altitude & direction', type: 'bool', default: false, showIf: { showSunArc: true } },
    { key: 'showTimes', label: 'Times list', type: 'bool', default: true },
    { key: 'times', label: 'Times to show', type: 'multiselect', default: ['dawn', 'sunrise', 'goldenHour', 'sunset', 'dusk', 'moonrise', 'moonset'], options: SKY_TIMES, showIf: { showTimes: true } },
    { key: 'showDayLength', label: 'Day length and change vs. yesterday', type: 'bool', default: true },
    { key: 'showNextPhases', label: 'Next full and new moon', type: 'bool', default: true },
    { key: 'size', label: 'Size', type: 'select', default: 'medium', options: [
      { value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' },
    ] },
  ],
};
