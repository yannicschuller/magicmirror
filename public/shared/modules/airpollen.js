// "Pollen & air quality" – DWD pollen forecast (Germany) + Open-Meteo / CAMS air quality.
import { locationFields } from '../fields.js';

// Pollen types of the DWD Pollenflug-Gefahrenindex (value = our id, dwd = JSON key).
export const POLLEN_TYPES = [
  { value: 'hazel', label: 'Hazel', dwd: 'Hasel' },
  { value: 'alder', label: 'Alder', dwd: 'Erle' },
  { value: 'ash', label: 'Ash', dwd: 'Esche' },
  { value: 'birch', label: 'Birch', dwd: 'Birke' },
  { value: 'grass', label: 'Grass', dwd: 'Graeser' },
  { value: 'rye', label: 'Rye', dwd: 'Roggen' },
  { value: 'mugwort', label: 'Mugwort', dwd: 'Beifuss' },
  { value: 'ragweed', label: 'Ragweed', dwd: 'Ambrosia' },
];

export const POLLUTANTS = [
  { value: 'pm2_5', label: 'Fine particles (PM2.5)' },
  { value: 'pm10', label: 'Particles (PM10)' },
  { value: 'ozone', label: 'Ozone (O₃)' },
  { value: 'nitrogen_dioxide', label: 'Nitrogen dioxide (NO₂)' },
  { value: 'uv_index', label: 'UV index' },
];

// DWD forecast areas: partregion id, or the region id where a state has no partregions.
export const DWD_REGIONS = [
  { id: '11', name: 'Inseln und Marschen', region: 'Schleswig-Holstein und Hamburg' },
  { id: '12', name: 'Geest, Schleswig-Holstein und Hamburg', region: 'Schleswig-Holstein und Hamburg' },
  { id: '20', name: 'Mecklenburg-Vorpommern', region: '' },
  { id: '31', name: 'Westl. Niedersachsen/Bremen', region: 'Niedersachsen und Bremen' },
  { id: '32', name: 'Östl. Niedersachsen', region: 'Niedersachsen und Bremen' },
  { id: '41', name: 'Rhein.-Westfäl. Tiefland', region: 'Nordrhein-Westfalen' },
  { id: '42', name: 'Ostwestfalen', region: 'Nordrhein-Westfalen' },
  { id: '43', name: 'Mittelgebirge NRW', region: 'Nordrhein-Westfalen' },
  { id: '50', name: 'Brandenburg und Berlin', region: '' },
  { id: '61', name: 'Tiefland Sachsen-Anhalt', region: 'Sachsen-Anhalt' },
  { id: '62', name: 'Harz', region: 'Sachsen-Anhalt' },
  { id: '71', name: 'Tiefland Thüringen', region: 'Thüringen' },
  { id: '72', name: 'Mittelgebirge Thüringen', region: 'Thüringen' },
  { id: '81', name: 'Tiefland Sachsen', region: 'Sachsen' },
  { id: '82', name: 'Mittelgebirge Sachsen', region: 'Sachsen' },
  { id: '91', name: 'Nordhessen und hess. Mittelgebirge', region: 'Hessen' },
  { id: '92', name: 'Rhein-Main', region: 'Hessen' },
  { id: '101', name: 'Rhein, Pfalz, Nahe und Mosel', region: 'Rheinland-Pfalz und Saarland' },
  { id: '102', name: 'Mittelgebirgsbereich Rheinland-Pfalz', region: 'Rheinland-Pfalz und Saarland' },
  { id: '103', name: 'Saarland', region: 'Rheinland-Pfalz und Saarland' },
  { id: '111', name: 'Oberrhein und unteres Neckartal', region: 'Baden-Württemberg' },
  { id: '112', name: 'Hohenlohe/mittlerer Neckar/Oberschwaben', region: 'Baden-Württemberg' },
  { id: '113', name: 'Mittelgebirge Baden-Württemberg', region: 'Baden-Württemberg' },
  { id: '121', name: 'Allgäu/Oberbayern/Bay. Wald', region: 'Bayern' },
  { id: '122', name: 'Donauniederungen', region: 'Bayern' },
  { id: '123', name: 'Bayern nördl. der Donau, o. Bayr. Wald, o. Mainfranken', region: 'Bayern' },
  { id: '124', name: 'Mainfranken', region: 'Bayern' },
];

export default {
  type: 'airpollen',
  label: 'Pollen & air quality',
  description: 'Pollen forecast of the German Weather Service (DWD) and current air quality (Open-Meteo / CAMS)',
  defaultRegion: 'middle_right',
  defaultTitle: 'Pollen & air',
  refresh: 1800,
  fields: [
    ...locationFields,
    { key: 'showPollen', label: 'Show pollen', type: 'bool', default: true },
    { key: 'source', label: 'Pollen forecast', type: 'select', default: 'auto', showIf: { showPollen: true }, options: [
      { value: 'auto', label: 'Automatic (DWD in Germany, otherwise CAMS model)' },
      { value: 'dwd', label: 'DWD pollen forecast (Germany)' },
      { value: 'cams', label: 'CAMS model (Europe, fewer pollen types)' },
    ] },
    { key: 'dwdRegion', label: 'DWD forecast region', type: 'select', default: 'auto', showIf: { showPollen: true }, help: 'Only used for the DWD forecast. Automatic picks the region from the location.', options: [
      { value: 'auto', label: 'Automatic (from location)' },
      ...DWD_REGIONS.map((r) => ({ value: r.id, label: r.region ? `${r.region} – ${r.name}` : r.name })),
    ] },
    { key: 'pollenTypes', label: 'Pollen types', type: 'multiselect', default: ['hazel', 'alder', 'birch', 'grass', 'mugwort', 'ragweed'], options: POLLEN_TYPES.map(({ value, label }) => ({ value, label })), showIf: { showPollen: true } },
    { key: 'threshold', label: 'Minimum load to show a pollen type', type: 'select', default: '0.5', showIf: { showPollen: true }, options: [
      { value: '0', label: 'Always show' },
      { value: '0.5', label: 'Any (none to low)' },
      { value: '1', label: 'Low' },
      { value: '2', label: 'Medium' },
      { value: '3', label: 'High' },
    ] },
    { key: 'days', label: 'Days', type: 'select', default: '2', showIf: { showPollen: true }, options: [
      { value: '1', label: 'Today' },
      { value: '2', label: 'Today and tomorrow' },
      { value: '3', label: '3 days' },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List with level bars' },
      { value: 'chips', label: 'Compact chips' },
    ] },
    { key: 'showAir', label: 'Show air quality', type: 'bool', default: true },
    { key: 'pollutants', label: 'Pollutants', type: 'multiselect', default: ['pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide'], options: POLLUTANTS, showIf: { showAir: true } },
    { key: 'showAirForecast', label: "Show today's air quality peak", type: 'bool', default: true, showIf: { showAir: true } },
  ],
};
