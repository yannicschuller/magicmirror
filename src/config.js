import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultConfig, normalizeConfig, DEFAULT_LOCALE } from '../public/shared/modules.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'config.json');
// Language/format of a fresh install (the installer asks for it).
export const DEFAULT_LOCALE_ENV = process.env.MM_LOCALE || DEFAULT_LOCALE;

let current = null;
const listeners = new Set();

export async function loadConfig() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    current = normalizeConfig(JSON.parse(await fs.readFile(FILE, 'utf8')), DEFAULT_LOCALE_ENV);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Never silently overwrite a broken config – keep a copy for recovery.
      const backup = `${FILE}.broken-${Date.now()}`;
      await fs.copyFile(FILE, backup).catch(() => {});
      console.error(`[config] config.json unreadable (${err.message}), backup: ${backup}`);
    }
    current = null;
    await saveConfig(defaultConfig(DEFAULT_LOCALE_ENV));
    console.log(`[config] created default configuration (${DEFAULT_LOCALE_ENV})`);
  }
  return current;
}

export function getConfig() {
  return current;
}

export async function saveConfig(cfg) {
  const next = normalizeConfig(cfg, DEFAULT_LOCALE_ENV);
  next.updatedAt = new Date().toISOString();
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2));
  await fs.rename(tmp, FILE);
  current = next;
  for (const fn of listeners) {
    try { fn(next); } catch (err) { console.error('[config] listener', err); }
  }
  return next;
}

export function onConfigChange(fn) {
  listeners.add(fn);
}
