// "Aircraft map" renderer: live map of nearby aircraft and/or a spotlight card for the nearest one.
// Pi 3 friendly: no per-frame animation – markers and the map only change when new data arrives.
import { greatCircle } from '/shared/geo.js';
import { esc, num } from './renderers.js';
import { plane } from './icons.js';
import { compass } from './weather-chart.js';

let leafletPromise = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/leaflet/leaflet.css';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = '/vendor/leaflet/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = reject;
    document.head.append(js);
  });
  return leafletPromise;
}

function altColor(a) {
  if (a.ground || a.alt === null) return '#9ca3af';
  if (a.alt < 3000) return '#fb923c';
  if (a.alt < 10000) return '#facc15';
  if (a.alt < 25000) return '#4ade80';
  if (a.alt < 35000) return '#38bdf8';
  return '#c084fc';
}

export const TILES = {
  esri_dark: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri, HERE, Garmin, © OpenStreetMap', className: 'tiles-dim' },
  osm_dark: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', className: 'tiles-dark' },
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap' },
};

// Unit handling. The server delivers ft, km/h, km and ft/min.
const UNITS = {
  ft_kmh: { alt: 'ft', speed: 'km/h', dist: 'km' },
  metric: { alt: 'm', speed: 'km/h', dist: 'km' },
  aviation: { alt: 'ft', speed: 'kt', dist: 'NM' },
  imperial: { alt: 'ft', speed: 'mph', dist: 'mi' },
};
function unitFmt(units, locale, t) {
  const u = UNITS[units] || UNITS.ft_kmh;
  const int = (n) => Math.round(n).toLocaleString(locale);
  return {
    alt: (a) => (a.ground ? t('on ground') : a.alt === null ? '–' : u.alt === 'm' ? `${int(a.alt * 0.3048)} m` : `${int(a.alt)} ft`),
    speed: (kmh) => (kmh === null || kmh === undefined ? '–' : u.speed === 'kt' ? `${int(kmh / 1.852)} kt` : u.speed === 'mph' ? `${int(kmh / 1.609344)} mph` : `${int(kmh)} km/h`),
    distNum: (km, d = km < 10 ? 1 : 0) => num(u.dist === 'NM' ? km / 1.852 : u.dist === 'mi' ? km / 1.609344 : km, d),
    distUnit: u.dist,
    vrate: (fpm) => (u.alt === 'm' ? `${num(Math.abs(fpm) * 0.00508, 1)} m/s` : `${int(Math.abs(fpm))} ft/min`),
  };
}

const arrow = (deg) => `<svg class="fl-arrow" viewBox="0 0 24 24" style="transform:rotate(${Math.round(deg)}deg)"><path d="M12 2l7 18-7-4-7 4z" fill="currentColor"/></svg>`;
const vIcon = (dir) => `<svg class="fl-vicon" viewBox="0 0 24 24"><path d="${dir > 0 ? 'M4 18L18 6M10 6h8v8' : dir < 0 ? 'M4 6l14 12M10 18h8v-8' : 'M3 12h16M13 6l6 6-6 6'}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const silhouette = () => `<div class="fl-nophoto">${plane('rgba(255,255,255,.22)', 45)}</div>`;

export function flights(el, mod, ctx, region) {
  const s = mod.settings;
  const t = ctx.fmt.t;
  const locale = ctx.fmt.locale;
  const full = region === 'fullscreen';
  const display = s.display === 'nearest' || s.display === 'both' ? s.display : 'map';
  const spotOnly = display === 'nearest';
  const u = unitFmt(s.units, locale, t);
  const trailMax = display === 'map' ? 0 : s.trailLength ?? 20;
  // Height: 0 = take the free height of the region; a number = preferred height that still
  // shrinks when the region is smaller (old configs used to be clipped at the bottom).
  const autoH = !(s.height > 0);
  const sizeStyle = full || autoH ? '' : ` style="flex-basis:${s.height}vh"`;
  const wrap = el.closest('.module');
  if (wrap && !full) wrap.classList.add('fl-flex', autoH ? 'fl-grow' : 'fl-shrink');

  const spotHtml = `<div class="fl-spot${spotOnly ? '' : ' compact'}"><div class="fl-head"></div><div class="fl-route"></div><div class="fl-media"${spotOnly ? sizeStyle : ''}>${spotOnly ? '<div class="fl-map"></div>' : ''}${s.showPhoto !== false ? '<figure class="fl-photo"></figure>' : ''}</div><div class="fl-stats"></div></div>`;
  el.innerHTML = `<div class="flights mode-${display}${full ? ' full' : ''}${autoH ? ' h-auto' : ''}">${spotOnly ? '' : `<div class="fl-map"${sizeStyle}></div>`}${display === 'map' ? '' : spotHtml}${s.showList && display === 'map' ? '<div class="fl-list"></div>' : ''}</div>`;
  const mapEl = el.querySelector('.fl-map');
  const listEl = el.querySelector('.fl-list');
  const spotEl = el.querySelector('.fl-spot');
  const photoEl = el.querySelector('.fl-photo');

  let map = null;
  let layer = null;
  let overlay = null; // line me → spotlight aircraft and its trail
  let me = null;
  const markers = new Map();
  const trails = new Map(); // hex → [[lat, lon], …] (client-side history)
  let pending = null;
  let spotHex;
  let photoSrc;
  let fadeTimer = null;
  let resizeObs = null;

  // The map is created once the first data (with the module's own location) is there.
  let leafletReady = false;
  loadLeaflet().then(() => {
    leafletReady = true;
    if (pending) initMap(pending.center);
    // No data yet (source down or rate-limited): still show the map around our location.
    else setTimeout(() => !map && initMap(s.location || ctx.general.location), 5000);
  });

  function initMap(c) {
    const L = window.L;
    me = c;
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false });
    map.setView([c.lat, c.lon], s.zoom);
    const tiles = TILES[s.tiles] || { url: s.tileUrl, attribution: '' };
    if (tiles.url) L.tileLayer(tiles.url, { maxZoom: 18, attribution: tiles.attribution, className: tiles.className || '' }).addTo(map);
    if (s.showRings && !spotOnly) {
      for (const f of [1 / 3, 2 / 3, 1]) L.circle([c.lat, c.lon], { radius: s.radiusKm * f * 1000, color: '#ffffff', opacity: 0.18, weight: 1, fill: false, interactive: false }).addTo(map);
    }
    overlay = L.layerGroup().addTo(map);
    L.circleMarker([c.lat, c.lon], { radius: 5, color: '#fff', weight: 2, fillColor: ctx.general.accentColor, fillOpacity: 1, interactive: false }).addTo(map);
    layer = L.layerGroup().addTo(map);
    // The map's box follows the region (flex layout, page switches, fill modules): keep tiles and centre right.
    // (setTimeout, not requestAnimationFrame: rAF is paused while the page is hidden.)
    if (window.ResizeObserver) {
      let timer = 0;
      resizeObs = new ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(relayout, 60);
      });
      resizeObs.observe(mapEl);
    }
    relayout();
  }

  function relayout() {
    if (!map || !mapEl.offsetWidth || !mapEl.offsetHeight) return;
    map.invalidateSize({ pan: false, animate: false });
    if (pending) draw(pending);
    const spot = pending?.spotlight;
    if (spotOnly && spot) {
      framedHex = null;
      frame(pending.center || me, spot);
    } else if (!spotOnly) {
      const c = pending?.center || me;
      map.setView([c.lat, c.lon], map.getZoom(), { animate: false, reset: true }); // reset: redraw rings/paths for the new size
    }
  }

  function marker(a, isSpot) {
    const L = window.L;
    const label = s.showLabels || isSpot ? `<div class="ac-label">${esc(a.flight)}<br><span>${a.ground ? 'GND' : a.alt !== null ? `${Math.round(a.alt / 100)}` : ''}</span></div>` : '';
    const size = isSpot ? 30 : 22;
    const html = `<div class="ac-icon${isSpot ? ' spot' : ''}">${plane(isSpot ? '#fff' : altColor(a), a.track ?? 0)}</div>${label}`;
    return L.divIcon({ className: `ac${isSpot ? ' ac-spot' : ''}`, html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  function draw(d) {
    const L = window.L;
    const spot = d.spotlight || null;
    const shown = spotOnly ? (spot ? [spot] : []) : d.aircraft;
    const seen = new Set();
    for (const a of shown) {
      seen.add(a.hex);
      const icon = marker(a, spot && a.hex === spot.hex);
      if (markers.has(a.hex)) markers.get(a.hex).setLatLng([a.lat, a.lon]).setIcon(icon);
      else markers.set(a.hex, L.marker([a.lat, a.lon], { icon, interactive: false, keyboard: false }).addTo(layer));
      if (spot && a.hex === spot.hex) markers.get(a.hex).setZIndexOffset(1000);
    }
    for (const [hex, m] of markers) {
      if (!seen.has(hex)) {
        layer.removeLayer(m);
        markers.delete(hex);
      }
    }
    overlay.clearLayers();
    if (!spot) return;
    const c = d.center || me;
    L.polyline([[c.lat, c.lon], [spot.lat, spot.lon]], { color: ctx.general.accentColor || '#fff', weight: 2, opacity: 0.8, dashArray: '6 6', interactive: false }).addTo(overlay);
    const trail = trails.get(spot.hex);
    if (trail && trail.length > 1) L.polyline(trail, { color: '#fff', weight: 2, opacity: 0.45, interactive: false }).addTo(overlay);
    const path = routePath(spot);
    if (path) {
      // flown part: thin and faint, remaining part: dashed in the accent colour, airports labelled
      L.polyline(path.flown, { color: '#fff', weight: 1.5, opacity: 0.35, interactive: false }).addTo(overlay);
      L.polyline(path.ahead, { color: ctx.general.accentColor || '#7dd3fc', weight: 2, opacity: 0.75, dashArray: '2 7', lineCap: 'round', interactive: false }).addTo(overlay);
      for (const [ap, cls] of [[path.from, 'from'], [path.to, 'to']]) {
        const html = `<span class="ap-dot"></span><span class="ap-code">${esc(ap.iata || ap.icao)}</span>`;
        L.marker([ap.lat, ap.lon], { icon: L.divIcon({ className: `ap-mark ${cls}`, html, iconSize: [10, 10], iconAnchor: [5, 5] }), interactive: false, keyboard: false }).addTo(overlay);
      }
    }
    if (spotOnly && mapEl.offsetWidth && mapEl.offsetHeight) frame(c, spot);
  }

  // Keep me and the aircraft in view; only move the map when really needed (tile loads are slow on a Pi).
  let framedHex;
  function frame(c, a) {
    const L = window.L;
    const path = s.spotMapView === 'route' ? routePath(a) : null;
    const bounds = L.latLngBounds([[c.lat, c.lon], [a.lat, a.lon], ...(path ? [[path.from.lat, path.from.lon], [path.to.lat, path.to.lon]] : [])]);
    const pad = [40, 40];
    const want = Math.min(13, map.getBoundsZoom(bounds, false, L.point(pad)));
    const inner = map.getBounds().pad(-0.12);
    if (framedHex !== a.hex || !inner.contains([a.lat, a.lon]) || want > map.getZoom() + 1) {
      map.fitBounds(bounds, { padding: pad, maxZoom: 13, animate: false, reset: true });
      framedHex = a.hex;
    }
  }

  // Great-circle flight path origin → aircraft → destination (needs airport coordinates).
  function routePath(a) {
    const r = a.route;
    if (s.routeOnMap === false || !r || r.plausible === false || !Number.isFinite(r.from?.lat) || !Number.isFinite(r.to?.lat)) return null;
    return { from: r.from, to: r.to, flown: greatCircle(r.from, a), ahead: greatCircle(a, r.to) };
  }

  function updateTrails(d) {
    if (!trailMax) return;
    const seen = new Set();
    for (const a of d.aircraft) {
      seen.add(a.hex);
      const tr = trails.get(a.hex) || [];
      const last = tr[tr.length - 1];
      if (!last || last[0] !== a.lat || last[1] !== a.lon) tr.push([a.lat, a.lon]);
      if (tr.length > trailMax) tr.splice(0, tr.length - trailMax);
      trails.set(a.hex, tr);
    }
    for (const hex of trails.keys()) if (!seen.has(hex)) trails.delete(hex);
  }

  function airportHtml(ap) {
    const code = ap.iata || ap.icao;
    const name = ap.city || ap.name;
    return `<span class="fl-ap"><b>${esc(code)}</b><small>${esc(name)}</small></span>`;
  }

  function renderSpot(a) {
    const head = spotEl.querySelector('.fl-head');
    const route = spotEl.querySelector('.fl-route');
    const stats = spotEl.querySelector('.fl-stats');
    if (!a) {
      spotEl.classList.add('empty');
      head.innerHTML = `<div class="fl-empty">${silhouette()}<div class="dim">${t('No aircraft nearby right now')}</div></div>`;
      route.innerHTML = '';
      stats.innerHTML = '';
      if (photoEl) photoEl.innerHTML = '';
      photoSrc = undefined;
      return;
    }
    spotEl.classList.remove('empty');
    const sub = [a.airline, a.desc || a.type, a.reg].filter(Boolean).map(esc).join(' · ');
    head.innerHTML = `<div class="fl-id"><div class="fl-cs">${esc(a.flight)}</div>${sub ? `<div class="fl-sub">${sub}</div>` : ''}</div><div class="fl-dist">${arrow(a.bearing)}<div><span class="fl-dnum">${u.distNum(a.dist)}</span> <span class="fl-dunit">${u.distUnit}</span><div class="fl-dir dim small">${t('direction {dir}', { dir: t(compass(a.bearing)) })}</div></div></div>`;
    const r = a.route;
    route.innerHTML = r ? `${airportHtml(r.from)}<span class="fl-route-line">${plane('currentColor', 90)}</span>${airportHtml(r.to)}${r.plausible === false ? '<span class="fl-unsure" title="?">?</span>' : ''}` : '';
    route.classList.toggle('unsure', r?.plausible === false);
    const vr = a.vrate ?? 0;
    const vdir = Math.abs(vr) < 200 ? 0 : Math.sign(vr);
    const cells = [
      [t('Altitude'), u.alt(a)],
      [t('Speed'), u.speed(a.speed)],
      [t('Heading'), a.track === null ? '–' : `${Math.round(a.track)}° ${t(compass(a.track))}`],
      [t('Vertical'), `${vIcon(vdir)} ${vdir ? u.vrate(vr) : t('level')}`],
      s.showSquawk && a.squawk && [t('Squawk'), esc(a.squawk)],
    ].filter(Boolean);
    stats.innerHTML = cells.map(([k, v]) => `<div class="fl-stat${k === t('Vertical') && vdir ? (vdir > 0 ? ' up' : ' down') : ''}"><div class="fl-k">${k}</div><div class="fl-v">${v}</div></div>`).join('') + (a.emergency ? `<div class="fl-emerg">${esc(a.emergency)}</div>` : '');
    if (photoEl) {
      const p = a.photo;
      const src = p ? p.src : '';
      if (src !== photoSrc) {
        photoSrc = src;
        photoEl.innerHTML = p
          ? `<img src="${esc(p.src)}" alt="" decoding="async"><figcaption><a href="${esc(p.link)}">© ${esc(p.photographer || '?')} / planespotters.net</a></figcaption>`
          : silhouette();
        const img = photoEl.querySelector('img');
        if (img) img.onerror = () => (photoEl.innerHTML = silhouette());
      }
    }
  }

  function updateSpot(a) {
    const hex = a ? a.hex : null;
    if (spotHex !== undefined && hex !== spotHex) {
      // Calm switch to another aircraft: short fade instead of a hard jump.
      spotHex = hex;
      spotEl.classList.add('switching');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        renderSpot(pending?.spotlight || null);
        spotEl.classList.remove('switching');
      }, 300);
      return;
    }
    spotHex = hex;
    renderSpot(a);
  }

  return {
    update(d) {
      pending = d;
      updateTrails(d);
      if (map) draw(d);
      else if (leafletReady) initMap(d.center);
      if (spotEl) updateSpot(d.spotlight || null);
      if (listEl) {
        const list = d.aircraft.filter((a) => !a.ground).slice(0, s.listCount);
        listEl.innerHTML = list.length
          ? `<table>${list
              .map((a) => `<tr><td><span class="ac-dot" style="background:${altColor(a)}"></span>${esc(a.flight)}</td><td class="dim small">${esc(a.type)}</td><td class="r">${u.alt(a)}</td><td class="r dim small">${u.speed(a.speed)}</td><td class="r dim small">${u.distNum(a.dist, 1)} ${u.distUnit}</td></tr>`)
              .join('')}</table>`
          : `<div class="dim small">${t('No aircraft in the air right now')}</div>`;
        listEl.insertAdjacentHTML('afterbegin', `<div class="dim small fl-count">${t('{n} aircraft within {r} km', { n: d.aircraft.length, r: s.radiusKm })} · ${t('Source')}: ${d.source === 'local' ? t('own receiver') : d.source === 'airplaneslive' ? 'airplanes.live' : 'adsb.lol'}</div>`);
      }
      // Safety net next to the ResizeObserver (which isn't delivered while the page is in the background).
      if (map) {
        const size = map.getSize();
        if (mapEl.clientWidth && (mapEl.clientWidth !== size.x || mapEl.clientHeight !== size.y)) relayout();
      }
    },
    show() {
      if (map) setTimeout(relayout, 50);
    },
    destroy() {
      clearTimeout(fadeTimer);
      resizeObs?.disconnect();
      wrap?.classList.remove('fl-flex', 'fl-grow', 'fl-shrink');
      if (map) map.remove();
    },
  };
}
