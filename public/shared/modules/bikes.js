// Bike & scooter sharing nearby – any public GBFS feed (v2.x or v3.0).
// Presets are taken from the MobilityData systems catalogue
// (github.com/MobilityData/gbfs/blob/master/systems.csv) and only list feeds
// that are public without a key.
import { locationFields } from '../fields.js';

const NB = 'https://gbfs.nextbike.net/maps/gbfs/v2';
const DOTT = 'https://gbfs.api.ridedott.com/public/v2';
const MBW = 'https://api.mobidata-bw.de/sharing/gbfs/v3';

const nextbike = (id, city) => ({ value: `nextbike_${id}`, label: `nextbike – ${city}`, url: `${NB}/nextbike_${id}/gbfs.json` });
const dott = (id, city) => ({ value: `dott_${id}`, label: `Dott – ${city}`, url: `${DOTT}/${id}/gbfs.json` });
const mobidata = (id, label) => ({ value: `mbw_${id}`, label, url: `${MBW}/${id}/gbfs` });

export const BIKE_PRESETS = [
  nextbike('bn', 'Berlin'),
  nextbike('dx', 'Dresden (MOBIbike)'),
  nextbike('dd', 'Düsseldorf'),
  nextbike('df', 'Freiburg (Frelo)'),
  nextbike('mx', 'Halle (movemix)'),
  nextbike('dh', 'Hannover'),
  nextbike('fg', 'Karlsruhe (KVV.nextbike)'),
  nextbike('dk', 'Kassel'),
  nextbike('kg', 'Köln (KVB-Rad)'),
  nextbike('le', 'Leipzig'),
  nextbike('mz', 'Mainz (meinRad)'),
  nextbike('ml', 'München (MyRadl)'),
  nextbike('dv', 'Nürnberg (VAG_Rad)'),
  nextbike('dc', 'Potsdam'),
  nextbike('vn', 'Rhein-Neckar (VRNnextbike)'),
  nextbike('wn', 'Wiesbaden'),
  nextbike('wa', 'Bonn (welo)'),
  nextbike('bq', 'Bremen'),
  nextbike('dg', 'Bielefeld (meinSiggi)'),
  nextbike('dn', 'Braunschweig (Veloleo)'),
  dott('aachen', 'Aachen'),
  dott('berlin', 'Berlin'),
  dott('dusseldorf', 'Düsseldorf'),
  dott('essen', 'Essen'),
  dott('hannover', 'Hannover'),
  dott('heidelberg', 'Heidelberg'),
  dott('cologne', 'Köln'),
  dott('leipzig', 'Leipzig'),
  dott('munich', 'München'),
  dott('munster', 'Münster'),
  dott('potsdam', 'Potsdam'),
  dott('stuttgart', 'Stuttgart'),
  mobidata('callabike', 'Call a Bike (Deutsche Bahn)'),
  mobidata('regiorad_stuttgart', 'RegioRad Stuttgart'),
  mobidata('bolt_stuttgart', 'Bolt – Stuttgart'),
  mobidata('bolt_karlsruhe', 'Bolt – Karlsruhe'),
  mobidata('bolt_reutlingen_tuebingen', 'Bolt – Reutlingen/Tübingen'),
  mobidata('voi_de', 'Voi – Baden-Württemberg'),
  mobidata('lime_bw', 'Lime – Stuttgart/Konstanz'),
];

export const VEHICLE_KINDS = [
  { value: 'bike', label: 'Bikes' },
  { value: 'ebike', label: 'E-bikes' },
  { value: 'cargo', label: 'Cargo bikes' },
  { value: 'scooter', label: 'E-scooters' },
  { value: 'moped', label: 'E-mopeds' },
];

export default {
  type: 'bikes',
  label: 'Bike & scooter sharing',
  description: 'Nearest sharing stations with available bikes, and free-floating e-scooters nearby (any public GBFS feed, e.g. nextbike, Dott, Bolt, Voi)',
  defaultRegion: 'middle_right',
  defaultTitle: 'Bikes nearby',
  refresh: 90,
  fields: [
    { key: 'feeds', label: 'Sharing systems', type: 'list', itemLabel: 'System', default: [], fields: [
      { key: 'preset', label: 'System', type: 'select', default: 'nextbike_le', options: [
        ...BIKE_PRESETS.map(({ value, label }) => ({ value, label })),
        { value: 'custom', label: 'Other GBFS feed (URL)' },
      ] },
      { key: 'url', label: 'GBFS auto-discovery URL (gbfs.json)', type: 'text', default: '', showIf: { preset: 'custom' }, placeholder: 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_le/gbfs.json', help: 'Find public feeds at github.com/MobilityData/gbfs (systems.csv). GBFS 2.x and 3.0 are supported.' },
      { key: 'name', label: 'Name (optional)', type: 'text', default: '', placeholder: 'nextbike' },
    ] },
    ...locationFields,
    { key: 'radius', label: 'Radius (m)', type: 'number', default: 500, min: 100, max: 3000, step: 50 },
    { key: 'maxStations', label: 'Number of stations', type: 'number', default: 3, min: 0, max: 10 },
    { key: 'hideEmpty', label: 'Hide stations without available vehicles', type: 'bool', default: false },
    { key: 'showFreeFloating', label: 'Count free-floating vehicles within the radius', type: 'bool', default: true },
    { key: 'kinds', label: 'Vehicle types', type: 'multiselect', default: ['bike', 'ebike', 'cargo', 'scooter'], options: VEHICLE_KINDS },
    { key: 'showDocks', label: 'Show free docks', type: 'bool', default: false },
    { key: 'showDistance', label: 'Show distance', type: 'bool', default: true },
    { key: 'showWalk', label: 'Show walking time (estimated)', type: 'bool', default: false },
    { key: 'showDirection', label: 'Show direction arrow', type: 'bool', default: true },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List' },
      { value: 'compact', label: 'Compact' },
    ] },
  ],
};
