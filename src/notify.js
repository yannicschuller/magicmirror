// Push notifications on the mirror ("Washing machine done", "Parcel has arrived"): sent via
// the control API (Homey, Shortcuts, Home Assistant) or an ntfy topic the server subscribes
// to. The mirrors show them as a card on top of everything for a few seconds.
import crypto from 'node:crypto';

const LEVELS = new Set(['info', 'success', 'warn', 'alert']);
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Normalizes a notification from any source; null when there is nothing to show.
export function makeNotification(input, general = {}) {
  const title = clip(input.title, 120);
  const message = clip(input.message ?? input.text ?? input.body, 400);
  if (!title && !message) return null;
  const level = LEVELS.has(input.level) ? input.level : 'info';
  const fallback = Math.min(600, Math.max(3, Number(general.notifyDuration) || 15));
  const duration = Math.min(600, Math.max(3, Number(input.duration) || (level === 'alert' ? fallback * 2 : fallback)));
  return {
    id: crypto.randomBytes(6).toString('hex'),
    title,
    message,
    level,
    icon: clip(input.icon, 32) || null,
    duration,
    // switch a screen that is off (night mode, nobody there) on for the notification
    wake: input.wake === undefined ? level === 'alert' : input.wake === true || /^(1|true|yes|ja)$/i.test(String(input.wake)),
    at: new Date().toISOString(),
  };
}

// ntfy message → notification (priority 4–5 = warn/alert, tags as icon hints).
export function fromNtfy(m) {
  const level = m.priority >= 5 ? 'alert' : m.priority >= 4 ? 'warn' : 'info';
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const icon = ['package', 'warning', 'bell', 'door', 'washing_machine', 'check', 'fire', 'rain', 'car'].find((x) => tags.includes(x)) || null;
  return { title: m.title || '', message: m.message || '', level, icon };
}

let ntfy = null; // { url, abort }

// Subscribes to an ntfy topic (https://ntfy.sh/<topic> or your own server) and calls `onMessage`.
export function syncNtfy(general, onMessage) {
  const url = String(general.ntfyTopicUrl || '').trim().replace(/\/+$/, '');
  if (ntfy?.url === url) return;
  ntfy?.abort.abort();
  ntfy = null;
  if (!/^https?:\/\/[^/]+\/[\w-]+$/.test(url)) return;
  const abort = new AbortController();
  ntfy = { url, abort };
  let delay = 5000;
  const connect = async () => {
    while (!abort.signal.aborted) {
      try {
        const headers = general.ntfyToken ? { Authorization: `Bearer ${general.ntfyToken}` } : {};
        const res = await fetch(`${url}/json`, { headers, signal: abort.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        delay = 5000;
        let buf = '';
        const decoder = new TextDecoder();
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            try {
              const m = JSON.parse(line);
              if (m.event === 'message') onMessage(fromNtfy(m));
            } catch {
              // not JSON – ignore
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        console.warn(`[ntfy] ${err.message} – reconnecting in ${delay / 1000} s`);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(300000, delay * 2);
    }
  };
  connect();
}
