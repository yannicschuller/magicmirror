import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultConfig, normalizeConfig } from '../public/shared/modules.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'config.json');

let current = null;
const listeners = new Set();

export async function loadConfig() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    current = normalizeConfig(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Never silently overwrite a broken config – keep a copy for recovery.
      const backup = `${FILE}.broken-${Date.now()}`;
      await fs.copyFile(FILE, backup).catch(() => {});
      console.error(`[config] config.json unlesbar (${err.message}), Sicherung: ${backup}`);
    }
    current = null;
    await saveConfig(defaultConfig());
    console.log('[config] Standardkonfiguration angelegt');
  }
  return current;
}

export function getConfig() {
  return current;
}

export async function saveConfig(cfg) {
  const next = normalizeConfig(cfg);
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
