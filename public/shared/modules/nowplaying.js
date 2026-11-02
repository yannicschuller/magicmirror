// Now playing – what is playing right now (cover, title, artist, progress) from Home
// Assistant media players (Sonos, Chromecast, the Spotify integration, …) or Spotify
// directly. Hidden while nothing plays (unless "also when paused").

export const SPOTIFY_REDIRECT = 'http://127.0.0.1:8888/callback';

export default {
  type: 'nowplaying',
  label: 'Now playing',
  description: 'Cover, title and progress of the music playing right now (Home Assistant media player or Spotify)',
  defaultRegion: 'bottom_left',
  defaultTitle: '',
  refresh: 15,
  fields: [
    { key: 'source', label: 'Source', type: 'select', default: 'homeassistant', options: [
      { value: 'homeassistant', label: 'Home Assistant media players (Sonos, Chromecast, Spotify integration, …)' },
      { value: 'spotify', label: 'Spotify (directly)' },
    ] },
    { key: 'entities', label: 'Media players (entity IDs, comma-separated)', type: 'text', default: '', placeholder: 'media_player.living_room, media_player.spotify_anna', showIf: { source: 'homeassistant' },
      help: 'The first one that is playing is shown. The Home Assistant connection comes from the Home Assistant module (or General → Sensors).' },
    { key: 'spotifyClientId', label: 'Spotify client ID', type: 'text', default: '', showIf: { source: 'spotify' },
      help: 'developer.spotify.com → Dashboard → Create app (Web API), redirect URI: http://127.0.0.1:8888/callback – then copy the client ID here.' },
    { key: 'spotifyConnect', label: 'Spotify account', type: 'spotifyConnect', default: '', showIf: { source: 'spotify' } },
    { key: 'spotifyRefreshToken', label: 'Spotify refresh token (filled in by "Connect")', type: 'text', default: '', secret: true, showIf: { source: 'spotify' } },
    { key: 'showPaused', label: 'Also show while paused', type: 'bool', default: false },
    { key: 'showCover', label: 'Album cover', type: 'bool', default: true },
    { key: 'showProgress', label: 'Progress bar', type: 'bool', default: true },
    { key: 'showDevice', label: 'Show the player / device name', type: 'bool', default: false },
  ],
};
