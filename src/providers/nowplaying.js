// Now playing: Home Assistant media players or the Spotify Web API. Covers of Home
// Assistant need its token, so the mirror loads them through /api/module/<id>/cover –
// only the cover URL last seen for that module is served, nothing else.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cached, fetchJson, fetchRaw } from '../util.js';
import { DATA_DIR } from '../config.js';
import { haConnection } from '../sensors.js';
import { normalizeUrl } from './homeassistant.js';
import { SPOTIFY_REDIRECT } from '../../public/shared/modules/nowplaying.js';

const covers = new Map(); // module id → { url, headers }
export const coverFor = (id) => covers.get(id) || null;

// ---- Home Assistant ----------------------------------------------------------------------
export function fromHaState(st) {
  const a = st?.attributes || {};
  const playing = st?.state === 'playing';
  if (!playing && st?.state !== 'paused') return null;
  if (!a.media_title && !a.media_artist) return null;
  const pos = Number(a.media_position);
  const updated = Date.parse(a.media_position_updated_at || '');
  return {
    playing,
    title: a.media_title || '',
    artist: a.media_artist || a.media_album_artist || a.media_series_title || '',
    album: a.media_album_name || '',
    device: a.friendly_name || st.entity_id,
    duration: Number(a.media_duration) || null,
    // position at "updatedAt"; the mirror moves it on while playing
    position: Number.isFinite(pos) ? pos : null,
    positionAt: Number.isFinite(updated) ? new Date(updated).toISOString() : new Date().toISOString(),
    picture: a.entity_picture || null,
  };
}

async function homeassistant(s, cfg, mod) {
  const ids = String(s.entities || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!ids.length) return { needsSetup: true };
  const conn = haConnection(cfg);
  if (!conn) throw new Error('Home Assistant: no connection configured');
  const base = normalizeUrl(conn.url);
  const headers = { Authorization: `Bearer ${String(conn.token).trim()}` };
  const states = await Promise.all(ids.map((id) => fetchJson(`${base}/api/states/${encodeURIComponent(id)}`, { timeout: 8000, headers }).catch(() => null)));
  const items = states.map(fromHaState).filter(Boolean);
  const item = items.find((x) => x.playing) || items[0] || null;
  if (item?.picture) {
    covers.set(mod.id, { url: item.picture.startsWith('http') ? item.picture : `${base}${item.picture}`, headers: item.picture.startsWith('http') ? {} : headers });
    item.cover = `/api/module/${encodeURIComponent(mod.id)}/cover?v=${crypto.createHash('sha1').update(item.picture).digest('hex').slice(0, 10)}`;
  }
  if (item) delete item.picture;
  return { item };
}

// ---- Spotify -------------------------------------------------------------------------------
// With PKCE Spotify may hand out a new refresh token on every refresh; the newest one is kept
// in data/spotify.json (keyed by the configured one), the config keeps working.
const TOKENS = path.join(DATA_DIR, 'spotify.json');
const keyOf = (t) => crypto.createHash('sha1').update(t).digest('hex');

async function readTokens() {
  try {
    return JSON.parse(await fs.readFile(TOKENS, 'utf8'));
  } catch {
    return {};
  }
}

async function spotifyAccess(clientId, configured) {
  return cached(`spotify:access:${keyOf(configured)}`, 50 * 60, async () => {
    const store = await readTokens();
    const current = store[keyOf(configured)] || configured;
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current, client_id: clientId }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error === 'invalid_grant' ? 'Spotify: access expired – connect again' : `Spotify: ${j.error_description || j.error || `HTTP ${res.status}`}`);
    if (j.refresh_token && j.refresh_token !== current) {
      store[keyOf(configured)] = j.refresh_token;
      await fs.writeFile(TOKENS, JSON.stringify(store), { mode: 0o600 }).catch(() => {});
    }
    return j.access_token;
  });
}

export function fromSpotify(j) {
  if (!j?.item) return null;
  const it = j.item;
  return {
    playing: !!j.is_playing,
    title: it.name || '',
    artist: (it.artists || []).map((a) => a.name).join(', ') || it.show?.name || '',
    album: it.album?.name || '',
    device: j.device?.name || '',
    duration: it.duration_ms ? it.duration_ms / 1000 : null,
    position: Number.isFinite(j.progress_ms) ? j.progress_ms / 1000 : null,
    positionAt: new Date(j.timestamp && Math.abs(Date.now() - j.timestamp) < 60000 ? j.timestamp : Date.now()).toISOString(),
    cover: (it.album?.images || it.images || []).sort((a, b) => Math.abs((a.width || 300) - 300) - Math.abs((b.width || 300) - 300))[0]?.url || null,
  };
}

async function spotify(s) {
  const clientId = String(s.spotifyClientId || '').trim();
  const refresh = String(s.spotifyRefreshToken || '').trim();
  if (!clientId || !refresh) return { needsSetup: true };
  const token = await spotifyAccess(clientId, refresh);
  const res = await fetchRaw('https://api.spotify.com/v1/me/player?additional_types=episode', { timeout: 10000, headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 204) return { item: null };
  return { item: fromSpotify(await res.json()) };
}

// "Connect" (PKCE, no client secret): the server keeps the verifier for 15 minutes; the user
// signs in at Spotify and pastes the address it redirects to (127.0.0.1 – nothing listens there).
const pending = new Map(); // state → { verifier, clientId, at }
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function spotifyStart(clientId) {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > 15 * 60000) pending.delete(k);
  const verifier = b64url(crypto.randomBytes(48));
  const state = b64url(crypto.randomBytes(12));
  pending.set(state, { verifier, clientId, at: now });
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT, code_challenge_method: 'S256', code_challenge: challenge, state, scope: 'user-read-playback-state user-read-currently-playing' });
  return `https://accounts.spotify.com/authorize?${q}`;
}

export async function spotifyFinish(pasted) {
  let url;
  try {
    url = new URL(String(pasted).trim());
  } catch {
    throw new Error('Spotify: paste the whole address from the browser');
  }
  if (url.searchParams.get('error')) throw new Error(`Spotify: ${url.searchParams.get('error')}`);
  const p = pending.get(url.searchParams.get('state') || '');
  const code = url.searchParams.get('code');
  if (!p || !code) throw new Error('Spotify: link expired – click "Connect" again');
  pending.delete(url.searchParams.get('state'));
  return spotifyExchange({ clientId: p.clientId, code, verifier: p.verifier });
}

async function spotifyExchange({ clientId, code, verifier }) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT, client_id: clientId, code_verifier: verifier }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.refresh_token) throw new Error(`Spotify: ${j.error_description || j.error || `HTTP ${res.status}`}`);
  return j.refresh_token;
}

export async function provider(settings, cfg, mod) {
  const out = settings.source === 'spotify' ? await spotify(settings) : await homeassistant(settings, cfg, mod);
  if (out.item && !out.item.playing && !settings.showPaused) out.item = null;
  return out;
}
