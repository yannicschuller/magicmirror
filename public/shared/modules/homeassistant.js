// Home Assistant – selected entity states via the REST API (/api/states).

export const HA_ICONS = [
  { value: 'auto', label: 'Automatic (from device class)' },
  { value: 'thermometer', label: 'Thermometer' },
  { value: 'humidity', label: 'Humidity' },
  { value: 'window', label: 'Window' },
  { value: 'door', label: 'Door' },
  { value: 'power', label: 'Power button' },
  { value: 'bolt', label: 'Electricity' },
  { value: 'light', label: 'Light' },
  { value: 'lock', label: 'Lock' },
  { value: 'plug', label: 'Plug / switch' },
  { value: 'sun', label: 'Sun / PV' },
  { value: 'battery', label: 'Battery' },
  { value: 'generic', label: 'Generic' },
];

export default {
  type: 'homeassistant',
  label: 'Home Assistant',
  description: 'Selected entity states, e.g. indoor temperature, open windows, power consumption',
  defaultRegion: 'middle_right',
  defaultTitle: 'Smart home',
  refresh: 30,
  fields: [
    { key: 'url', label: 'Home Assistant URL', type: 'text', default: '', secret: true, placeholder: 'http://homeassistant.local:8123' },
    { key: 'token', label: 'Long-lived access token (profile → security)', type: 'text', default: '', secret: true },
    { key: 'entities', label: 'Entities', type: 'list', itemLabel: 'Entity', default: [], fields: [
      { key: 'entity', label: 'Entity ID', type: 'text', default: '', placeholder: 'sensor.living_room_temperature' },
      { key: 'label', label: 'Label (empty = name from Home Assistant)', type: 'text', default: '' },
      { key: 'icon', label: 'Icon', type: 'select', default: 'auto', options: HA_ICONS },
      { key: 'showWhen', label: 'Visibility', type: 'select', default: 'always', options: [
        { value: 'always', label: 'Always' },
        { value: 'on', label: 'Only when on / open' },
        { value: 'off', label: 'Only when off / closed' },
      ] },
      { key: 'decimals', label: 'Decimal places', type: 'select', default: 'auto', options: [
        { value: 'auto', label: 'Automatic' }, { value: '0', label: '0' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
      ] },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List' }, { value: 'grid', label: 'Tiles' },
    ] },
    { key: 'columns', label: 'Columns', type: 'number', default: 3, min: 1, max: 6, showIf: { layout: 'grid' } },
    { key: 'highlightActive', label: 'Highlight open / switched-on entities', type: 'bool', default: true },
  ],
};
