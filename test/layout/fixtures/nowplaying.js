// Now playing: a Home Assistant media player that plays (fromHaState() in
// src/providers/nowplaying.js); the cover goes through the mirror's cover proxy.
import { iso, addMin, LONG } from './index.js';

export default ({ now, long }) => ({
  item: long
    ? {
      playing: true,
      title: `Sinfonie Nr. 9 d-Moll op. 125 „An die Freude“ – IV. Presto – Allegro assai (${LONG}-Remaster 2026)`,
      artist: 'Gewandhausorchester Leipzig, MDR-Rundfunkchor, Andris Nelsons, Christiane Karg, Wiebke Lehmkuhl',
      album: 'Beethoven: Sämtliche Sinfonien (Live aus dem Gewandhaus zu Leipzig)',
      device: 'Wohnzimmer Sonos Arc und Esszimmer Sonos Five (Gruppe)',
      duration: 1467,
      position: 812,
      positionAt: iso(addMin(now, -0.5)),
      cover: '/api/module/nowplaying/cover?v=9b1f3c27aa',
    }
    : {
      playing: true,
      title: 'Am Fenster',
      artist: 'City',
      album: 'Am Fenster',
      device: 'Wohnzimmer',
      duration: 1029,
      position: 214,
      positionAt: iso(addMin(now, -0.25)),
      cover: '/api/module/nowplaying/cover?v=4e8d0a61c2',
    },
});
