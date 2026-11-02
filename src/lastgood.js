// Offline mode: the last good data of every module, kept in memory and written to disk now
// and then (and on shutdown), so the mirror keeps showing something sensible when the
// internet or a data source is down – even right after a reboot without internet.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'lastgood.json');
export const MAX_AGE_MS = 48 * 3600 * 1000; // older data is not worth showing
const MAX_BYTES = 256 * 1024; // per module – large payloads (maps, images) are skipped
const WRITE_EVERY_MS = 15 * 60 * 1000; // spare the SD card

let entries = null; // id → { at, key, data } – key: the module settings the data belongs to
let dirty = false;
let timer = null;

function load() {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const now = Date.now();
    for (const [id, e] of Object.entries(raw || {})) if (e && now - e.at < MAX_AGE_MS) entries.set(id, e);
  } catch {
    // no file yet / unreadable: start empty
  }
  return entries;
}

export function flushLastGood() {
  if (!dirty || !entries) return;
  dirty = false;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(Object.fromEntries(entries)));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (err) {
    console.warn(`[lastgood] ${err.message}`);
  }
}

export function rememberData(id, key, data, now = Date.now()) {
  const sig = JSON.stringify(data ?? null);
  if (sig.length > MAX_BYTES) return;
  const map = load();
  map.set(id, { at: now, key, data });
  dirty = true; // written at most every 15 minutes (and on shutdown)
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      flushLastGood();
    }, WRITE_EVERY_MS);
    timer.unref?.();
  }
}

// Last good data of a module with these settings, or null (none, too old, settings changed).
export function lastGood(id, key, now = Date.now()) {
  const e = load().get(id);
  return e && e.key === key && now - e.at < MAX_AGE_MS ? e : null;
}

export function forgetData(id) {
  if (load().delete(id)) dirty = true;
}

export function _resetLastGood() {
  entries = null;
  dirty = false;
  clearTimeout(timer);
  timer = null;
}
