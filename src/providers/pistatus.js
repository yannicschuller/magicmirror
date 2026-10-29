// Device status: health of the host the mirror server runs on. Everything is
// read from /proc and /sys – inside Docker these show the host's values
// (load, uptime, memory, temperature). Missing sources become null and the
// mirror hides them, so macOS/x86 hosts simply show less.
import fs from 'node:fs/promises';
import os from 'node:os';
import { cached } from '../util.js';
import { DATA_DIR } from '../config.js';

const HISTORY = 60;
const MIN_HISTORY_GAP = 9000; // ms – several mirrors/modules must not flood the history
const TREND_AGE = 120000; // compare the temperature with a reading ≥ 2 min old
const TREND_DELTA = 1; // °C

// ---- parsers (pure, tested) ----------------------------------------------------

// Aggregate "cpu" line of /proc/stat → { idle, total } in jiffies.
export function parseCpuStat(text) {
  const line = String(text || '').split('\n').find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null;
  // user nice system idle iowait irq softirq steal (guest* are already in user/nice)
  const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
  const idle = v[3] + (v[4] || 0);
  return { idle, total };
}

// Busy share (0–100) between two /proc/stat samples.
export function cpuPercent(prev, cur) {
  if (!prev || !cur) return null;
  const total = cur.total - prev.total;
  const idle = cur.idle - prev.idle;
  if (total <= 0 || idle < 0) return null;
  return Math.max(0, Math.min(100, Math.round(((total - idle) / total) * 1000) / 10));
}

// /proc/meminfo → { total, available, used } in bytes.
export function parseMeminfo(text) {
  const kb = {};
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(\w+):\s+(\d+)/);
    if (m) kb[m[1]] = Number(m[2]) * 1024;
  }
  if (!kb.MemTotal) return null;
  // Kernels before 3.14 have no MemAvailable.
  const available = kb.MemAvailable ?? (kb.MemFree || 0) + (kb.Buffers || 0) + (kb.Cached || 0);
  return { total: kb.MemTotal, available, used: kb.MemTotal - available };
}

// /proc/uptime → seconds since boot.
export function parseUptime(text) {
  const n = parseFloat(String(text || '').trim().split(/\s+/)[0]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

// Thermal zone → °C with one decimal (millidegrees; some boards report degrees).
export function parseTemp(text) {
  const n = Number(String(text || '').trim());
  if (!String(text || '').trim() || !Number.isFinite(n)) return null;
  const c = Math.abs(n) > 1000 ? n / 1000 : n;
  return Math.round(c * 10) / 10;
}

// Raspberry Pi firmware "get_throttled" bit field (same as `vcgencmd get_throttled`).
const THROTTLE_BITS = {
  underVoltage: 0,
  capped: 1,
  throttled: 2,
  softTemp: 3,
  underVoltageOccurred: 16,
  cappedOccurred: 17,
  throttledOccurred: 18,
  softTempOccurred: 19,
};

// "50005", "0x50005" or "throttled=0x50005" → flags. The sysfs file prints hex.
export function parseThrottled(text) {
  const s = String(text || '').trim().replace(/^throttled=/, '');
  if (!/^(0x)?[0-9a-f]+$/i.test(s)) return null;
  const value = parseInt(s.replace(/^0x/i, ''), 16);
  const flags = { value };
  for (const [k, bit] of Object.entries(THROTTLE_BITS)) flags[k] = Boolean(value & (1 << bit));
  return flags;
}

// Warnings as message ids (+ params), translated by the mirror.
export function warningsFor(r, s) {
  const out = [];
  const add = (level, key, id, params) => out.push({ level, key, id, ...(params ? { params } : {}) });
  const shown = (k) => !Array.isArray(s.show) || s.show.includes(k);
  const p = r.power;
  if (p && shown('power')) {
    if (p.underVoltage) add('severe', 'underVoltage', 'Under-voltage detected');
    else if (s.pastThrottling && p.underVoltageOccurred) add('warn', 'underVoltage', 'Under-voltage since boot');
    if (p.throttled) add('severe', 'throttled', 'Throttling active');
    else if (p.capped) add('warn', 'throttled', 'CPU frequency capped');
    else if (p.softTemp) add('warn', 'throttled', 'Soft temperature limit active');
    else if (s.pastThrottling && (p.throttledOccurred || p.cappedOccurred || p.softTempOccurred)) add('warn', 'throttled', 'Throttled since boot');
  }
  if (shown('temp') && r.temp !== null && r.temp >= s.tempWarn) add(r.temp >= s.tempWarn + 10 ? 'severe' : 'warn', 'temp', 'CPU hot: {t} °C', { t: r.temp });
  if (shown('ram') && r.mem && r.mem.pct >= s.ramWarn) add(r.mem.pct >= 97 ? 'severe' : 'warn', 'ram', 'Memory almost full: {p} %', { p: r.mem.pct });
  if (shown('disk') && r.disk && r.disk.pct >= s.diskWarn) add(r.disk.pct >= 98 ? 'severe' : 'warn', 'disk', 'Disk almost full: {p} %', { p: r.disk.pct });
  return out;
}

// 'up' | 'down' | 'flat' | null against the newest reading at least TREND_AGE old.
export function tempTrend(history, temp, now) {
  if (temp === null || temp === undefined) return null;
  let ref = null;
  for (const h of history) if (h.temp !== null && now - h.t >= TREND_AGE) ref = h;
  if (!ref) ref = history.find((h) => h.temp !== null && h.t < now);
  if (!ref) return null;
  const d = temp - ref.temp;
  return d >= TREND_DELTA ? 'up' : d <= -TREND_DELTA ? 'down' : 'flat';
}

const pct = (used, total) => (total > 0 ? Math.round((used / total) * 1000) / 10 : null);

// ---- sampler -----------------------------------------------------------------

const realIo = {
  read: (file) => fs.readFile(file, 'utf8').then((s) => s.replace(/\0/g, '').trim()).catch(() => ''),
  readdir: (dir) => fs.readdir(dir).catch(() => []),
  statfs: (dir) => fs.statfs(dir),
  loadavg: () => os.loadavg(),
  cores: () => os.cpus().length || 1,
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  dataDir: DATA_DIR,
};

// One sampler keeps the previous /proc/stat sample and the history.
export function createSampler(io = realIo) {
  let prevStat = null;
  let prevAt = 0;
  let voltPath; // undefined = not searched yet, null = none
  const history = [];

  async function readPower() {
    const raw = await io.read('/sys/devices/platform/soc/soc:firmware/get_throttled');
    const flags = parseThrottled(raw);
    if (flags) return flags;
    // Newer kernels: only the hwmon "rpi_volt" under-voltage alarm.
    if (voltPath === undefined) {
      voltPath = null;
      for (const d of await io.readdir('/sys/class/hwmon')) {
        if ((await io.read(`/sys/class/hwmon/${d}/name`)) === 'rpi_volt') voltPath = `/sys/class/hwmon/${d}/in0_lcrit_alarm`;
      }
    }
    if (!voltPath) return null;
    const alarm = await io.read(voltPath);
    if (alarm !== '0' && alarm !== '1') return null;
    return { underVoltage: alarm === '1', partial: true };
  }

  async function readDisk() {
    try {
      const s = await io.statfs(io.dataDir);
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      // used as df shows it: total minus free incl. root-reserved blocks
      const used = total - s.bfree * s.bsize;
      return total > 0 ? { total, free, used, pct: pct(used, used + free) } : null;
    } catch {
      return null;
    }
  }

  async function cpuSample() {
    let cur = parseCpuStat(await io.read('/proc/stat'));
    if (!cur) return null;
    // First call (or long pause): take a short second sample instead of the since-boot average.
    if (!prevStat || io.now() - prevAt > 600000) {
      prevStat = cur;
      await io.sleep(500);
      cur = parseCpuStat(await io.read('/proc/stat'));
    }
    const value = cpuPercent(prevStat, cur);
    prevStat = cur;
    prevAt = io.now();
    return value;
  }

  return async function sample() {
    const [cpu, memText, uptimeText, tempText, power, disk] = await Promise.all([
      cpuSample(),
      io.read('/proc/meminfo'),
      io.read('/proc/uptime'),
      io.read('/sys/class/thermal/thermal_zone0/temp'),
      readPower(),
      readDisk(),
    ]);
    const now = io.now();
    const m = parseMeminfo(memText);
    const cores = io.cores();
    const load = io.loadavg().map((l) => Math.round(l * 100) / 100);
    const r = {
      temp: parseTemp(tempText),
      cpu,
      load,
      cores,
      loadPct: Math.round((load[0] / cores) * 100),
      mem: m ? { total: m.total, used: m.used, pct: pct(m.used, m.total) } : null,
      disk,
      uptime: parseUptime(uptimeText),
      power,
    };
    r.tempTrend = tempTrend(history, r.temp, now);
    const last = history[history.length - 1];
    if (!last || now - last.t >= MIN_HISTORY_GAP) {
      history.push({ t: now, temp: r.temp, cpu: r.cpu });
      if (history.length > HISTORY) history.shift();
    }
    r.history = history.slice();
    r.at = now;
    return r;
  };
}

const sampler = createSampler();

export async function provider(settings) {
  // Shared by all mirrors/modules within a few seconds.
  const r = await cached('pistatus', 5, sampler);
  const warnings = warningsFor(r, settings);
  return { ...r, warnings };
}
