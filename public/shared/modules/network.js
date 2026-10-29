// Internet & network – online status, latency, DNS, optional speed test and
// public IP, presence of devices at home. Measured on the server.

export default {
  type: 'network',
  label: 'Internet & network',
  description: 'Online status, latency, speed test and which devices or people are at home',
  defaultRegion: 'bottom_right',
  defaultTitle: '',
  refresh: 60,
  fields: [
    { key: 'layout', label: 'Layout', type: 'select', default: 'detailed', options: [
      { value: 'detailed', label: 'Detailed' },
      { value: 'compact', label: 'Compact (one line)' },
    ] },
    { key: 'targets', label: 'Test targets (host:port, comma-separated)', type: 'text', default: '1.1.1.1:443, 9.9.9.9:443', placeholder: '1.1.1.1:443, 9.9.9.9:443',
      help: 'Latency is the time to open a TCP connection (ping is not available in the container). Without a port, 443 is used.' },
    { key: 'samples', label: 'Measurements per target', type: 'number', default: 3, min: 1, max: 10, help: 'The median of all measurements is shown.' },
    { key: 'warnMs', label: 'Latency warning from (ms)', type: 'number', default: 80, min: 0, max: 5000 },
    { key: 'badMs', label: 'Latency alert from (ms)', type: 'number', default: 250, min: 0, max: 10000 },
    { key: 'dnsHost', label: 'Check DNS with this host name (empty = off)', type: 'text', default: 'cloudflare.com', placeholder: 'cloudflare.com' },
    { key: 'showSparkline', label: 'Latency history chart', type: 'bool', default: true, showIf: { layout: 'detailed' } },
    { key: 'showTargets', label: 'Latency per target', type: 'bool', default: false, showIf: { layout: 'detailed' } },
    { key: 'refreshSeconds', label: 'Update interval (seconds)', type: 'number', default: 60, min: 30, max: 900 },

    { key: 'speedTest', label: 'Speed test (Cloudflare)', type: 'bool', default: false,
      help: 'Downloads test data from speed.cloudflare.com. Uses data volume and briefly loads the line – keep the interval long.' },
    { key: 'speedInterval', label: 'Run speed test every … hours', type: 'number', default: 6, min: 1, max: 48, showIf: { speedTest: true } },
    { key: 'speedSize', label: 'Test size (MB)', type: 'number', default: 10, min: 1, max: 50, showIf: { speedTest: true } },
    { key: 'speedUpload', label: 'Also measure upload', type: 'bool', default: false, showIf: { speedTest: true } },

    { key: 'publicIp', label: 'Show public IP address', type: 'bool', default: false, help: 'Asked from Cloudflare (1.1.1.1/cdn-cgi/trace). Visible to anyone in front of the mirror.' },

    { key: 'presence', label: 'Who is at home', type: 'select', default: 'off', options: [
      { value: 'off', label: 'Off' },
      { value: 'probe', label: 'Check devices in the network' },
      { value: 'homeassistant', label: 'Home Assistant (person / device_tracker)' },
    ] },
    { key: 'devices', label: 'Devices', type: 'list', itemLabel: 'Device', default: [], showIf: { presence: 'probe' }, fields: [
      { key: 'name', label: 'Name', type: 'text', default: '', placeholder: 'Anna' },
      { key: 'host', label: 'IP address or host name', type: 'text', default: '', placeholder: '192.168.1.23' },
      { key: 'port', label: 'Port (0 = try common ports)', type: 'number', default: 0, min: 0, max: 65535 },
    ] },
    { key: 'graceMinutes', label: 'Still count as home for … minutes after last seen', type: 'number', default: 10, min: 0, max: 120, showIf: { presence: 'probe' },
      help: 'Phones in standby do not always answer. Give them a fixed IP address in your router.' },
    { key: 'haUrl', label: 'Home Assistant URL', type: 'text', default: '', secret: true, placeholder: 'http://homeassistant.local:8123', showIf: { presence: 'homeassistant' } },
    { key: 'haToken', label: 'Long-lived access token', type: 'text', default: '', secret: true, showIf: { presence: 'homeassistant' } },
    { key: 'haEntities', label: 'People / trackers', type: 'list', itemLabel: 'Entity', default: [], showIf: { presence: 'homeassistant' }, fields: [
      { key: 'name', label: 'Name (optional)', type: 'text', default: '' },
      { key: 'entity', label: 'Entity ID', type: 'text', default: '', placeholder: 'person.anna' },
    ] },
    { key: 'showAway', label: 'Also show who is away', type: 'bool', default: true },
  ],
};
