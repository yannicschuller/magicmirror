// Device status – health of the machine the mirror server runs on (usually a
// Raspberry Pi in Docker). Read locally from /proc and /sys, no API.

export const PISTATUS_ITEMS = [
  { value: 'temp', label: 'CPU temperature' },
  { value: 'cpu', label: 'CPU usage' },
  { value: 'load', label: 'Load average' },
  { value: 'ram', label: 'Memory (RAM)' },
  { value: 'disk', label: 'Disk space (data volume)' },
  { value: 'uptime', label: 'Uptime' },
  { value: 'power', label: 'Power supply & throttling (Raspberry Pi)' },
];

export default {
  type: 'pistatus',
  label: 'Device status',
  description: 'Temperature, CPU, memory, disk space and power supply of the device the mirror runs on',
  defaultRegion: 'bottom_left',
  defaultTitle: 'Device',
  refresh: 30,
  fields: [
    { key: 'show', label: 'Show', type: 'multiselect', default: ['temp', 'cpu', 'ram', 'disk', 'uptime', 'power'], options: PISTATUS_ITEMS,
      help: 'Values the device does not provide (e.g. temperature in Docker on a Mac) are hidden automatically.' },
    { key: 'layout', label: 'Layout', type: 'select', default: 'tiles', options: [
      { value: 'compact', label: 'Compact (one line)' },
      { value: 'tiles', label: 'Tiles with bars' },
      { value: 'sparkline', label: 'Curves for temperature and CPU' },
    ] },
    { key: 'tempWarn', label: 'Warn from CPU temperature (°C)', type: 'number', default: 70, min: 40, max: 95 },
    { key: 'ramWarn', label: 'Warn from memory usage (%)', type: 'number', default: 90, min: 50, max: 100 },
    { key: 'diskWarn', label: 'Warn from disk usage (%)', type: 'number', default: 90, min: 50, max: 100 },
    { key: 'pastThrottling', label: 'Also warn about past under-voltage/throttling (since boot)', type: 'bool', default: false,
      help: 'The Raspberry Pi remembers these events until the next reboot.' },
    { key: 'refreshSeconds', label: 'Update interval (seconds, min. 10)', type: 'number', default: 30, min: 10, max: 600 },
  ],
};
