// Aircraft details beyond what the live feeds send:
// - type names ("B77W" → "Boeing 777-300ER") from a small bundled table (src/data/aircraft-types.json,
//   the most common description per ICAO type code in the open tar1090-db by wiedehopf)
// - build year per aircraft from the full tar1090-db (aircraft.csv.gz, ~8 MB). It is downloaded
//   only when the year option is on, refreshed every two weeks, and searched as a stream for
//   the one aircraft that is shown – nothing big is kept in memory (Raspberry Pi 3).
//   The year is mostly known for US-registered aircraft.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { DATA_DIR } from '../config.js';

const TYPES = createRequire(import.meta.url)('../data/aircraft-types.json');
const DB_URL = 'https://raw.githubusercontent.com/wiedehopf/tar1090-db/csv/aircraft.csv.gz';
const DB_FILE = path.join(DATA_DIR, 'aircraft-db.csv.gz');
const MAX_AGE = 14 * 86400 * 1000;

export const typeName = (code) => TYPES[String(code || '').toUpperCase()] || '';

let download = null;
async function ensureDb() {
  const stat = await fsp.stat(DB_FILE).catch(() => null);
  if (stat && Date.now() - stat.mtimeMs < MAX_AGE) return true;
  download ??= (async () => {
    try {
      const res = await fetch(DB_URL, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tmp = `${DB_FILE}.tmp`;
      await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      await fsp.rename(tmp, DB_FILE);
      console.log('[flights] aircraft database updated');
    } catch (err) {
      console.warn(`[flights] aircraft database: ${err.message}`);
    } finally {
      download = null;
    }
  })();
  await download;
  return fs.existsSync(DB_FILE);
}

// hex → { year, desc } (null = unknown); looked up in the background.
const years = new Map();
const pending = new Set();

// Columns: icao;reg;type;flags;desc;year;ownOp
export function parseDbLine(line) {
  const p = line.split(';');
  const year = Number(p[5]);
  return { hex: p[0].toLowerCase(), desc: p[4] || '', year: year >= 1900 && year <= 2100 ? year : null };
}

async function lookup(hex) {
  if (!(await ensureDb())) return null;
  const prefix = `${hex.toUpperCase()};`;
  const rl = readline.createInterface({ input: fs.createReadStream(DB_FILE).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.startsWith(prefix)) return parseDbLine(line);
    }
  } finally {
    rl.close();
  }
  return null;
}

// Returns the known details now (or undefined while the lookup still runs).
export function aircraftDetails(hex) {
  if (!hex) return null;
  const key = hex.toLowerCase();
  if (years.has(key)) return years.get(key);
  if (!pending.has(key)) {
    pending.add(key);
    lookup(key)
      .then((r) => years.set(key, r))
      .catch(() => years.set(key, null))
      .finally(() => pending.delete(key));
    if (years.size > 2000) years.delete(years.keys().next().value);
  }
  return undefined;
}
