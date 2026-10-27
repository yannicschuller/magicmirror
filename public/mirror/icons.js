// Minimal line icons (stroke = currentColor) so the mirror needs no emoji font.
const svg = (body, extra = '') => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

const sunBody = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const moonBody = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
const cloudPath = 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z';
const smallSun = '<circle cx="8" cy="8" r="3"/><path d="M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7"/>';
const smallMoon = '<path d="M11 9.5A4 4 0 0 1 6.5 5a4 4 0 1 0 4.5 4.5z"/>';
const cloudLow = 'M7 16h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9 3.5 3.5 0 0 0 7 16z';
const drops = (n, x0 = 8) => Array.from({ length: n }, (_, i) => `<path d="M${x0 + i * 4} 18.5l-1 2.5"/>`).join('');
const flakes = '<path d="M8 19.5h.01M12 21h.01M16 19.5h.01M10 22.5h.01M14 22.5h.01" stroke-width="2.5"/>';

export const icons = {
  sun: svg(sunBody),
  moon: svg(moonBody),
  cloud: svg(`<path d="${cloudPath}"/>`),
  partly: svg(`${smallSun}<path d="M9 19h8a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.1 12.5 3 3 0 0 0 9 19z"/>`),
  partlyNight: svg(`${smallMoon}<path d="M9 19h8a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.1 12.5 3 3 0 0 0 9 19z"/>`),
  fog: svg('<path d="M4 9h16M3 13h18M5 17h14M8 21h8"/>'),
  drizzle: svg(`<path d="${cloudLow}"/>${drops(3)}`),
  rain: svg(`<path d="${cloudLow}"/><path d="M8 18l-1.5 4M12 18l-1.5 4M16 18l-1.5 4"/>`),
  sleet: svg(`<path d="${cloudLow}"/><path d="M8 18l-1.5 4M16 18l-1.5 4"/><path d="M12 20h.01" stroke-width="2.5"/>`),
  snow: svg(`<path d="${cloudLow}"/>${flakes}`),
  thunder: svg(`<path d="${cloudLow}"/><path d="M12.5 15l-2.5 4h3l-2 4"/>`),
  umbrella: svg('<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 12v7a2 2 0 0 1-4 0"/><path d="M12 2v1"/>'),
  sunscreen: svg('<rect x="8" y="9" width="8" height="12" rx="2"/><path d="M10 9V6h4v3M10 5h4"/><path d="M11 14.5a1 1 0 0 1 2 0" /><path d="M19 4l1-1M20 8h1.5M4 8H2.5M5 4L4 3"/>'),
  frost: svg('<path d="M12 2v20M4.9 7l14.2 10M4.9 17L19.1 7"/><path d="M9 4l3 2 3-2M9 20l3-2 3 2M3.5 10.5L5 8l-.5-3M20.5 13.5L19 16l.5 3M3.5 13.5L5 16l-.5 3M20.5 10.5L19 8l.5-3"/>'),
  heat: svg('<path d="M10 13.5V5a2 2 0 0 1 4 0v8.5a4 4 0 1 1-4 0z"/><path d="M12 17v-6"/>'),
  wind: svg('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h7"/>'),
  warning: svg('<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18h.01"/>'),
  check: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'),
  sunrise: svg('<path d="M12 3v6M9 6l3-3 3 3M4 15a8 8 0 0 1 16 0M2 19h20M5.6 10.6l-1.4-1.4M19.8 9.2l-1.4 1.4"/>'),
  sunset: svg('<path d="M12 9V3M9 6l3 3 3-3M4 15a8 8 0 0 1 16 0M2 19h20M5.6 10.6l-1.4-1.4M19.8 9.2l-1.4 1.4"/>'),
  drop: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0V4zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6v4H9z"/>'),
  flag: svg('<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>'),
  clockSmall: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pin: svg('<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  camera: svg('<rect x="3" y="7" width="14" height="10" rx="2"/><path d="M17 10l4-2v8l-4-2"/>'),
};

// Calendar icons (keys = CALENDAR_ICONS in shared/calendar-icons.js)
export const calIcons = {
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  family: svg('<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.3"/><path d="M2.5 20a5.5 5.5 0 0 1 11 0M13.5 20a3.6 3.6 0 0 1 7.5 0"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
  work: svg('<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3 12.5h18"/>'),
  school: svg('<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>'),
  sport: svg('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
  ball: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4 2.9-1.5 4.7h-5L8 10.4z"/><path d="M12 3v4.5M16 10.4l4.4-1.5M14.5 15.1l2.7 3.8M9.5 15.1l-2.7 3.8M8 10.4L3.6 8.9"/>'),
  cake: svg('<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M5 16c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 12V8.5"/><path d="M12 3.5c.9 1 1.3 1.8 1.3 2.5a1.3 1.3 0 0 1-2.6 0c0-.7.4-1.5 1.3-2.5z"/>'),
  party: svg('<path d="M4 20l5-13 8 8-13 5z"/><path d="M14 4l.5 2M19 6l-2 1M20 11l-2-.5M11 3.5c1 1.5 1 3 0 4.5"/>'),
  medical: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  plane: svg('<path d="M10.5 13.5L3 11l1.5-1.5 7.5.5 4-4.5c.9-.9 2.4-1.2 3-.6s.3 2.1-.6 3l-4.5 4 .5 7.5L13 21l-2.5-7.5z"/>'),
  car: svg('<path d="M5 16V11.5L7 6.5A2 2 0 0 1 8.9 5h6.2A2 2 0 0 1 17 6.5l2 5V16"/><rect x="3.5" y="11" width="17" height="6" rx="1.5"/><path d="M6 17v2.5M18 17v2.5"/><circle cx="7.5" cy="14" r=".8"/><circle cx="16.5" cy="14" r=".8"/>'),
  home: svg('<path d="M3.5 11L12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5M10 20v-5.5h4V20"/>'),
  cart: svg('<path d="M3 4h2.5l2.2 11h10.3l2-7.5H6.6"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>'),
  music: svg('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
  paw: svg('<circle cx="6" cy="10.5" r="1.8"/><circle cx="9.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10.5" r="1.8"/><path d="M12 12c-2.6 0-5 3.4-5 5.6 0 1.6 1.4 2.4 2.8 2.4 1 0 1.5-.5 2.2-.5s1.2.5 2.2.5c1.4 0 2.8-.8 2.8-2.4 0-2.2-2.4-5.6-5-5.6z"/>'),
  star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>'),
  flag: icons.flag,
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
};

export function bin(color) {
  return `<svg class="ico bin" viewBox="0 0 24 24"><path d="M5 7h14l-1.2 13.2A2 2 0 0 1 15.8 22H8.2a2 2 0 0 1-2-1.8L5 7z" fill="${color}" stroke="${color}" stroke-width="1"/><rect x="3.5" y="4" width="17" height="3" rx="1" fill="${color}"/><path d="M10 2h4" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M9.5 10.5v8M14.5 10.5v8" stroke="rgba(0,0,0,.35)" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

export function plane(color, rotation) {
  return `<svg viewBox="0 0 24 24" style="transform:rotate(${rotation}deg)"><path d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.3v4.7l2.2 1.7v1.6L12 20.6l-3.5.9v-1.6l2.2-1.7v-4.7L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z" fill="${color}" stroke="rgba(0,0,0,.6)" stroke-width=".6"/></svg>`;
}

const WMO = {
  0: ['Clear', 'sun', 'moon'],
  1: ['Mainly clear', 'partly', 'partlyNight'],
  2: ['Partly cloudy', 'partly', 'partlyNight'],
  3: ['Overcast', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Rime fog', 'fog'],
  51: ['Light drizzle', 'drizzle'],
  53: ['Drizzle', 'drizzle'],
  55: ['Heavy drizzle', 'drizzle'],
  56: ['Freezing drizzle', 'sleet'],
  57: ['Freezing drizzle', 'sleet'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'sleet'],
  67: ['Freezing rain', 'sleet'],
  71: ['Light snow', 'snow'],
  73: ['Snowfall', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Rain showers', 'rain'],
  81: ['Rain showers', 'rain'],
  82: ['Violent showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'thunder'],
  96: ['Thunderstorm with hail', 'thunder'],
  99: ['Thunderstorm with hail', 'thunder'],
};

export function weatherInfo(code, isDay = true) {
  const [text, day, night] = WMO[code] || ['–', 'cloud'];
  const key = !isDay && night ? night : day;
  return { text, icon: icons[key], key };
}

export const hintIcons = {
  rain: 'umbrella', thunder: 'thunder', snow: 'snow', uv: 'sunscreen', frost: 'frost', heat: 'heat', wind: 'wind', dwd: 'warning', ok: 'check',
};

// ---- weather details & animated weather icons ---------------------------------
export const weatherIcons = {
  gauge: svg('<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 13l3.5-4M12 13h.01" /><path d="M7 17h10"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  dew: svg('<path d="M8 13V5a2 2 0 0 1 4 0v8a4 4 0 1 1-4 0z"/><path d="M18 9s2.5 2.7 2.5 4.5a2.5 2.5 0 0 1-5 0C15.5 11.7 18 9 18 9z"/>'),
  cloud: icons.cloud,
  sun: icons.sun,
  gust: svg('<path d="M3 9h9a2.5 2.5 0 1 0-2.5-2.5M3 13h14a3 3 0 1 1-3 3M3 17h6"/><path d="M17 5.5l2.5-1M19 9l2.5.5"/>'),
  leaf: svg('<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19l7-7"/>'),
  flower: svg('<circle cx="12" cy="10" r="2"/><path d="M12 8a2.5 2.5 0 1 1 2.2-3.7A2.5 2.5 0 1 1 15.6 9a2.5 2.5 0 1 1-1.3 4.2 2.5 2.5 0 1 1-4.6 0A2.5 2.5 0 1 1 8.4 9a2.5 2.5 0 1 1 1.4-4.7A2.5 2.5 0 0 1 12 8z"/><path d="M12 14v8M12 19c-1.5-1.5-3-2-5-2M12 20c1.5-1.5 3-2 5-2"/>'),
  // points north; rotate by (wind direction + 180)° so it shows where the wind blows to
  arrow: (deg) => `<svg class="ico w-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${Math.round(deg + 180)}deg)"><path d="M12 20V4M6.5 9.5L12 4l5.5 5.5"/></svg>`,
};

// Animated variants: the same drawings split into stacked layers (one <svg>
// per moving part) so the browser can animate them with transform/opacity
// only (compositor-friendly, no repaint of the SVG content per frame).
const layer = (cls, body, extra = '') => `<svg class="wl ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const sunRays = '<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const smallRays = '<path d="M8 2.5v1M2.5 8h1M4.1 4.1l.7.7M11.9 4.1l-.7.7M8 12.5v1M12.5 8h1M4.1 11.9l.7-.7"/>';
const partlyCloud = '<path d="M9 19h8a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.1 12.5 3 3 0 0 0 9 19z"/>';
const stars = '<path d="M18 3.5v2M17 4.5h2M21 8.5v1.4M20.3 9.2h1.4" stroke-width="1.1"/>';
const rainDrops = '<path d="M8 18l-1.5 4M12 18l-1.5 4M16 18l-1.5 4"/>';
const ANIM_LAYERS = {
  sun: () => layer('wl-rays', sunRays) + layer('wl-core', '<circle cx="12" cy="12" r="4"/>'),
  moon: () => layer('wl-stars', stars) + layer('wl-moon', moonBody),
  cloud: () => layer('wl-drift', `<path d="${cloudPath}"/>`),
  partly: () => layer('wl-srays', smallRays) + layer('wl-core', '<circle cx="8" cy="8" r="3"/>') + layer('wl-drift', partlyCloud),
  partlyNight: () => layer('wl-stars', stars) + layer('wl-core', smallMoon) + layer('wl-drift', partlyCloud),
  fog: () => layer('wl-fog1', '<path d="M4 9h16M5 17h14"/>') + layer('wl-fog2', '<path d="M3 13h18M8 21h8"/>'),
  drizzle: () => layer('wl-fall', drops(3)) + layer('wl-fall wl-fall2', drops(3)) + layer('wl-drift', `<path d="${cloudLow}"/>`),
  rain: () => layer('wl-fall', rainDrops) + layer('wl-fall wl-fall2', rainDrops) + layer('wl-drift', `<path d="${cloudLow}"/>`),
  sleet: () => layer('wl-fall', '<path d="M8 18l-1.5 4M16 18l-1.5 4"/><path d="M12 20h.01" stroke-width="2.5"/>') + layer('wl-fall wl-fall2', '<path d="M8 18l-1.5 4M16 18l-1.5 4"/><path d="M12 20h.01" stroke-width="2.5"/>') + layer('wl-drift', `<path d="${cloudLow}"/>`),
  snow: () => layer('wl-snow', flakes) + layer('wl-snow wl-snow2', flakes) + layer('wl-drift', `<path d="${cloudLow}"/>`),
  thunder: () => layer('wl-bolt', '<path d="M12.5 15l-2.5 4h3l-2 4"/>') + layer('wl-drift', `<path d="${cloudLow}"/>`),
};
export function animatedIcon(key) {
  const f = ANIM_LAYERS[key];
  return f ? `<span class="wa wa-${key}">${f()}</span>` : icons[key] || icons.cloud;
}
