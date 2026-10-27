// "Leave now" traffic light for the transit board – pure helpers (unit-tested).
//
// leave = minutes until you must leave = departure − now − walkMinutes.
//   relaxed: leave ≥ buffer + rush
//   go:      0 ≤ leave < buffer + rush     ("leave now")
//   run:     −rush ≤ leave < 0             (still reachable if you hurry)
//   gone:    leave < −rush                 (can't be reached anymore)

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

export function goOptions(s = {}) {
  return {
    walk: Math.max(0, num(s.walkMinutes, 0)),
    buffer: Math.max(0, num(s.bufferMinutes, 2)),
    rush: Math.max(0, num(s.rushMinutes, 3)),
  };
}

export function goStatus(departMs, nowMs, settings) {
  const { walk, buffer, rush } = goOptions(settings);
  const leave = (departMs - nowMs) / 60000 - walk;
  const level = leave >= buffer + rush ? 'relaxed' : leave >= 0 ? 'go' : leave >= -rush ? 'run' : 'gone';
  return { leave, level };
}

const splitList = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

// Next departure that can still be reached (optionally only the given lines).
export function nextReachable(departures, nowMs, settings, lines = settings?.goNowLines) {
  const only = splitList(lines);
  for (const d of departures) {
    if (d.cancelled) continue;
    if (only.length && !only.includes(String(d.line).toLowerCase())) continue;
    const st = goStatus(new Date(d.realtime || d.planned).getTime(), nowMs, settings);
    if (st.level !== 'gone') return { departure: d, ...st };
  }
  return null;
}
