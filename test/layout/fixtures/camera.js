// Camera (inline provider in src/server.js): { streams: [{ name, src }] } – src is the go2rtc
// stream name. The default settings have no streams, so the test always shows some.
import { LONG } from './index.js';

export default ({ settings, long }) => {
  const configured = (settings.streams || []).filter((s) => s.enabled && s.url).map((s, i) => ({ name: s.name, src: `mm_layout_${i}` }));
  if (configured.length) return { streams: configured };
  const names = long
    ? ['Haustür', 'Garten hinten', `Einfahrt ${LONG}`, 'Garage', 'Kinderzimmer', 'Treppenhaus Erdgeschoss', 'Carport', 'Terrasse']
    : ['Haustür', 'Garten'];
  return { streams: names.map((name, i) => ({ name, src: `mm_layout_${i}` })) };
};
