// Pure helpers for the weather module: inline-SVG hourly chart and the colour
// scales (UV, AQI, pollen, temperature). No DOM, no imports – also used by tests.

const r1 = (n) => Math.round(n * 10) / 10;

// Smooth curve through the points without overshoot (monotone cubic,
// Fritsch–Carlson) – a temperature curve must not invent extra extremes.
export function monotonePath(pts) {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  const dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r1(pts[i][0] + h)} ${r1(pts[i][1] + t[i] * h)} ${r1(pts[i + 1][0] - h)} ${r1(pts[i + 1][1] - t[i + 1] * h)} ${r1(pts[i + 1][0])} ${r1(pts[i + 1][1])}`;
  }
  return d;
}

const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/**
 * Hourly chart. `hours` starts at the current full hour (as delivered by the
 * provider); points every hour, labels every `step` hours.
 * opts: { count, step, bars: 'none'|'probability'|'amount', nowFrac (0..1 into
 * the first hour), amountMin (scale floor for amounts), fmtTemp(n), fmtBar(h),
 * hourLabel(h), uid, width (viewBox units, default 200), maxLabels }
 * Returns { svg, labels: [{ hour, xPct }] } – the renderer puts the (possibly
 * animated) weather icons above the SVG at the label positions.
 */
export function hourlyChart(hours, opts) {
  const { step = 2, count = 6, bars = 'none', nowFrac = 0, amountMin = 2, uid = 'w' } = opts;
  const fmtTemp = opts.fmtTemp || ((n) => `${Math.round(n)}°`);
  const hourLabel = opts.hourLabel || ((h) => h.time.slice(11, 13));
  const N = Math.min(hours.length - 1, Math.max(1, count * step));
  const pts = hours.slice(0, N + 1).filter((h) => typeof h.temp === 'number');
  if (pts.length < 2) return { svg: '', labels: [] };
  const withBars = bars !== 'none';
  const W = opts.width || 200, pad = 9;
  const top = 29, bottom = withBars ? 58 : 62;
  const H = withBars ? 111 : 85;
  const hourY = withBars ? 108 : 82;
  const x = (i) => pad + (i / N) * (W - 2 * pad);
  const temps = pts.map((h) => h.temp);
  let lo = Math.min(...temps), hi = Math.max(...temps);
  if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = mid - 2; hi = mid + 2; } // flat days stay flat
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  const xy = pts.map((h, i) => [x(i), y(h.temp)]);
  const line = monotonePath(xy);
  const area = `${line}L${r1(xy[xy.length - 1][0])} ${bottom + 6}L${r1(xy[0][0])} ${bottom + 6}Z`;
  let svg = `<svg class="w-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
  svg += `<defs><linearGradient id="wg-${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".16"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>`;

  const labels = [];
  const every = step * Math.max(1, Math.ceil(N / step / (opts.maxLabels || 12)));
  for (let i = every; i <= N; i += every) labels.push({ hour: pts[i] || hours[i], i, xPct: r1((x(i) / W) * 100) });
  // faint guides at the label hours
  svg += labels.map((l) => `<line class="wc-grid" x1="${r1(x(l.i))}" x2="${r1(x(l.i))}" y1="${top - 4}" y2="${withBars ? 98 : bottom + 6}"/>`).join('');

  if (withBars) {
    const base = 98, maxH = 18;
    const vals = pts.map((h) => (bars === 'amount' ? h.precip || 0 : h.pop || 0));
    const scale = bars === 'amount' ? Math.max(amountMin, ...vals) : 100;
    const bw = Math.max(2, ((W - 2 * pad) / N) * 0.62);
    svg += `<line class="wc-base" x1="${pad - 3}" x2="${W - pad + 3}" y1="${base}" y2="${base}"/>`;
    svg += vals.map((v, i) => {
      const h = (Math.min(v, scale) / scale) * maxH;
      return h > 0.2 ? `<rect class="wc-bar" x="${r1(x(i) - bw / 2)}" y="${r1(base - h)}" width="${r1(bw)}" height="${r1(h)}" rx="${r1(Math.min(1.2, bw / 3))}"/>` : '';
    }).join('');
    const fmtBar = opts.fmtBar || ((h) => `${h.pop}%`);
    svg += labels.map((l) => {
      const v = vals[l.i];
      const show = bars === 'amount' ? v >= 0.1 : v >= 10;
      return show ? `<text class="wc-bartxt" x="${r1(x(l.i))}" y="77" text-anchor="middle">${escText(fmtBar(pts[l.i]))}</text>` : '';
    }).join('');
  }

  svg += `<path class="wc-area" d="${area}" fill="url(#wg-${uid})"/>`;
  svg += `<path class="wc-line" d="${line}"/>`;

  // min / max labels (first occurrence)
  const iMax = temps.indexOf(Math.max(...temps));
  const iMin = temps.indexOf(Math.min(...temps));
  const anchor = (i) => (i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle');
  const lx = (i) => r1(i === 0 ? xy[i][0] - 3 : i === pts.length - 1 ? xy[i][0] + 3 : xy[i][0]);
  svg += `<circle class="wc-dot" cx="${r1(xy[iMax][0])}" cy="${r1(xy[iMax][1])}" r="1.6"/>`;
  svg += `<text class="wc-max" x="${lx(iMax)}" y="${r1(xy[iMax][1] - 4.5)}" text-anchor="${anchor(iMax)}">${escText(fmtTemp(temps[iMax]))}</text>`;
  if (iMin !== iMax) {
    svg += `<circle class="wc-dot" cx="${r1(xy[iMin][0])}" cy="${r1(xy[iMin][1])}" r="1.6"/>`;
    svg += `<text class="wc-min" x="${lx(iMin)}" y="${r1(xy[iMin][1] + 10)}" text-anchor="${anchor(iMin)}">${escText(fmtTemp(temps[iMin]))}</text>`;
  }

  // "now" marker: dashed line + dot on the curve
  const f = Math.min(1, Math.max(0, nowFrac));
  const nx = x(f);
  const ny = y(temps[0] + (temps[1] - temps[0]) * f);
  svg += `<line class="wc-now" x1="${r1(nx)}" x2="${r1(nx)}" y1="${top - 6}" y2="${withBars ? 98 : bottom + 6}"/>`;
  svg += `<circle class="wc-nowdot" cx="${r1(nx)}" cy="${r1(ny)}" r="2.4"/>`;

  svg += labels.map((l) => `<text class="wc-hour" x="${r1(x(l.i))}" y="${hourY}" text-anchor="middle">${escText(hourLabel(l.hour))}</text>`).join('');
  svg += '</svg>';
  return { svg, labels: labels.map((l) => ({ hour: l.hour, xPct: l.xPct })) };
}

// ---- scales ---------------------------------------------------------------------

// WHO UV index categories.
export function uvLevel(uv) {
  if (uv == null) return null;
  if (uv < 3) return 'low';
  if (uv < 6) return 'moderate';
  if (uv < 8) return 'high';
  if (uv < 11) return 'very high';
  return 'extreme';
}

// European Air Quality Index bands.
export function aqiLevel(aqi) {
  if (aqi == null) return null;
  if (aqi <= 20) return 'good';
  if (aqi <= 40) return 'fair';
  if (aqi <= 60) return 'moderate';
  if (aqi <= 80) return 'poor';
  if (aqi <= 100) return 'very poor';
  return 'extremely poor';
}

// grains/m³ thresholds (low, moderate, high, very high), roughly NAB scale.
const POLLEN_THRESHOLDS = {
  alder: [1, 15, 90, 1500], birch: [1, 15, 90, 1500],
  grass: [1, 5, 20, 200],
  mugwort: [1, 10, 50, 500], ragweed: [1, 10, 50, 500],
};
export function pollenLevel(type, v) {
  const th = POLLEN_THRESHOLDS[type];
  if (!th || v == null || v < th[0]) return null;
  if (v < th[1]) return 'low';
  if (v < th[2]) return 'moderate';
  if (v < th[3]) return 'high';
  return 'very high';
}

// Temperature (°C) → colour for the daily range bars.
const TEMP_STOPS = [[-10, [165, 180, 252]], [0, [125, 211, 252]], [10, [94, 234, 212]], [17, [163, 230, 53]], [23, [253, 224, 71]], [29, [251, 146, 60]], [35, [248, 113, 113]]];
export function tempColor(c) {
  if (c <= TEMP_STOPS[0][0]) return rgb(TEMP_STOPS[0][1]);
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (c <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      const k = (c - t0) / (t1 - t0);
      return rgb(c0.map((v, j) => Math.round(v + (c1[j] - v) * k)));
    }
  }
  return rgb(TEMP_STOPS[TEMP_STOPS.length - 1][1]);
}
const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;

// Compass direction (8 points) the wind comes from.
export function compass(deg) {
  if (deg == null) return '';
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
