// Screen state: night mode from the config plus a manual override from the admin / remote
// page ("screen off", "night now", "screen on" – optionally for a number of minutes).
// Mirrors get changes via SSE; the kiosk polls GET /api/display to switch an HDMI-CEC screen.
import { displayState } from '../public/shared/night.js';
import { broadcast } from './events.js';
import { sensorState } from './sensors.js';

let override = null; // { mode: 'off' | 'on' | 'night', until: ISO | null }

const current = () => (override && override.until && Date.parse(override.until) <= Date.now() ? (override = null) : override);

export function getDisplay(cfg) {
  const s = sensorState();
  const sensors = { absent: s.absent, brightness: s.brightness };
  return { ...displayState(cfg.general, new Date(), current(), sensors), override: current(), sensors };
}

export function setDisplayOverride(mode, minutes) {
  override = ['off', 'on', 'night'].includes(mode)
    ? { mode, until: minutes > 0 ? new Date(Date.now() + minutes * 60000).toISOString() : null }
    : null;
  broadcast('display', { override, sensors: sensorsOut() });
  return override;
}

const sensorsOut = () => {
  const s = sensorState();
  return { absent: s.absent, brightness: s.brightness };
};

// Sensor values changed (presence, light): tell the mirrors.
export function sensorsChanged() {
  broadcast('display', { override: current(), sensors: sensorsOut() });
}
