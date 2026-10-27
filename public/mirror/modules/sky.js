// "Moon & sun" renderer – everything is computed locally (no server data).
import { esc, num } from '../renderers.js';
import { icons } from '../icons.js';
import { sunTimes, sunPosition, moonIllumination, moonTimes, nextMoonPhase, startOfDay } from '/shared/astro.js';

const DAY = 86400000;
const TIME_ROWS = {
  nauticalDawn: { label: 'Nautical dawn', icon: 'sunrise', src: 'sun' },
  dawn: { label: 'Dawn', icon: 'sunrise', src: 'sun' },
  sunrise: { label: 'Sunrise', icon: 'sunrise', src: 'sun' },
  goldenHourEnd: { label: 'Golden hour ends', icon: 'sunrise', src: 'sun' },
  solarNoon: { label: 'Solar noon', icon: 'sun', src: 'sun' },
  goldenHour: { label: 'Golden hour', icon: 'sunset', src: 'sun' },
  sunset: { label: 'Sunset', icon: 'sunset', src: 'sun' },
  dusk: { label: 'Dusk', icon: 'sunset', src: 'sun' },
  nauticalDusk: { label: 'Nautical dusk', icon: 'sunset', src: 'sun' },
  moonrise: { label: 'Moonrise', icon: 'moon', src: 'moon', key: 'rise' },
  moonset: { label: 'Moonset', icon: 'moon', src: 'moon', key: 'set' },
};

// Lit part of the moon disc: limb half-circle on the lit side + elliptical terminator.
export function moonSvg(fraction, litRight, r = 40) {
  const c = r + 2;
  const k = Math.max(0, Math.min(1, fraction));
  const rx = Math.abs(1 - 2 * k) * r;
  const s1 = litRight ? 1 : 0;
  const s2 = litRight ? (k > 0.5 ? 1 : 0) : (k > 0.5 ? 0 : 1);
  const lit = k < 0.005 ? '' : k > 0.995
    ? `<circle class="sky-moon-lit" cx="${c}" cy="${c}" r="${r}"/>`
    : `<path class="sky-moon-lit" d="M${c} ${c - r}A${r} ${r} 0 0 ${s1} ${c} ${c + r}A${rx.toFixed(2)} ${r} 0 0 ${s2} ${c} ${c - r}Z"/>`;
  return `<svg class="sky-moon" viewBox="0 0 ${2 * c} ${2 * c}" aria-hidden="true"><circle class="sky-moon-dark" cx="${c}" cy="${c}" r="${r}"/>${lit}</svg>`;
}

const W = 240, H = 64, HORIZON = 50, BELOW = 10;
// Sun altitude over the local day (x = time of day) with the current position.
function sunArcSvg(samples, peak, nowFrac, nowAlt) {
  const scale = (HORIZON - 4) / Math.max(peak, 30);
  const y = (alt) => (alt >= 0 ? HORIZON - alt * scale : HORIZON + Math.min(BELOW, -alt * scale * 0.4));
  const pts = samples.map((alt, i) => [(i / (samples.length - 1)) * W, y(alt)]);
  const line = (p) => p.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${yy.toFixed(1)}`).join('');
  // Split into the day part (above horizon) and the rest.
  let day = '';
  let run = [];
  samples.forEach((alt, i) => {
    if (alt >= 0) run.push(pts[i]);
    if ((alt < 0 || i === samples.length - 1) && run.length) { day += line(run); run = []; }
  });
  const sx = nowFrac * W, sy = y(nowAlt);
  const up = nowAlt >= 0;
  return `<svg class="sky-arc" viewBox="-6 -6 ${W + 12} ${H + 12}" aria-hidden="true">
    <path class="sky-arc-night" d="${line(pts)}"/>
    ${day ? `<path class="sky-arc-day" d="${day}"/>` : ''}
    <line class="sky-arc-horizon" x1="0" x2="${W}" y1="${HORIZON}" y2="${HORIZON}"/>
    ${up ? `<circle class="sky-arc-glow" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9"/>` : ''}
    <circle class="sky-arc-sun${up ? '' : ' down'}" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${up ? 5 : 4}"/>
  </svg>`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t, f, dayKey } = ctx.fmt;
  const tz = ctx.fmt.tz;
  const loc = (s.useGlobalLocation === false && s.location) || ctx.general.location || { lat: 52.52, lon: 13.405 };
  const { lat, lon } = loc;
  const time = (d) => ctx.fmt.time(d);
  const dateFmt = f({ weekday: 'short', day: 'numeric', month: 'short' });

  let cacheKey = '';
  let cache = null;
  let phases = { full: null, new: null };

  const daily = (now) => {
    const key = dayKey(now);
    if (key === cacheKey) return cache;
    const midnight = startOfDay(now, tz);
    const noon = new Date(midnight.valueOf() + DAY / 2);
    const sun = sunTimes(noon, lat, lon);
    const prev = sunTimes(new Date(noon.valueOf() - DAY), lat, lon);
    const dayLen = (startOfDay(now, tz, 1) - midnight) || DAY; // 23/25 h on DST days
    const samples = [];
    for (let i = 0; i <= 96; i++) samples.push(sunPosition(new Date(midnight.valueOf() + (i / 96) * dayLen), lat, lon).altitude);
    cacheKey = key;
    cache = { midnight, dayLen, sun, prev, samples, peak: Math.max(...samples), moon: moonTimes(midnight, lat, lon) };
    return cache;
  };

  const duration = (ms) => {
    const m = Math.round(ms / 60000);
    return t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 });
  };
  const delta = (ms) => {
    const sec = Math.round(Math.abs(ms) / 1000);
    const sign = ms > 500 ? '+' : ms < -500 ? '−' : '±';
    return t('{sign}{m}:{s} min vs. yesterday', { sign, m: Math.floor(sec / 60), s: String(sec % 60).padStart(2, '0') });
  };
  const phaseDate = (d) => {
    const k = dayKey(d);
    const diff = ctx.fmt.keyDiff(dayKey(new Date()), k);
    return diff <= 1 ? `${ctx.fmt.dayLabel(k)} ${time(d)}` : dateFmt.format(d);
  };

  const draw = () => {
    const now = new Date();
    const d = daily(now);
    let html = `<div class="sky size-${esc(s.size)}">`;

    if (s.showMoon) {
      const m = moonIllumination(now);
      const litRight = m.waxing === lat >= 0;
      html += `<div class="sky-moonrow">${moonSvg(m.fraction, litRight)}<div class="sky-moontext">
        <div class="sky-phase">${esc(t(m.name))}</div>
        <div class="dim small">${t('{p} % illuminated', { p: num(m.fraction * 100) })}</div>`;
      if (s.showNextPhases) {
        if (!phases.full || phases.full <= now) phases.full = nextMoonPhase(now, 180);
        if (!phases.new || phases.new <= now) phases.new = nextMoonPhase(now, 0);
        const list = [[t('Full moon'), phases.full, 'full'], [t('New moon'), phases.new, 'new']].filter((x) => x[1]).sort((a, b) => a[1] - b[1]);
        html += list.map(([label, when, cls]) => `<div class="sky-next small"><span class="sky-dot ${cls}"></span><span class="dim">${esc(label)}</span> ${esc(phaseDate(when))}</div>`).join('');
      }
      html += '</div></div>';
    } else if (s.showNextPhases) {
      if (!phases.full || phases.full <= now) phases.full = nextMoonPhase(now, 180);
      if (!phases.new || phases.new <= now) phases.new = nextMoonPhase(now, 0);
      html += `<div class="sky-next small"><span class="dim">${t('Full moon')}</span> ${esc(phaseDate(phases.full))} · <span class="dim">${t('New moon')}</span> ${esc(phaseDate(phases.new))}</div>`;
    }

    if (s.showSunArc) {
      const pos = sunPosition(now, lat, lon);
      const frac = Math.max(0, Math.min(1, (now - d.midnight) / d.dayLen));
      html += `<div class="sky-arcwrap">${sunArcSvg(d.samples, d.peak, frac, pos.altitude)}`;
      if (s.showSunPosition) {
        html += `<div class="sky-pos dim small">${t('Altitude')} ${num(pos.altitude)}° · ${t('Direction')} ${num(pos.azimuth)}° ${t(COMPASS[Math.round(pos.azimuth / 45) % 8])}</div>`;
      }
      html += '</div>';
    }

    if (s.showTimes && s.times.length) {
      const rows = s.times.filter((k) => TIME_ROWS[k]).map((k) => {
        const r = TIME_ROWS[k];
        const when = r.src === 'sun' ? d.sun[k] : d.moon[r.key];
        return { k, r, when };
      });
      html += `<table class="sky-times">${rows
        .map(({ k, r, when }) => `<tr class="${when && when < now ? 'past' : ''}${k === 'goldenHour' || k === 'goldenHourEnd' ? ' golden' : ''}"><td class="sky-ti">${icons[r.icon]}</td><td class="sky-tl">${esc(t(r.label))}</td><td class="sky-tt">${when ? esc(time(when)) : '–'}</td></tr>`)
        .join('')}</table>`;
      if (d.sun.polar) html += `<div class="dim small">${t(d.sun.polar === 'day' ? 'Polar day – the sun does not set' : 'Polar night – the sun does not rise')}</div>`;
      if (rows.some((x) => x.r.src === 'moon') && (d.moon.alwaysUp || d.moon.alwaysDown)) {
        html += `<div class="dim small">${t(d.moon.alwaysUp ? 'The moon stays above the horizon all day' : 'The moon stays below the horizon all day')}</div>`;
      }
    }

    if (s.showDayLength) {
      html += `<div class="sky-daylen"><span class="dim">${t('Day length')}</span> ${esc(duration(d.sun.dayLength))} <span class="dim small">${esc(delta(d.sun.dayLength - d.prev.dayLength))}</span></div>`;
    }

    el.innerHTML = html + '</div>';
  };

  draw();
  return { tick: draw, tickEvery: 60000, show: draw };
}
