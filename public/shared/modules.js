// Shared module/page/layout schema – used by the server (defaults, validation,
// secret stripping) and by the admin panel (form generation).

export const REGIONS = [
  { id: 'top_bar', label: 'Oben – volle Breite' },
  { id: 'top_left', label: 'Oben links' },
  { id: 'top_center', label: 'Oben Mitte' },
  { id: 'top_right', label: 'Oben rechts' },
  { id: 'middle_left', label: 'Mitte links' },
  { id: 'middle_center', label: 'Mitte' },
  { id: 'middle_right', label: 'Mitte rechts' },
  { id: 'bottom_left', label: 'Unten links' },
  { id: 'bottom_center', label: 'Unten Mitte' },
  { id: 'bottom_right', label: 'Unten rechts' },
  { id: 'bottom_bar', label: 'Unten – volle Breite' },
  { id: 'fullscreen', label: 'Vollbild-Hintergrund' },
];
const REGION_IDS = new Set(REGIONS.map((r) => r.id));

export const EFA_PRESETS = [
  { value: 'vvs', label: 'VVS Stuttgart', url: 'https://www3.vvs.de/mngvvs/' },
  { value: 'bw', label: 'Baden-Württemberg (bwegt / NVBW)', url: 'https://www.efa-bw.de/nvbw/' },
  { value: 'mvv', label: 'MVV München', url: 'https://efa.mvv-muenchen.de/ng/' },
  { value: 'bayern', label: 'Bayern (bahnland bayern)', url: 'https://bahnland-bayern.de/efa/' },
  { value: 'vgn', label: 'VGN Nürnberg', url: 'https://efa.vgn.de/vgnExt_oeffi/' },
  { value: 'vrr', label: 'VRR / NRW', url: 'https://efa.vrr.de/vrr/' },
  { value: 'custom', label: 'Eigene EFA-URL', url: '' },
];

export const TRANSIT_CATEGORIES = [
  { value: 'train', label: 'Zug (RE/RB/IC/ICE)' },
  { value: 'sbahn', label: 'S-Bahn' },
  { value: 'ubahn', label: 'U-Bahn' },
  { value: 'tram', label: 'Straßen-/Stadtbahn' },
  { value: 'bus', label: 'Bus' },
  { value: 'ferry', label: 'Fähre' },
  { value: 'other', label: 'Sonstige' },
];

export function transitBaseUrl(s) {
  if (s.provider === 'hafas') return (s.baseUrl || '').replace(/\/+$/, '');
  const preset = EFA_PRESETS.find((p) => p.value === s.efaPreset);
  let url = preset && preset.value !== 'custom' ? preset.url : s.baseUrl || '';
  if (url && !url.endsWith('/')) url += '/';
  return url;
}

const locationFields = [
  { key: 'useGlobalLocation', label: 'Standort aus „Allgemein“ verwenden', type: 'bool', default: true },
  { key: 'location', label: 'Eigener Standort', type: 'location', default: null, showIf: { useGlobalLocation: false } },
];

const DEFAULT_WASTE_TYPES = [
  { name: 'Restmüll', keywords: 'rest, restmüll, hausmüll, restabfall', color: '#9ca3af', enabled: true },
  { name: 'Biomüll', keywords: 'bio', color: '#a16207', enabled: true },
  { name: 'Papier', keywords: 'papier, pappe, altpapier, blaue', color: '#3b82f6', enabled: true },
  { name: 'Gelber Sack', keywords: 'gelb, verpackung, wertstoff, leichtverpackung, lvp', color: '#facc15', enabled: true },
  { name: 'Glas', keywords: 'glas', color: '#22c55e', enabled: true },
  { name: 'Grünschnitt', keywords: 'grün, grünschnitt, baum, garten', color: '#4ade80', enabled: true },
  { name: 'Sperrmüll', keywords: 'sperr', color: '#c084fc', enabled: true },
  { name: 'Schadstoffe', keywords: 'schadstoff, problemstoff', color: '#ef4444', enabled: true },
];

export const MODULE_TYPES = {
  clock: {
    label: 'Uhr & Datum',
    description: 'Uhrzeit, Datum und Kalenderwoche',
    defaultRegion: 'top_left',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'format24', label: '24-Stunden-Format', type: 'bool', default: true },
      { key: 'showSeconds', label: 'Sekunden anzeigen', type: 'bool', default: true },
      { key: 'showDate', label: 'Datum anzeigen', type: 'bool', default: true },
      { key: 'dateStyle', label: 'Datumsformat', type: 'select', default: 'full', options: [
        { value: 'full', label: 'Samstag, 24. Oktober 2026' },
        { value: 'long', label: '24. Oktober 2026' },
        { value: 'medium', label: '24.10.2026' },
      ] },
      { key: 'showWeek', label: 'Kalenderwoche anzeigen', type: 'bool', default: true },
      { key: 'size', label: 'Größe', type: 'select', default: 'large', options: [
        { value: 'small', label: 'Klein' }, { value: 'medium', label: 'Mittel' }, { value: 'large', label: 'Groß' }, { value: 'huge', label: 'Riesig' },
      ] },
    ],
  },

  weather: {
    label: 'Wetter',
    description: 'Aktuelles Wetter, Stundenverlauf und Vorhersage (Open-Meteo)',
    defaultRegion: 'top_right',
    defaultTitle: '',
    refresh: 600,
    fields: [
      ...locationFields,
      { key: 'showCurrent', label: 'Aktuelles Wetter', type: 'bool', default: true },
      { key: 'showDetails', label: 'Gefühlt, Wind & Luftfeuchte', type: 'bool', default: true },
      { key: 'showSun', label: 'Sonnenauf- und -untergang', type: 'bool', default: true },
      { key: 'showHourly', label: 'Stundenverlauf', type: 'bool', default: true },
      { key: 'hourlyCount', label: 'Anzahl Stunden', type: 'number', default: 6, min: 1, max: 24 },
      { key: 'hourlyStep', label: 'Stunden-Schritt', type: 'number', default: 2, min: 1, max: 6 },
      { key: 'forecastDays', label: 'Vorhersage-Tage (0 = aus)', type: 'number', default: 5, min: 0, max: 7 },
      { key: 'units', label: 'Einheiten', type: 'select', default: 'metric', options: [
        { value: 'metric', label: '°C, km/h, mm' }, { value: 'imperial', label: '°F, mph, inch' },
      ] },
    ],
  },

  weather_hints: {
    label: 'Wetter-Hinweise',
    description: 'Regenschirm, Eincremen, Frost, Hitze, Sturm & DWD-Warnungen',
    defaultRegion: 'top_center',
    defaultTitle: '',
    refresh: 600,
    fields: [
      ...locationFields,
      { key: 'lookaheadHours', label: 'Vorausschau (Stunden)', type: 'number', default: 12, min: 1, max: 48 },
      { key: 'rain', label: 'Regen → „Regenschirm nicht vergessen“', type: 'bool', default: true },
      { key: 'rainProbability', label: 'Regenwahrscheinlichkeit ab (%)', type: 'number', default: 50, min: 0, max: 100, showIf: { rain: true } },
      { key: 'rainMinMm', label: 'Mindestmenge pro Stunde (mm)', type: 'number', default: 0.3, min: 0, max: 20, step: 0.1, showIf: { rain: true } },
      { key: 'uv', label: 'UV-Index → „Eincremen nicht vergessen“', type: 'bool', default: true },
      { key: 'uvThreshold', label: 'UV-Index ab', type: 'number', default: 5, min: 1, max: 12, showIf: { uv: true } },
      { key: 'snow', label: 'Schneefall', type: 'bool', default: true },
      { key: 'frost', label: 'Frost / Glätte', type: 'bool', default: true },
      { key: 'frostTemp', label: 'Frost-Hinweis ab (°C) und kälter', type: 'number', default: 1, min: -20, max: 10, showIf: { frost: true } },
      { key: 'heat', label: 'Hitze', type: 'bool', default: true },
      { key: 'heatTemp', label: 'Hitze-Hinweis ab (°C)', type: 'number', default: 30, min: 20, max: 45, showIf: { heat: true } },
      { key: 'wind', label: 'Sturmböen', type: 'bool', default: true },
      { key: 'windGust', label: 'Böen ab (km/h)', type: 'number', default: 60, min: 20, max: 150, showIf: { wind: true } },
      { key: 'dwdWarnings', label: 'Amtliche DWD-Warnungen (nur Deutschland)', type: 'bool', default: true },
      { key: 'showWhenNone', label: 'Bei gutem Wetter positive Meldung zeigen', type: 'bool', default: false },
    ],
  },

  calendar: {
    label: 'Kalender',
    description: 'Termine aus mehreren iCal-/ICS-Kalendern',
    defaultRegion: 'middle_left',
    defaultTitle: 'Termine',
    refresh: 600,
    fields: [
      { key: 'calendars', label: 'Kalender', type: 'list', itemLabel: 'Kalender', default: [], fields: [
        { key: 'name', label: 'Name', type: 'text', default: 'Kalender' },
        { key: 'url', label: 'iCal-URL (https:// oder webcal://)', type: 'text', default: '', secret: true, placeholder: 'https://calendar.google.com/calendar/ical/.../basic.ics' },
        { key: 'color', label: 'Farbe', type: 'color', default: '#7dd3fc' },
        { key: 'enabled', label: 'Aktiv', type: 'bool', default: true },
      ] },
      { key: 'daysAhead', label: 'Tage im Voraus', type: 'number', default: 14, min: 1, max: 365 },
      { key: 'maxEvents', label: 'Max. Termine', type: 'number', default: 10, min: 1, max: 50 },
      { key: 'groupByDay', label: 'Nach Tagen gruppieren', type: 'bool', default: true },
      { key: 'showLocation', label: 'Ort anzeigen', type: 'bool', default: false },
      { key: 'showCalendarName', label: 'Kalendername anzeigen', type: 'bool', default: false },
    ],
  },

  waste: {
    label: 'Müllkalender',
    description: 'Abholtermine aus iCal-Datei oder festen Intervallen',
    defaultRegion: 'middle_right',
    defaultTitle: 'Müllabfuhr',
    refresh: 3600,
    fields: [
      { key: 'sources', label: 'iCal-Quellen (vom Abfallwirtschaftsbetrieb)', type: 'list', itemLabel: 'Quelle', default: [], fields: [
        { key: 'name', label: 'Name', type: 'text', default: 'Abfuhrkalender' },
        { key: 'url', label: 'iCal-URL', type: 'text', default: '', secret: true },
      ] },
      { key: 'manual', label: 'Feste Intervalle (ohne iCal)', type: 'list', itemLabel: 'Intervall', default: [], fields: [
        { key: 'type', label: 'Müllart (Name wie unten)', type: 'text', default: 'Restmüll' },
        { key: 'startDate', label: 'Erster Termin', type: 'date', default: '' },
        { key: 'intervalWeeks', label: 'Alle x Wochen', type: 'number', default: 2, min: 1, max: 52 },
      ] },
      { key: 'types', label: 'Müllarten & Farben', type: 'list', itemLabel: 'Müllart', default: DEFAULT_WASTE_TYPES, fields: [
        { key: 'name', label: 'Name', type: 'text', default: '' },
        { key: 'keywords', label: 'Suchbegriffe im Termin (kommagetrennt)', type: 'text', default: '' },
        { key: 'color', label: 'Farbe', type: 'color', default: '#9ca3af' },
        { key: 'enabled', label: 'Anzeigen', type: 'bool', default: true },
      ] },
      { key: 'daysAhead', label: 'Tage im Voraus', type: 'number', default: 21, min: 1, max: 120 },
      { key: 'maxEntries', label: 'Max. Abholtage', type: 'number', default: 4, min: 1, max: 20 },
      { key: 'showUnknown', label: 'Nicht zugeordnete Termine anzeigen', type: 'bool', default: true },
      { key: 'reminderHour', label: 'Erinnerung „heute rausstellen“ ab Uhrzeit (Vortag)', type: 'number', default: 15, min: 0, max: 23 },
    ],
  },

  f1: {
    label: 'Formel 1',
    description: 'Nächstes Rennen mit Sessions, Countdown, Wetter an der Strecke & WM-Stand',
    defaultRegion: 'middle_left',
    defaultTitle: 'Formel 1',
    refresh: 1800,
    fields: [
      { key: 'showCountdown', label: 'Countdown', type: 'bool', default: true },
      { key: 'showSessions', label: 'Zeitplan aller Sessions', type: 'bool', default: true },
      { key: 'showTrackWeather', label: 'Wetter an der Strecke (Renntag)', type: 'bool', default: true },
      { key: 'showPreviousWinner', label: 'Vorjahressieger', type: 'bool', default: true },
      { key: 'showLastRace', label: 'Podium letztes Rennen', type: 'bool', default: true },
      { key: 'showDriverStandings', label: 'Fahrer-WM', type: 'bool', default: true },
      { key: 'showConstructorStandings', label: 'Konstrukteurs-WM', type: 'bool', default: false },
      { key: 'standingsCount', label: 'Anzahl Plätze WM-Stand', type: 'number', default: 5, min: 1, max: 22 },
      { key: 'favoriteDrivers', label: 'Lieblingsfahrer hervorheben (Kürzel, z. B. VER, HAM)', type: 'text', default: '' },
    ],
  },

  transit: {
    label: 'ÖPNV-Abfahrten',
    description: 'Live-Abfahrtstafel einer Haltestelle (EFA-Verbünde oder HAFAS-REST)',
    defaultRegion: 'bottom_left',
    defaultTitle: 'Abfahrten',
    refresh: 30,
    fields: [
      { key: 'provider', label: 'Anbieter', type: 'select', default: 'efa', options: [
        { value: 'efa', label: 'EFA (Verkehrsverbund)' }, { value: 'hafas', label: 'HAFAS-REST (z. B. db-rest / transport.rest)' },
      ] },
      { key: 'efaPreset', label: 'Verkehrsverbund', type: 'select', default: 'vvs', options: EFA_PRESETS.map(({ value, label }) => ({ value, label })), showIf: { provider: 'efa' } },
      { key: 'baseUrl', label: 'Basis-URL', type: 'text', default: '', placeholder: 'https://v6.db.transport.rest', showIf: { _transitCustom: true } },
      { key: 'stop', label: 'Haltestelle', type: 'transitStop', default: null },
      { key: 'limit', label: 'Anzahl Abfahrten', type: 'number', default: 8, min: 1, max: 30 },
      { key: 'walkMinutes', label: 'Fußweg zur Haltestelle (Min., frühere ausblenden)', type: 'number', default: 0, min: 0, max: 60 },
      { key: 'categories', label: 'Verkehrsmittel', type: 'multiselect', default: TRANSIT_CATEGORIES.map((c) => c.value), options: TRANSIT_CATEGORIES },
      { key: 'lines', label: 'Nur diese Linien (kommagetrennt, leer = alle)', type: 'text', default: '' },
      { key: 'excludeDestinations', label: 'Ziele ausblenden (kommagetrennt)', type: 'text', default: '' },
      { key: 'timeMode', label: 'Zeitanzeige', type: 'select', default: 'relative', options: [
        { value: 'relative', label: 'in x Min.' }, { value: 'absolute', label: 'Uhrzeit' }, { value: 'both', label: 'Beides' },
      ] },
      { key: 'showPlatform', label: 'Gleis/Steig anzeigen', type: 'bool', default: true },
      { key: 'showDelay', label: 'Verspätung anzeigen', type: 'bool', default: true },
    ],
  },

  flights: {
    label: 'Flugzeug-Karte',
    description: 'Live-Karte der Flugzeuge in der Nähe (eigener ADS-B-Stick oder adsb.lol)',
    defaultRegion: 'middle_center',
    defaultTitle: 'Luftraum',
    refresh: 5,
    fields: [
      { key: 'source', label: 'Datenquelle', type: 'select', default: 'adsblol', options: [
        { value: 'local', label: 'Eigener ADS-B-Empfänger (readsb / ultrafeeder)' },
        { value: 'adsblol', label: 'adsb.lol (online, ohne Stick)' },
        { value: 'airplaneslive', label: 'airplanes.live (online, ohne Stick)' },
      ] },
      { key: 'localUrl', label: 'aircraft.json-URL', type: 'text', default: 'http://ultrafeeder/data/aircraft.json', showIf: { source: 'local' } },
      ...locationFields,
      { key: 'radiusKm', label: 'Radius (km)', type: 'number', default: 40, min: 5, max: 400 },
      { key: 'zoom', label: 'Zoomstufe', type: 'number', default: 9, min: 4, max: 14 },
      { key: 'height', label: 'Höhe der Karte (% Bildschirmhöhe)', type: 'number', default: 35, min: 10, max: 100 },
      { key: 'refreshSeconds', label: 'Aktualisierung (Sek.)', type: 'number', default: 5, min: 2, max: 120 },
      { key: 'maxAltitudeFt', label: 'Max. Flughöhe (ft, 0 = alle)', type: 'number', default: 0, min: 0, max: 60000 },
      { key: 'showLabels', label: 'Rufzeichen auf der Karte', type: 'bool', default: true },
      { key: 'showRings', label: 'Entfernungsringe', type: 'bool', default: true },
      { key: 'showList', label: 'Liste der nächsten Flugzeuge', type: 'bool', default: true },
      { key: 'listCount', label: 'Anzahl in der Liste', type: 'number', default: 5, min: 1, max: 20 },
      { key: 'tiles', label: 'Kartenstil', type: 'select', default: 'esri_dark', options: [
        { value: 'esri_dark', label: 'Dunkel (Esri Dark Gray)' }, { value: 'osm_dark', label: 'OpenStreetMap dunkel' }, { value: 'osm', label: 'OpenStreetMap hell' }, { value: 'custom', label: 'Eigene Kachel-URL' },
      ] },
      { key: 'tileUrl', label: 'Kachel-URL ({z}/{x}/{y})', type: 'text', default: '', placeholder: 'https://tile.example.com/{z}/{x}/{y}.png', showIf: { tiles: 'custom' } },
    ],
  },

  camera: {
    label: 'Kamera (RTSP)',
    description: 'RTSP-Kamerastreams über go2rtc – als Live-Video oder Standbild',
    defaultRegion: 'bottom_right',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'streams', label: 'Streams', type: 'list', itemLabel: 'Stream', default: [], fields: [
        { key: 'name', label: 'Name', type: 'text', default: 'Kamera' },
        { key: 'url', label: 'RTSP-URL', type: 'text', default: '', secret: true, placeholder: 'rtsp://user:pass@192.168.1.20:554/stream2' },
        { key: 'enabled', label: 'Aktiv', type: 'bool', default: true },
      ] },
      { key: 'mode', label: 'Modus', type: 'select', default: 'snapshot', options: [
        { value: 'snapshot', label: 'Standbild (schont den Raspberry Pi)' }, { value: 'live', label: 'Live-Video (MSE/WebRTC)' },
      ] },
      { key: 'refreshSeconds', label: 'Standbild-Aktualisierung (Sek.)', type: 'number', default: 5, min: 1, max: 600, showIf: { mode: 'snapshot' } },
      { key: 'width', label: 'Breite (% der Spalte)', type: 'number', default: 70, min: 20, max: 100 },
      { key: 'columns', label: 'Spalten', type: 'number', default: 1, min: 1, max: 4 },
      { key: 'showName', label: 'Namen einblenden', type: 'bool', default: true },
    ],
  },

  greeting: {
    label: 'Begrüßung',
    description: 'Wechselnde Sprüche je nach Tageszeit',
    defaultRegion: 'bottom_center',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'name', label: 'Name (für {name})', type: 'text', default: '' },
      { key: 'morning', label: 'Morgens (5–11 Uhr), eine Zeile je Spruch', type: 'textarea', default: 'Guten Morgen{name}!\nAuf einen guten Tag!\nKaffee schon gehabt?' },
      { key: 'afternoon', label: 'Mittags (11–17 Uhr)', type: 'textarea', default: 'Schönen Nachmittag{name}!\nHalbzeit – weiter so!' },
      { key: 'evening', label: 'Abends (17–22 Uhr)', type: 'textarea', default: 'Guten Abend{name}!\nZeit zum Entspannen.\nSchön, dass du da bist.' },
      { key: 'night', label: 'Nachts (22–5 Uhr)', type: 'textarea', default: 'Gute Nacht{name}!\nSchlaf gut.' },
      { key: 'intervalSeconds', label: 'Wechsel alle (Sek.)', type: 'number', default: 60, min: 5, max: 3600 },
      { key: 'size', label: 'Größe', type: 'select', default: 'large', options: [
        { value: 'small', label: 'Klein' }, { value: 'medium', label: 'Mittel' }, { value: 'large', label: 'Groß' },
      ] },
    ],
  },

  text: {
    label: 'Freitext',
    description: 'Eigener Text, Notiz oder WLAN-Info',
    defaultRegion: 'bottom_bar',
    defaultTitle: '',
    refresh: 0,
    fields: [
      { key: 'content', label: 'Text', type: 'textarea', default: '' },
      { key: 'align', label: 'Ausrichtung', type: 'select', default: 'center', options: [
        { value: 'left', label: 'Links' }, { value: 'center', label: 'Mitte' }, { value: 'right', label: 'Rechts' },
      ] },
      { key: 'size', label: 'Größe', type: 'select', default: 'medium', options: [
        { value: 'small', label: 'Klein' }, { value: 'medium', label: 'Mittel' }, { value: 'large', label: 'Groß' },
      ] },
    ],
  },
};

export const GENERAL_FIELDS = [
  { key: 'name', label: 'Name des Spiegels', type: 'text', default: 'Magic Mirror' },
  { key: 'location', label: 'Standort (Wetter, Flüge, …)', type: 'location', default: { name: 'Berlin', lat: 52.52, lon: 13.405 } },
  { key: 'timezone', label: 'Zeitzone', type: 'text', default: 'Europe/Berlin' },
  { key: 'locale', label: 'Sprache/Format', type: 'select', default: 'de-DE', options: [
    { value: 'de-DE', label: 'Deutsch (Deutschland)' }, { value: 'de-AT', label: 'Deutsch (Österreich)' }, { value: 'de-CH', label: 'Deutsch (Schweiz)' }, { value: 'en-GB', label: 'English (UK)' },
  ] },
  { key: 'rotatePages', label: 'Seiten automatisch wechseln', type: 'bool', default: true },
  { key: 'pageIndicator', label: 'Seitenanzeige (Punkte) einblenden', type: 'bool', default: true },
  { key: 'transition', label: 'Seitenübergang', type: 'select', default: 'fade', options: [
    { value: 'fade', label: 'Überblenden' }, { value: 'slide', label: 'Schieben' }, { value: 'none', label: 'Keiner' },
  ] },
  { key: 'background', label: 'Hintergrund', type: 'color', default: '#000000' },
  { key: 'textColor', label: 'Textfarbe', type: 'color', default: '#ffffff' },
  { key: 'accentColor', label: 'Akzentfarbe', type: 'color', default: '#7dd3fc' },
  { key: 'fontScale', label: 'Schriftgröße (Faktor)', type: 'number', default: 1, min: 0.5, max: 3, step: 0.05 },
  { key: 'padding', label: 'Rand (% der Bildschirmgröße)', type: 'number', default: 3, min: 0, max: 15, step: 0.5 },
  { key: 'rotation', label: 'Bildschirm drehen', type: 'select', default: '0', options: [
    { value: '0', label: '0°' }, { value: '90', label: '90° (Hochformat)' }, { value: '180', label: '180°' }, { value: '270', label: '270° (Hochformat)' },
  ] },
  { key: 'showTitles', label: 'Modul-Überschriften anzeigen', type: 'bool', default: true },
  { key: 'hideCursor', label: 'Mauszeiger ausblenden', type: 'bool', default: true },
  { key: 'dimEnabled', label: 'Nachtmodus (abdunkeln)', type: 'bool', default: false },
  { key: 'dimFrom', label: 'Abdunkeln ab', type: 'time', default: '23:00', showIf: { dimEnabled: true } },
  { key: 'dimTo', label: 'Abdunkeln bis', type: 'time', default: '06:00', showIf: { dimEnabled: true } },
  { key: 'dimBrightness', label: 'Helligkeit nachts (%)', type: 'number', default: 30, min: 0, max: 100, showIf: { dimEnabled: true } },
  { key: 'autoReloadHours', label: 'Seite automatisch neu laden alle x Stunden (0 = nie)', type: 'number', default: 12, min: 0, max: 168 },
];

export function uid(prefix = 'm') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10);
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function coerce(field, value) {
  if (value === undefined || value === null) {
    return field.type === 'location' || field.type === 'transitStop' ? (value === null ? null : clone(field.default)) : clone(field.default);
  }
  switch (field.type) {
    case 'bool': return value === true || value === 'true';
    case 'number': {
      let n = Number(value);
      if (!Number.isFinite(n)) n = field.default;
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      return n;
    }
    case 'select': return field.options.some((o) => o.value === String(value)) ? String(value) : field.default;
    case 'multiselect': return Array.isArray(value) ? value.filter((v) => field.options.some((o) => o.value === v)) : clone(field.default);
    case 'list': return Array.isArray(value) ? value.filter((v) => v && typeof v === 'object').map((item) => applyDefaults(field.fields, item)) : clone(field.default);
    case 'location': {
      const lat = Number(value.lat), lon = Number(value.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { name: String(value.name || ''), lat, lon } : null;
    }
    case 'transitStop': return value.id ? { id: String(value.id), name: String(value.name || value.id) } : null;
    default: return String(value);
  }
}

export function applyDefaults(fields, values = {}) {
  const out = {};
  for (const f of fields) out[f.key] = coerce(f, values[f.key]);
  return out;
}

export function defaultModule(type, extra = {}) {
  const t = MODULE_TYPES[type];
  return {
    id: uid('m'),
    type,
    enabled: true,
    title: t.defaultTitle,
    pages: ['*'],
    region: t.defaultRegion,
    order: 0,
    settings: applyDefaults(t.fields, {}),
    ...extra,
  };
}

export function defaultConfig() {
  const m = (type, region, pages, order, extra = {}) => {
    const mod = defaultModule(type, { region, pages, order, ...extra });
    mod.id = 'm_' + type;
    return mod;
  };
  return {
    version: 1,
    general: applyDefaults(GENERAL_FIELDS, {}),
    pages: [
      { id: 'home', name: 'Start', duration: 45, enabled: true },
      { id: 'more', name: 'Unterwegs', duration: 25, enabled: true },
    ],
    modules: [
      m('clock', 'top_left', ['*'], 0),
      m('weather', 'top_right', ['*'], 0),
      m('weather_hints', 'top_center', ['*'], 0),
      m('calendar', 'middle_left', ['home'], 0),
      m('waste', 'middle_right', ['home'], 0),
      m('greeting', 'bottom_center', ['home'], 0),
      m('f1', 'middle_left', ['more'], 0),
      m('flights', 'middle_center', ['more'], 0),
      m('transit', 'middle_right', ['more'], 0, { enabled: false }),
      m('camera', 'bottom_right', ['more'], 0, { enabled: false }),
    ],
  };
}

export function normalizeConfig(input) {
  const d = defaultConfig();
  const c = input && typeof input === 'object' ? input : {};
  const general = applyDefaults(GENERAL_FIELDS, { ...d.general, ...(c.general || {}) });

  const seen = new Set();
  let pages = (Array.isArray(c.pages) && c.pages.length ? c.pages : d.pages)
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      let id = String(p.id || uid('p')).replace(/[^\w-]/g, '_');
      while (seen.has(id) || id === '*') id = uid('p');
      seen.add(id);
      const duration = Math.min(3600, Math.max(5, Number(p.duration) || 30));
      return { id, name: String(p.name || 'Seite'), duration, enabled: p.enabled !== false };
    });
  if (!pages.length) pages = d.pages;
  const pageIds = new Set(pages.map((p) => p.id));

  const seenMods = new Set();
  const modules = (Array.isArray(c.modules) ? c.modules : d.modules)
    .filter((m) => m && MODULE_TYPES[m.type])
    .map((m, i) => {
      const t = MODULE_TYPES[m.type];
      let id = String(m.id || uid('m')).replace(/[^\w-]/g, '_');
      while (seenMods.has(id)) id = uid('m');
      seenMods.add(id);
      let mp = Array.isArray(m.pages) ? m.pages.filter((p) => p === '*' || pageIds.has(p)) : ['*'];
      if (mp.includes('*')) mp = ['*'];
      if (!mp.length) mp = [pages[0].id];
      return {
        id,
        type: m.type,
        enabled: m.enabled !== false,
        title: typeof m.title === 'string' ? m.title : t.defaultTitle,
        pages: mp,
        region: REGION_IDS.has(m.region) ? m.region : t.defaultRegion,
        order: Number.isFinite(Number(m.order)) ? Number(m.order) : i,
        settings: applyDefaults(t.fields, m.settings || {}),
      };
    });

  return { version: 1, general, pages, modules, updatedAt: c.updatedAt || null };
}

function stripFields(fields, values) {
  for (const f of fields) {
    if (f.secret) delete values[f.key];
    else if (f.type === 'list' && Array.isArray(values[f.key])) values[f.key].forEach((item) => stripFields(f.fields, item));
  }
}

// Config for the (unauthenticated) mirror – without URLs/credentials.
export function publicConfig(cfg) {
  const c = clone(cfg);
  for (const m of c.modules) stripFields(MODULE_TYPES[m.type].fields, m.settings);
  return c;
}

export function resolveLocation(settings, general) {
  if (settings && settings.useGlobalLocation === false && settings.location) return settings.location;
  return general.location || { name: '', lat: 52.52, lon: 13.405 };
}
