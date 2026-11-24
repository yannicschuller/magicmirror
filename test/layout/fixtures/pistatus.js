// Device status of a Raspberry Pi 5 (the sampler in src/providers/pistatus.js + warnings).
const GB = 2 ** 30;

export default ({ now, settings, long }) => {
  const t = now.getTime();
  const history = Array.from({ length: 60 }, (_, i) => ({
    t: t - (59 - i) * 10000,
    temp: (long ? 78 : 52) + 3 * Math.sin(i / 6) + (i % 7) / 10,
    cpu: Math.round((long ? 85 : 18) + 12 * Math.sin(i / 4) + ((i * 37) % 11)),
  })).map((h) => ({ ...h, temp: Math.round(h.temp * 10) / 10, cpu: Math.max(0, Math.min(100, h.cpu)) }));
  const r = long
    ? {
      temp: 81.7, cpu: 97, load: [12.34, 10.87, 9.65], cores: 4, loadPct: 309,
      mem: { total: 8 * GB, used: 7.86 * GB, pct: 98.3 },
      disk: { total: 1863 * GB, free: 21.4 * GB, used: 1841.6 * GB, pct: 98.9 },
      uptime: 123 * 86400 + 17 * 3600 + 42 * 60,
      power: { value: 0x50005, underVoltage: true, capped: false, throttled: true, softTemp: false, underVoltageOccurred: true, cappedOccurred: false, throttledOccurred: true, softTempOccurred: false },
      tempTrend: 'up',
    }
    : {
      temp: 54.3, cpu: 21, load: [0.42, 0.57, 0.61], cores: 4, loadPct: 11,
      mem: { total: 8 * GB, used: 2.93 * GB, pct: 36.6 },
      disk: { total: 117.2 * GB, free: 81.6 * GB, used: 35.6 * GB, pct: 30.4 },
      uptime: 6 * 86400 + 4 * 3600 + 13 * 60,
      power: { value: 0, underVoltage: false, capped: false, throttled: false, softTemp: false, underVoltageOccurred: false, cappedOccurred: false, throttledOccurred: false, softTempOccurred: false },
      tempTrend: 'flat',
    };
  // warningsFor()
  const warnings = [];
  const add = (level, key, id, params) => warnings.push({ level, key, id, ...(params ? { params } : {}) });
  const shown = (k) => !Array.isArray(settings.show) || settings.show.includes(k);
  const s = { tempWarn: 70, ramWarn: 90, diskWarn: 90, ...settings };
  const p = r.power;
  if (shown('power')) {
    if (p.underVoltage) add('severe', 'underVoltage', 'Under-voltage detected');
    if (p.throttled) add('severe', 'throttled', 'Throttling active');
  }
  if (shown('temp') && r.temp >= s.tempWarn) add(r.temp >= s.tempWarn + 10 ? 'severe' : 'warn', 'temp', 'CPU hot: {t} °C', { t: r.temp });
  if (shown('ram') && r.mem.pct >= s.ramWarn) add(r.mem.pct >= 97 ? 'severe' : 'warn', 'ram', 'Memory almost full: {p} %', { p: r.mem.pct });
  if (shown('disk') && r.disk.pct >= s.diskWarn) add(r.disk.pct >= 98 ? 'severe' : 'warn', 'disk', 'Disk almost full: {p} %', { p: r.disk.pct });
  return { ...r, history, at: t, warnings };
};
