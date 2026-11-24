// Test data for the layout tests: one file per module type, default export
//   ({ now, settings, long, general }) => data
// returning exactly what the type's provider (src/providers/<type>.js) returns. "long"
// asks for the stress version: long names, many entries, big numbers.
// Types without a file get {} (they render without server data, e.g. clock, greeting).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const loaded = new Map();

export async function fixtureFor(type, args) {
  if (!loaded.has(type)) {
    const file = path.join(here, `${type}.js`);
    loaded.set(type, fs.existsSync(file) ? (await import(file)).default : () => ({}));
  }
  return loaded.get(type)(args);
}

// Placeholder for every image (covers, photos, cameras, map tiles): a calm gradient.
export const IMAGE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a3550"/><stop offset="1" stop-color="#4a2f45"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/></svg>';

// Helpers shared by the fixtures.
export const iso = (d) => new Date(d).toISOString();
export const addMin = (now, m) => new Date(now.getTime() + m * 60000);
export const addDays = (now, d) => new Date(now.getTime() + d * 86400000);
export const dayKey = (d, tz = 'Europe/Berlin') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const LONG = 'Donaudampfschifffahrtsgesellschaftskapitänsmützenabzeichen';
