// System information and resource hints for the admin panel.
// Hints are recommendations only – nothing is enforced.
import fs from 'node:fs/promises';
import os from 'node:os';
import { DATA_DIR } from './config.js';

const read = (file) => fs.readFile(file, 'utf8').then((s) => s.replace(/\0/g, '').trim()).catch(() => '');

async function meminfo() {
  const out = {};
  for (const line of (await read('/proc/meminfo')).split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) out[m[1]] = Number(m[2]) * 1024;
  }
  return out;
}

async function deviceModel() {
  const dt = (await read('/sys/firmware/devicetree/base/model')) || (await read('/proc/device-tree/model'));
  if (dt) return dt;
  const cpu = await read('/proc/cpuinfo');
  return cpu.match(/^(?:model name|Model)\s*:\s*(.+)$/m)?.[1] || os.cpus()[0]?.model || 'unknown';
}

async function temperature() {
  const raw = await read('/sys/class/thermal/thermal_zone0/temp');
  return raw ? Math.round(Number(raw) / 100) / 10 : null;
}

async function disk() {
  try {
    const s = await fs.statfs(DATA_DIR);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

// "low" = Raspberry Pi 3 class hardware (≤ 1.5 GB RAM).
function tier(model, memTotal) {
  if (/Raspberry Pi (Zero|[12] |3)/i.test(model) || memTotal < 1.5 * 2 ** 30) return 'low';
  if (memTotal < 3 * 2 ** 30) return 'medium';
  return 'high';
}

function hints(info, cfg) {
  const out = [];
  const low = info.tier === 'low';
  const add = (level, id, params = {}) => out.push({ level, id, params });
  const mods = cfg.modules.filter((m) => m.enabled);

  if (info.memory.available < 150 * 2 ** 20) add('warn', 'Only {mb} MB RAM available – consider fewer modules per page or snapshot cameras.', { mb: Math.round(info.memory.available / 2 ** 20) });
  if (info.temperature !== null && info.temperature >= 75) add('warn', 'CPU temperature is {t} °C – the Pi may throttle. A heatsink or better airflow helps.', { t: info.temperature });
  if (info.disk && info.disk.free < 2 ** 30) add('warn', 'Less than 1 GB of free disk space.');

  for (const m of mods) {
    if (m.type === 'camera' && m.settings.mode === 'live' && low) add('info', 'Camera "{name}" uses live video. On this device, snapshot mode is much lighter – try both.', { name: m.title || m.type });
    if (m.type === 'flights' && m.settings.refreshSeconds < 5 && low) add('info', 'Aircraft map "{name}" refreshes every {s} s. 5 s or more saves CPU on this device.', { name: m.title || m.type, s: m.settings.refreshSeconds });
  }
  for (const p of cfg.pages.filter((x) => x.enabled)) {
    const count = mods.filter((m) => m.pages.includes('*') || m.pages.includes(p.id)).length;
    const heavy = mods.filter((m) => (m.pages.includes('*') || m.pages.includes(p.id)) && ['flights', 'camera'].includes(m.type)).length;
    if (low && (count > 8 || heavy > 1)) add('info', 'Page "{page}" shows {n} modules ({heavy} map/camera). If the mirror feels slow, spread them over more pages.', { page: p.name, n: count, heavy });
  }
  if (!out.length) add('ok', 'Everything looks fine for this device.');
  return out;
}

export async function systemInfo(cfg) {
  const [model, mem, temp, diskInfo, osRelease] = await Promise.all([deviceModel(), meminfo(), temperature(), disk(), read('/etc/os-release')]);
  const memory = {
    total: mem.MemTotal || os.totalmem(),
    available: mem.MemAvailable ?? os.freemem(),
    swapTotal: mem.SwapTotal || 0,
    swapFree: mem.SwapFree || 0,
    server: process.memoryUsage().rss,
  };
  const info = {
    model,
    arch: process.arch,
    kernel: os.release(),
    container: osRelease.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] || '',
    cpus: os.cpus().length,
    load: os.loadavg().map((l) => Math.round(l * 100) / 100),
    uptime: os.uptime(),
    temperature: temp,
    memory,
    disk: diskInfo,
    tier: tier(model, memory.total),
  };
  return { ...info, hints: hints(info, cfg) };
}
