// Fuel prices in Germany from Tankerkönig (MTS-K data, CC BY 4.0).
import { locationFields } from '../fields.js';

export const FUEL_TYPES = [
  { value: 'e5', label: 'Super E5' },
  { value: 'e10', label: 'Super E10' },
  { value: 'diesel', label: 'Diesel' },
];

export default {
  type: 'fuel',
  label: 'Fuel prices',
  description: 'Current fuel prices of nearby or selected petrol stations in Germany (Tankerkönig / MTS-K)',
  defaultRegion: 'middle_right',
  defaultTitle: 'Fuel prices',
  refresh: 600,
  fields: [
    { key: 'apiKey', label: 'Tankerkönig API key (free at onboarding.tankerkoenig.de)', type: 'text', default: '', secret: true, placeholder: '00000000-0000-0000-0000-000000000000' },
    { key: 'mode', label: 'Station selection', type: 'select', default: 'nearby', options: [
      { value: 'nearby', label: 'Stations nearby' },
      { value: 'stations', label: 'Selected stations' },
    ] },
    ...locationFields,
    { key: 'radius', label: 'Search radius (km)', type: 'number', default: 5, min: 1, max: 25, showIf: { mode: 'nearby' } },
    { key: 'stations', label: 'Petrol stations (max. 10)', type: 'list', itemLabel: 'Petrol station', default: [], showIf: { mode: 'stations' }, fields: [
      { key: 'id', label: 'Station ID (from tankerkoenig.de)', type: 'text', default: '', placeholder: '474e5046-deaf-4f9b-9a32-9797b778f047' },
      { key: 'name', label: 'Custom name (optional)', type: 'text', default: '' },
    ] },
    { key: 'fuelTypes', label: 'Fuel types', type: 'multiselect', default: ['e5', 'e10', 'diesel'], options: FUEL_TYPES },
    { key: 'sort', label: 'Sort by', type: 'select', default: 'price', options: [
      { value: 'price', label: 'Price (first fuel type)' },
      { value: 'dist', label: 'Distance' },
    ] },
    { key: 'maxStations', label: 'Max. stations', type: 'number', default: 5, min: 1, max: 20 },
    { key: 'onlyOpen', label: 'Only show open stations', type: 'bool', default: true },
    { key: 'highlightCheapest', label: 'Highlight cheapest price', type: 'bool', default: true },
    { key: 'showAddress', label: 'Show address and distance', type: 'bool', default: true },
    { key: 'refreshSeconds', label: 'Update interval (seconds, min. 300)', type: 'number', default: 600, min: 300, max: 3600 },
  ],
};
