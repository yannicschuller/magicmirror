import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { provider, fromHaState, fromSpotify, coverFor, spotifyStart, spotifyFinish } from '../src/providers/nowplaying.js';
import schema from '../public/shared/modules/nowplaying.js';
import { applyDefaults } from '../public/shared/modules.js';
import { CONDITIONS } from '../public/shared/conditions.js';
import de from '../public/shared/locales/de/modules/nowplaying.js';

const settings = (o) => ({ ...applyDefaults(schema.fields, {}), ...o });

test('Home Assistant state → item; idle players are nothing', () => {
  assert.equal(fromHaState({ state: 'idle', attributes: {} }), null);
  const it = fromHaState({ entity_id: 'media_player.wz', state: 'playing', attributes: { friendly_name: 'Wohnzimmer', media_title: 'Song', media_artist: 'Band', media_duration: 200, media_position: 50, media_position_updated_at: '2026-11-03T10:00:00Z', entity_picture: '/api/media_player_proxy/media_player.wz?token=x' } });
  assert.deepEqual([it.title, it.artist, it.device, it.duration, it.position, it.playing], ['Song', 'Band', 'Wohnzimmer', 200, 50, true]);
});

test('Spotify player → item with the cover closest to 300 px', () => {
  const it = fromSpotify({ is_playing: true, progress_ms: 61000, timestamp: Date.now(), device: { name: 'Küche' }, item: { name: 'Track', duration_ms: 180000, artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Alb', images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] } } });
  assert.deepEqual([it.title, it.artist, it.cover, it.duration, it.position], ['Track', 'A, B', 'mid', 180, 61]);
  assert.equal(fromSpotify({}), null);
});

test('provider (Home Assistant): first playing player, cover through the server, paused hidden', async () => {
  const states = {
    'media_player.a': { entity_id: 'media_player.a', state: 'paused', attributes: { media_title: 'Old', media_artist: 'X' } },
    'media_player.b': { entity_id: 'media_player.b', state: 'playing', attributes: { media_title: 'New', media_artist: 'Y', entity_picture: '/api/media_player_proxy/b?token=abc' } },
  };
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    const id = decodeURIComponent(String(url).split('/').pop());
    return new Response(JSON.stringify(states[id]), { status: 200 });
  });
  try {
    const cfg = { general: {}, modules: [{ type: 'homeassistant', settings: { url: 'http://ha:8123', token: 't' } }] };
    const d = await provider(settings({ entities: 'media_player.a, media_player.b' }), cfg, { id: 'np1' });
    assert.equal(d.item.title, 'New');
    assert.match(d.item.cover, /^\/api\/module\/np1\/cover\?v=/);
    assert.equal(coverFor('np1').url, 'http://ha:8123/api/media_player_proxy/b?token=abc');
    assert.equal(JSON.stringify(d).includes('token=abc'), false, 'the HA cover token stays on the server');
    states['media_player.b'].state = 'idle';
    assert.equal((await provider(settings({ entities: 'media_player.a, media_player.b' }), cfg, { id: 'np1' })).item, null, 'paused only → hidden');
    assert.equal((await provider(settings({ entities: 'media_player.a', showPaused: true }), cfg, { id: 'np1' })).item.title, 'Old');
    assert.equal(CONDITIONS.nowplaying.test({ item: { playing: true } }), true);
  } finally {
    fetchMock.mock.restore();
  }
});

test('Spotify connect: link with PKCE, pasted address is checked', async () => {
  const url = new URL(spotifyStart('0123456789abcdef0123456789abcdef'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8888/callback');
  await assert.rejects(spotifyFinish('not a url'), /whole address/);
  await assert.rejects(spotifyFinish('http://127.0.0.1:8888/callback?code=x&state=unknown'), /expired/);
  assert.deepEqual(await provider(settings({ source: 'spotify' }), {}, { id: 'x' }), { needsSetup: true });
});

test('German strings', () => {
  const ids = [schema.label, schema.description, CONDITIONS.nowplaying.label];
  for (const f of schema.fields) {
    ids.push(f.label);
    if (f.help) ids.push(f.help);
    if (f.placeholder && /[a-z]/i.test(f.placeholder)) ids.push(f.placeholder);
    for (const o of f.options || []) ids.push(o.label);
  }
  const src = readFileSync(new URL('../public/mirror/modules/nowplaying.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\bt\('([^']+)'/g)) ids.push(m[1]);
  ids.push('Connect Spotify in the module settings.', 'Enter a media player in the module settings.');
  for (const id of ids) assert.ok(de[id], `missing German: ${id}`);
});
