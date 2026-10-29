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

// ---- history: the previous states, newest first (data/history/<time>.json) -----------------
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const HISTORY_MAX = 20;

async function remember(prev) {
  if (!prev) return;
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const id = (prev.updatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  await fs.writeFile(path.join(HISTORY_DIR, `${id}.json`), JSON.stringify(prev));
  const files = (await fs.readdir(HISTORY_DIR)).filter((f) => f.endsWith('.json')).sort().reverse();
  await Promise.all(files.slice(HISTORY_MAX).map((f) => fs.rm(path.join(HISTORY_DIR, f), { force: true })));
}

export async function listHistory() {
  const files = await fs.readdir(HISTORY_DIR).catch(() => []);
  const out = [];
  for (const f of files.filter((x) => x.endsWith('.json')).sort().reverse()) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, f), 'utf8'));
      out.push({ id: f.slice(0, -5), savedAt: c.updatedAt || null, pages: c.pages?.length || 0, modules: c.modules?.length || 0 });
    } catch {
      // unreadable entry – skip
    }
  }
  return out;
}

export async function readHistory(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(HISTORY_DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

export async function saveConfig(cfg) {
  const next = normalizeConfig(cfg, DEFAULT_LOCALE_ENV);
  // keep the state being replaced (not the very first default config)
  await remember(current).catch((err) => console.warn(`[config] history: ${err.message}`));
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
