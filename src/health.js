// Module health for the admin panel: which modules fail (or partly fail) when the mirrors
// fetch their data, since when, and with which error – so problems such as an expired token
// show up in the admin and not only as a small note on the mirror.
const state = new Map(); // id → { failingSince, lastError, failures, partial, lastOk, lastTry }

const GRACE_MS = 10 * 60 * 1000; // report after 10 min of failures (single hiccups are normal)

// Errors a provider reports inside its data (e.g. one of several calendars is unreachable).
function partialErrors(data) {
  if (!data || typeof data !== 'object') return [];
  const list = Array.isArray(data.errors) ? data.errors : [];
  return list.map((e) => (typeof e === 'string' ? e : e?.message || e?.error || JSON.stringify(e))).filter(Boolean).slice(0, 5);
}

export function recordSuccess(id, data) {
  const now = Date.now();
  const partial = partialErrors(data);
  const prev = state.get(id);
  state.set(id, { failingSince: null, lastError: null, failures: 0, partial, partialSince: partial.length ? prev?.partialSince || now : null, lastOk: now, lastTry: now });
}

export function recordFailure(id, error) {
  const now = Date.now();
  const prev = state.get(id) || {};
  state.set(id, { ...prev, failingSince: prev.failingSince || now, lastError: String(error || 'unknown error'), failures: (prev.failures || 0) + 1, lastTry: now });
}

// Problems worth showing for the enabled modules of `cfg`.
export function healthReport(cfg, now = Date.now()) {
  const out = [];
  for (const m of cfg.modules) {
    const s = state.get(m.id);
    if (!m.enabled || !s) continue;
    if (s.failingSince && (now - s.failingSince >= GRACE_MS || s.failures >= 3)) {
      out.push({ id: m.id, type: m.type, title: m.title, kind: 'error', since: new Date(s.failingSince).toISOString(), error: s.lastError, lastOk: s.lastOk ? new Date(s.lastOk).toISOString() : null });
    } else if (s.partial?.length && s.partialSince && now - s.partialSince >= GRACE_MS) {
      out.push({ id: m.id, type: m.type, title: m.title, kind: 'partial', since: new Date(s.partialSince).toISOString(), error: s.partial.join(' · '), lastOk: new Date(s.lastOk).toISOString() });
    }
  }
  return out;
}
