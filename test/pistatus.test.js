import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCpuStat, cpuPercent, parseMeminfo, parseUptime, parseTemp, parseThrottled, warningsFor, tempTrend, createSampler } from '../src/providers/pistatus.js';
import schema from '../public/shared/modules/pistatus.js';
import { applyDefaults } from '../public/shared/modules.js';
import de from '../public/shared/locales/de/modules/pistatus.js';

// Real-shaped /proc files of a Raspberry Pi 3 (4 cores).
const STAT_A = `cpu  10132153 290696 3084719 46828483 16683 0 25195 0 0 0
cpu0 1393280 32966 572056 13343292 6130 0 17875 0 0 0
cpu1 1335800 30234 504654 11163808 3742 0 2481 0 0 0
intr 1462898 0 0
ctxt 1990473
btime 1062191376
processes 2915`;
// +300 user, +100 system, +580 idle, +20 iowait → 400 busy of 1000
const STAT_B = STAT_A.replace('cpu  10132153 290696 3084719 46828483 16683', 'cpu  10132453 290696 3084819 46829063 16703');

const MEMINFO = `MemTotal:         944268 kB
MemFree:           64532 kB
MemAvailable:     472134 kB
Buffers:           37188 kB
Cached:           390844 kB
SwapCached:          120 kB
SwapTotal:        102396 kB
SwapFree:          99836 kB`;

const MEMINFO_OLD = `MemTotal:        1000 kB
MemFree:          100 kB
Buffers:          100 kB
Cached:           300 kB`;

const settings = (over = {}) => ({ ...applyDefaults(schema.fields), ...over });

test('/proc/stat: aggregate line and busy percentage from the delta', () => {
  const a = parseCpuStat(STAT_A);
  const b = parseCpuStat(STAT_B);
  assert.equal(a.total, 10132153 + 290696 + 3084719 + 46828483 + 16683 + 0 + 25195 + 0);
  assert.equal(a.idle, 46828483 + 16683);
  assert.equal(cpuPercent(a, b), 40);
  assert.equal(cpuPercent(b, a), null); // counter went backwards
  assert.equal(cpuPercent(null, b), null);
  assert.equal(parseCpuStat(''), null);
  assert.equal(parseCpuStat('cpu0 1 2 3 4'), null); // per-core lines only
});

test('/proc/meminfo: used = total − available, fallback for old kernels', () => {
  const m = parseMeminfo(MEMINFO);
  assert.equal(m.total, 944268 * 1024);
  assert.equal(m.available, 472134 * 1024);
  assert.equal(m.used, (944268 - 472134) * 1024);
  assert.equal(parseMeminfo(MEMINFO_OLD).available, 500 * 1024);
  assert.equal(parseMeminfo(''), null);
});

test('/proc/uptime and thermal zone', () => {
  assert.equal(parseUptime('350735.47 234388.90'), 350735);
  assert.equal(parseUptime(''), null);
  assert.equal(parseUptime('abc'), null);
  assert.equal(parseTemp('53692'), 53.7);
  assert.equal(parseTemp('48'), 48);
  assert.equal(parseTemp(''), null);
});

test('get_throttled bit flags', () => {
  const ok = parseThrottled('0');
  assert.equal(ok.underVoltage, false);
  assert.equal(ok.throttled, false);
  const now = parseThrottled('50005'); // under-voltage + throttled now and since boot
  assert.deepEqual(
    [now.underVoltage, now.capped, now.throttled, now.softTemp, now.underVoltageOccurred, now.throttledOccurred],
    [true, false, true, false, true, true],
  );
  const past = parseThrottled('0x50000');
  assert.equal(past.underVoltage, false);
  assert.equal(past.underVoltageOccurred, true);
  assert.equal(parseThrottled('throttled=0x8').softTemp, true);
  assert.equal(parseThrottled(''), null);
  assert.equal(parseThrottled('nope'), null);
});

const base = { temp: 50, mem: { pct: 40 }, disk: { pct: 50 }, power: parseThrottled('0') };
const ids = (w) => w.map((x) => `${x.level}:${x.id}`);
// Module dictionary directly (it is merged into the German locale in locales/de/index.js).
const de_ = (id, params) => (de[id] ?? id).replace(/\{(\w+)\}/g, (m, k) => (params && k in params ? String(params[k]) : m));

test('throttling flags → warning texts (German)', () => {
  const w = warningsFor({ ...base, power: parseThrottled('50005') }, settings());
  assert.deepEqual(ids(w), ['severe:Under-voltage detected', 'severe:Throttling active']);
  assert.deepEqual(w.map((x) => de_(x.id)), ['Unterspannung erkannt', 'Drosselung aktiv']);
  assert.deepEqual(ids(warningsFor({ ...base, power: parseThrottled('2') }, settings())), ['warn:CPU frequency capped']);
  // Past events only with the option
  assert.deepEqual(warningsFor({ ...base, power: parseThrottled('50000') }, settings()), []);
  assert.deepEqual(ids(warningsFor({ ...base, power: parseThrottled('50000') }, settings({ pastThrottling: true }))), ['warn:Under-voltage since boot', 'warn:Throttled since boot']);
  // hwmon fallback (under-voltage only)
  assert.deepEqual(ids(warningsFor({ ...base, power: { underVoltage: true, partial: true } }, settings())), ['severe:Under-voltage detected']);
});

test('thresholds → warnings, hidden values and missing data never warn', () => {
  assert.deepEqual(warningsFor(base, settings()), []);
  const w = warningsFor({ temp: 72.5, mem: { pct: 91 }, disk: { pct: 99 }, power: null }, settings());
  assert.deepEqual(ids(w), ['warn:CPU hot: {t} °C', 'warn:Memory almost full: {p} %', 'severe:Disk almost full: {p} %']);
  assert.equal(de_(w[0].id, w[0].params), 'CPU heiß: 72.5 °C');
  assert.equal(warningsFor({ ...base, temp: 81 }, settings())[0].level, 'severe');
  assert.deepEqual(warningsFor({ ...base, temp: 72 }, settings({ tempWarn: 75 })), []);
  assert.deepEqual(warningsFor({ ...base, temp: 90 }, settings({ show: ['cpu'] })), []);
  assert.deepEqual(warningsFor({ temp: null, mem: null, disk: null, power: null }, settings()), []);
});

test('temperature trend against an older reading', () => {
  const t0 = 1_000_000;
  const hist = [{ t: t0, temp: 50 }, { t: t0 + 60000, temp: 51 }, { t: t0 + 130000, temp: 52 }];
  assert.equal(tempTrend(hist, 52, t0 + 150000), 'up'); // vs. 50 (≥ 2 min old)
  assert.equal(tempTrend(hist, 50.5, t0 + 150000), 'flat');
  assert.equal(tempTrend(hist, 48, t0 + 150000), 'down');
  assert.equal(tempTrend([], 50, t0), null);
  assert.equal(tempTrend(hist, null, t0), null);
});

function fakeIo(files, extra = {}) {
  let clock = 1_700_000_000_000;
  return {
    read: async (f) => (typeof files[f] === 'function' ? files[f]() : files[f] ?? ''),
    readdir: async (dir) => Object.keys(files).filter((f) => f.startsWith(dir + '/')).map((f) => f.slice(dir.length + 1).split('/')[0]),
    statfs: async () => ({ bsize: 4096, blocks: 1000, bfree: 300, bavail: 250 }),
    loadavg: () => [0.84, 0.5, 0.25],
    cores: () => 4,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    advance: (ms) => { clock += ms; },
    dataDir: '/data',
    ...extra,
  };
}

test('sampler on a Raspberry Pi: all values, CPU delta, history', async () => {
  let n = 0;
  const io = fakeIo({
    '/proc/stat': () => (n++ % 2 ? STAT_B : STAT_A),
    '/proc/meminfo': MEMINFO,
    '/proc/uptime': '93784.12 300000.00',
    '/sys/class/thermal/thermal_zone0/temp': '61224',
    '/sys/devices/platform/soc/soc:firmware/get_throttled': '50005',
  });
  const sample = createSampler(io);
  const r = await sample();
  assert.equal(r.cpu, 40); // two quick samples on first call
  assert.equal(r.temp, 61.2);
  assert.equal(r.uptime, 93784);
  assert.equal(r.cores, 4);
  assert.equal(r.loadPct, 21);
  assert.equal(r.mem.pct, 50);
  assert.equal(r.disk.total, 4096000);
  assert.equal(r.disk.free, 250 * 4096);
  assert.equal(r.disk.pct, 73.7); // 700 used of 950 usable
  assert.equal(r.power.underVoltage, true);
  assert.equal(r.history.length, 1);
  io.advance(3000);
  await sample();
  assert.equal(io.now() - r.at, 3000);
  assert.equal((await sample()).history.length, 1); // too close → not recorded
  io.advance(10000);
  assert.equal((await sample()).history.length, 2);
});

test('sampler on a non-Pi host: missing sources become null', async () => {
  const io = fakeIo({ '/proc/stat': STAT_A, '/proc/meminfo': MEMINFO }, { statfs: async () => { throw new Error('ENOENT'); } });
  const r = await createSampler(io)();
  assert.equal(r.temp, null);
  assert.equal(r.power, null);
  assert.equal(r.disk, null);
  assert.equal(r.uptime, null);
  assert.equal(r.cpu, null); // counters did not move
  assert.equal(r.tempTrend, null);
});

test('hwmon rpi_volt fallback when get_throttled is missing', async () => {
  const io = fakeIo({
    '/sys/class/hwmon/hwmon0/name': 'cpu_thermal',
    '/sys/class/hwmon/hwmon1/name': 'rpi_volt',
    '/sys/class/hwmon/hwmon1/in0_lcrit_alarm': '1',
  });
  const r = await createSampler(io)();
  assert.deepEqual(r.power, { underVoltage: true, partial: true });
  assert.equal(r.cpu, null);
  assert.equal(r.mem, null);
});

test('German strings complete and sorted', () => {
  const ids = [schema.label, schema.description, schema.defaultTitle];
  for (const f of schema.fields) {
    ids.push(f.label);
    if (f.help) ids.push(f.help);
    for (const o of f.options || []) ids.push(o.label);
  }
  ids.push('Under-voltage detected', 'Under-voltage since boot', 'Throttling active', 'CPU frequency capped', 'Soft temperature limit active', 'Throttled since boot', 'CPU hot: {t} °C', 'Memory almost full: {p} %', 'Disk almost full: {p} %');
  ids.push('{d} d {h} h', '{h} h {m} min', '{m} min', 'Temp', 'CPU', 'Load', '{n} cores', 'RAM', 'Disk', '{size} free', 'Uptime', 'Power', 'OK', 'No device data available');
  for (const id of ids) assert.ok(de[id], `missing German: ${id}`);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
});
