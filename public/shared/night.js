// Night mode: when the mirror is dimmed / reduced to a clock / switched off. Shared by the
// mirror (what to draw) and the server (/api/display – read by the kiosk to put an HDMI-CEC
// screen into standby).
import { sunTimes } from './astro.js';

const minutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function localMinutes(date, tz) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return minutes(p);
}

// Is it night by the configured trigger (fixed times or sunset → sunrise)?
export function isNight(g, now = new Date()) {
  if (!g?.dimEnabled) return false;
  if (g.nightTrigger === 'sun' && g.location && Number.isFinite(g.location.lat)) {
    const offset = (Number(g.nightOffset) || 0) * 60000;
    const t = now.getTime();
    // today's sunrise/sunset (noon as reference avoids picking the wrong day around midnight)
    const noon = new Date(now);
    noon.setUTCHours(12, 0, 0, 0);
    const s = sunTimes(noon, g.location.lat, g.location.lon);
    const rise = s.sunrise?.getTime();
    const set = s.sunset?.getTime();
    if (!Number.isFinite(rise) || !Number.isFinite(set)) return false; // polar day/night
    return t >= set + offset || t < rise - offset;
  }
  const cur = localMinutes(now, g.timezone);
  const from = minutes(g.dimFrom);
  const to = minutes(g.dimTo);
  if (cur === null || from === null || to === null || from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

// What the screen should do now. override (remote control): { mode: 'off' | 'on' | 'night', until }
// → { mode: 'day' | 'dim' | 'clock' | 'off', brightness: 0–1 }
export function displayState(g, now = new Date(), override = null) {
  const active = override && (!override.until || Date.parse(override.until) > now.getTime()) ? override.mode : null;
  if (active === 'on') return { mode: 'day', brightness: 1 };
  if (active === 'off') return { mode: 'off', brightness: 0 };
  const night = active === 'night' || isNight(g, now);
  if (!night) return { mode: 'day', brightness: 1 };
  const mode = g.nightMode === 'off' ? 'off' : g.nightMode === 'clock' ? 'clock' : 'dim';
  const level = Math.min(100, Math.max(0, Number(g.dimBrightness ?? 30))) / 100;
  return { mode, brightness: mode === 'off' ? 0 : level };
}
