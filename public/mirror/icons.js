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

export function bin(color) {
  return `<svg class="ico bin" viewBox="0 0 24 24"><path d="M5 7h14l-1.2 13.2A2 2 0 0 1 15.8 22H8.2a2 2 0 0 1-2-1.8L5 7z" fill="${color}" stroke="${color}" stroke-width="1"/><rect x="3.5" y="4" width="17" height="3" rx="1" fill="${color}"/><path d="M10 2h4" stroke="${color}" stroke-width="2" stroke-linecap="round"/><path d="M9.5 10.5v8M14.5 10.5v8" stroke="rgba(0,0,0,.35)" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

export function plane(color, rotation) {
  return `<svg viewBox="0 0 24 24" style="transform:rotate(${rotation}deg)"><path d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.3v4.7l2.2 1.7v1.6L12 20.6l-3.5.9v-1.6l2.2-1.7v-4.7L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z" fill="${color}" stroke="rgba(0,0,0,.6)" stroke-width=".6"/></svg>`;
}

const WMO = {
  0: ['Klar', 'sun', 'moon'],
  1: ['Überwiegend klar', 'partly', 'partlyNight'],
  2: ['Teilweise bewölkt', 'partly', 'partlyNight'],
  3: ['Bedeckt', 'cloud'],
  45: ['Nebel', 'fog'],
  48: ['Reifnebel', 'fog'],
  51: ['Leichter Nieselregen', 'drizzle'],
  53: ['Nieselregen', 'drizzle'],
  55: ['Starker Nieselregen', 'drizzle'],
  56: ['Gefrierender Niesel', 'sleet'],
  57: ['Gefrierender Niesel', 'sleet'],
  61: ['Leichter Regen', 'rain'],
  63: ['Regen', 'rain'],
  65: ['Starker Regen', 'rain'],
  66: ['Gefrierender Regen', 'sleet'],
  67: ['Gefrierender Regen', 'sleet'],
  71: ['Leichter Schneefall', 'snow'],
  73: ['Schneefall', 'snow'],
  75: ['Starker Schneefall', 'snow'],
  77: ['Schneegriesel', 'snow'],
  80: ['Regenschauer', 'rain'],
  81: ['Regenschauer', 'rain'],
  82: ['Heftige Schauer', 'rain'],
  85: ['Schneeschauer', 'snow'],
  86: ['Schneeschauer', 'snow'],
  95: ['Gewitter', 'thunder'],
  96: ['Gewitter mit Hagel', 'thunder'],
  99: ['Gewitter mit Hagel', 'thunder'],
};

export function weatherInfo(code, isDay = true) {
  const [text, day, night] = WMO[code] || ['–', 'cloud'];
  return { text, icon: icons[!isDay && night ? night : day] };
}

export const hintIcons = {
  rain: 'umbrella', thunder: 'thunder', snow: 'snow', uv: 'sunscreen', frost: 'frost', heat: 'heat', wind: 'wind', dwd: 'warning', ok: 'check',
};
