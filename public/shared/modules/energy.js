// Electricity – dynamic prices (day-ahead exchange price via Energy-Charts / aWATTar, or
// your Tibber tariff), the cheapest hours and optionally solar, grid and battery from
// Home Assistant.

export const PRICE_ZONES = [
  { value: 'DE-LU', label: 'Germany / Luxembourg' },
  { value: 'AT', label: 'Austria' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'FR', label: 'France' },
  { value: 'DK1', label: 'Denmark (west)' },
  { value: 'DK2', label: 'Denmark (east)' },
];

export default {
  type: 'energy',
  label: 'Electricity',
  description: 'Dynamic electricity price (exchange price or Tibber), the cheapest hours and optionally solar/battery from Home Assistant',
  defaultRegion: 'middle_right',
  defaultTitle: 'Electricity',
  refresh: 300,
  fields: [
    { key: 'source', label: 'Price source', type: 'select', default: 'exchange', options: [
      { value: 'exchange', label: 'Exchange price (day-ahead, Energy-Charts – no account)' },
      { value: 'tibber', label: 'Tibber (your tariff incl. all fees)' },
    ] },
    { key: 'zone', label: 'Price zone', type: 'select', default: 'DE-LU', options: PRICE_ZONES, showIf: { source: 'exchange' } },
    { key: 'surcharge', label: 'Surcharge in ct/kWh (grid fees, taxes, provider margin)', type: 'number', default: 0, min: 0, max: 100, showIf: { source: 'exchange' },
      help: 'Added to the exchange price for an approximate end price. In Germany roughly 15–20 ct/kWh; your contract says how much exactly. 0 = pure exchange price.' },
    { key: 'vat', label: 'VAT on top (%)', type: 'number', default: 0, min: 0, max: 30, showIf: { source: 'exchange' },
      help: 'E.g. 19 in Germany, applied to exchange price and surcharge. 0 = none.' },
    { key: 'tibberToken', label: 'Tibber access token', type: 'text', default: '', secret: true, showIf: { source: 'tibber' },
      help: 'developer.tibber.com → Sign in → Access token.' },
    { key: 'showChart', label: 'Price chart (today and, from about 13:00, tomorrow)', type: 'bool', default: true },
    { key: 'windowHours', label: 'Cheapest time window (hours, 0 = off)', type: 'number', default: 3, min: 0, max: 12,
      help: 'Shows the cheapest block of this length from now on – good for the washing machine, dishwasher or charging the car.' },
    { key: 'cheapBelow', label: 'Cheap below (ct/kWh, 0 = automatic)', type: 'number', default: 0, min: 0, max: 200,
      help: 'Automatic: at least 10 % below the day\'s average. Used for the colors and "only show when electricity is cheap".' },
    { key: 'pvEntity', label: 'Solar power (Home Assistant entity, W or kW)', type: 'text', default: '', placeholder: 'sensor.pv_power' },
    { key: 'gridEntity', label: 'Grid power (W or kW, + = import, − = export)', type: 'text', default: '', placeholder: 'sensor.grid_power' },
    { key: 'batteryEntity', label: 'Battery charge (%)', type: 'text', default: '', placeholder: 'sensor.battery_soc',
      help: 'The Home Assistant connection comes from the Home Assistant module (or General → Sensors).' },
  ],
};
