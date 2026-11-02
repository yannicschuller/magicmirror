// Automatic backups of the data directory (configuration, history, accounts, module data):
// a .tar.gz in data/backups (the last N are kept, downloadable in the admin), copied on
// request to a USB stick or an SMB share (both done by the updater – it may mount things)
// and/or uploaded to WebDAV (Nextcloud, …) by the server itself.
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR } from './config.js';
import { dateKey } from './util.js';
import { parseTime } from './control.js';

const run = promisify(execFile);
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const STATUS = path.join(BACKUP_DIR, 'status.json');
export const NAME_RE = /^magicmirror-\d{4}-\d{2}-\d{2}_\d{4}(-\d+)?\.tar\.gz$/;

let running = null;

export async function listBackups() {
  const names = await fs.readdir(BACKUP_DIR).catch(() => []);
  const out = [];
  for (const name of names.filter((n) => NAME_RE.test(n))) {
    const st = await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null);
    if (st) out.push({ name, size: st.size, createdAt: st.mtime.toISOString() });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

export async function backupStatus() {
  try {
    return JSON.parse(await fs.readFile(STATUS, 'utf8'));
  } catch {
    return null;
  }
}

function stamp(now, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${dateKey(now, tz)}_${p.hour}${p.minute}`;
}

// The archive: the whole data directory without the backups themselves and big caches.
export async function createArchive(general, now = new Date()) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  let name = `magicmirror-${stamp(now, general.timezone || 'Europe/Berlin')}.tar.gz`;
  for (let i = 2; await fs.stat(path.join(BACKUP_DIR, name)).catch(() => null); i++) name = name.replace(/(-\d+)?\.tar\.gz$/, `-${i}.tar.gz`);
  const file = path.join(BACKUP_DIR, name);
  await run('tar', ['-czf', `${file}.tmp`, '-C', DATA_DIR, '--exclude=./backups', '--exclude=./aircraft-db*', '--exclude=*.tmp', '.'], { timeout: 120000 });
  await fs.rename(`${file}.tmp`, file);
  return { name, file };
}

export async function prune(keep) {
  const list = await listBackups();
  for (const b of list.slice(Math.max(1, keep))) await fs.rm(path.join(BACKUP_DIR, b.name), { force: true });
}

// The configuration inside a backup (for "restore").
export async function readBackupConfig(name) {
  if (!NAME_RE.test(name)) throw new Error('Unknown backup');
  const { stdout } = await run('tar', ['-xzOf', path.join(BACKUP_DIR, name), './config.json'], { maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function webdavUpload(g, file, name) {
  const base = String(g.backupWebdavUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('WebDAV: invalid URL');
  const auth = g.backupWebdavUser ? { Authorization: `Basic ${Buffer.from(`${g.backupWebdavUser}:${g.backupWebdavPassword || ''}`).toString('base64')}` } : {};
  // create the folder if it is missing (405 = exists already)
  const mk = await fetch(`${base}/`, { method: 'MKCOL', headers: auth, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (mk && mk.status === 401) throw new Error('WebDAV: wrong user name or password');
  const body = await fs.readFile(file);
  const res = await fetch(`${base}/${name}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/gzip' }, body, signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`WebDAV: HTTP ${res.status}`);
  // keep only the newest copies there as well
  const keep = Math.max(1, Number(g.backupKeep) || 7);
  const list = await fetch(`${base}/`, { method: 'PROPFIND', headers: { ...auth, Depth: '1' }, signal: AbortSignal.timeout(30000) }).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const names = [...new Set([...list.matchAll(/magicmirror-\d{4}-\d{2}-\d{2}_\d{4}(?:-\d+)?\.tar\.gz/g)].map((m) => m[0]))].sort().reverse();
  for (const old of names.slice(keep)) await fetch(`${base}/${old}`, { method: 'DELETE', headers: auth, signal: AbortSignal.timeout(30000) }).catch(() => {});
}

// USB / SMB: a job file for the updater (credentials never travel in a URL), which reads
// and deletes it at once.
async function viaUpdater(updater, target, g, name) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { target, file: name, keep: Math.max(1, Number(g.backupKeep) || 7) };
  if (target === 'smb') Object.assign(job, { share: g.backupSmbShare, user: g.backupSmbUser, password: g.backupSmbPassword });
  const jobFile = path.join(BACKUP_DIR, `.job-${id}.json`);
  await fs.writeFile(jobFile, JSON.stringify(job), { mode: 0o600 });
  try {
    const r = await updater(`backup?job=${id}`, 180000);
    if (!r.ok) throw new Error(r.error || 'failed');
  } catch (err) {
    throw new Error(/fetch failed|aborted|ECONNREFUSED|HTTP 404/i.test(err.message) ? 'The updater is not reachable (profile "autoupdate")' : err.message);
  } finally {
    await fs.rm(jobFile, { force: true });
  }
}

export async function runBackup(getConfig, updater, { nightly = false } = {}) {
  if (running) return running;
  running = (async () => {
    const g = getConfig().general;
    const prev = await backupStatus();
    const result = { at: new Date().toISOString(), ok: true, targets: {}, lastNightly: nightly ? new Date().toISOString() : prev?.lastNightly || null };
    try {
      const { name, file } = await createArchive(g);
      result.name = name;
      result.targets.local = { ok: true };
      await prune(Math.max(1, Number(g.backupKeep) || 7));
      const targets = [g.backupUsb && 'usb', g.backupSmb && 'smb', g.backupWebdav && 'webdav'].filter(Boolean);
      for (const t of targets) {
        try {
          if (t === 'webdav') await webdavUpload(g, file, name);
          else await viaUpdater(updater, t, g, name);
          result.targets[t] = { ok: true };
        } catch (err) {
          result.ok = false;
          result.targets[t] = { ok: false, error: err.message };
        }
      }
    } catch (err) {
      result.ok = false;
      result.error = err.message;
    }
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    await fs.writeFile(STATUS, JSON.stringify(result));
    if (!result.ok) console.warn('[backup]', JSON.stringify(result));
    return result;
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
}

// Nightly at backupTime (once per day, also when the Pi was off at that time: catch up
// within the next hours after a start).
export function startBackupSchedule(getConfig, updater) {
  const timer = setInterval(async () => {
    const g = getConfig().general;
    const at = parseTime(g.backupTime);
    if (!g.backupEnabled || at === null) return;
    const tz = g.timezone || 'Europe/Berlin';
    const now = new Date();
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    if (+p.hour * 60 + +p.minute < at) return;
    const last = await backupStatus();
    if (last?.lastNightly && dateKey(new Date(last.lastNightly), tz) === dateKey(now, tz)) return;
    console.log('[backup] nightly backup');
    await runBackup(getConfig, updater, { nightly: true }).catch((err) => console.warn(`[backup] ${err.message}`));
  }, 60000);
  timer.unref();
}
