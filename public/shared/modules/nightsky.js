// "Night sky" – visible ISS passes, planets, moon and sky events, computed on
// the server (src/providers/nightsky.js). Only the ISS orbit is downloaded
// (CelesTrak, no API key).
import { locationFields } from '../fields.js';

export default {
  type: 'nightsky',
  label: 'Night sky & ISS',
  description: 'Visible ISS passes, planets and moon tonight, conjunctions and meteor showers – calculated on the server, no API key',
  defaultRegion: 'middle_right',
  defaultTitle: 'Night sky',
  refresh: 1800,
  fields: [
    ...locationFields,
    { key: 'issDays', label: 'ISS passes: days ahead', type: 'number', default: 3, min: 1, max: 10 },
    { key: 'minElevation', label: 'ISS: minimum height above the horizon (°)', type: 'number', default: 10, min: 0, max: 80, help: 'Passes that stay lower than this are hidden. Trees and houses usually block the first 10–15°.' },
    { key: 'onlyVisible', label: 'Only passes you can see (ISS in sunlight, sky dark)', type: 'bool', default: true },
    { key: 'maxPasses', label: 'Max. ISS passes', type: 'number', default: 4, min: 1, max: 20 },
    { key: 'soonHours', label: '"ISS soon" means within (hours)', type: 'number', default: 6, min: 1, max: 48, help: 'Used by "Only show when …": the module shows when a visible pass starts within this time or tonight.' },
    { key: 'showPlanets', label: 'Planets visible tonight', type: 'bool', default: true },
    { key: 'showMoon', label: 'Moonrise, moonset and illumination', type: 'bool', default: true },
    { key: 'showEvents', label: 'Events (conjunctions, meteor showers)', type: 'bool', default: true },
    { key: 'conjunctionDeg', label: 'Conjunctions: max. distance (°)', type: 'number', default: 3, min: 0.5, max: 10, step: 0.5, showIf: { showEvents: true } },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List' },
      { value: 'compact', label: 'Compact' },
    ] },
  ],
};
