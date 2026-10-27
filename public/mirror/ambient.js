// Animated full-page background with the current weather (page option "ambient").
// CSS animations on transform/opacity only (GPU friendly on a Raspberry Pi 3);
// the element count is fixed per effect and level.
//   ?ambient=rain|drizzle|snow|thunder|fog|cloudy|partly|clear|night forces an effect (testing).

const layer = document.getElementById('ambient');
const forced = new URLSearchParams(location.search).get('ambient');
let mode = 'off';
let weather = null;
let fetchTimer = null;
let drawn = '';

const rand = (a, b) => a + Math.random() * (b - a);
const COUNTS = {
  rain: { subtle: 28, full: 70 },
  drizzle: { subtle: 22, full: 50 },
  snow: { subtle: 26, full: 60 },
  stars: { subtle: 30, full: 70 },
};

function drops(n, cls, { dur = [0.7, 1.2], tilt = 0 } = {}) {
  let html = '';
  for (let i = 0; i < n; i++) {
    const style = `left:${rand(-5, 105).toFixed(1)}%;animation-duration:${rand(...dur).toFixed(2)}s;animation-delay:-${rand(0, 3).toFixed(2)}s;--tilt:${tilt}deg;--dx:${(tilt * -1.4).toFixed(1)}vh;--len:${rand(0.6, 1.2).toFixed(2)}`;
    html += `<i class="${cls}" style="${style}"></i>`;
  }
  return html;
}

function flakes(n) {
  let html = '';
  for (let i = 0; i < n; i++) {
    const size = rand(0.35, 0.95).toFixed(2);
    html += `<i class="amb-flake" style="left:${rand(0, 100).toFixed(1)}%;width:${size}vmin;height:${size}vmin;animation-duration:${rand(8, 16).toFixed(1)}s,${rand(2.5, 5).toFixed(1)}s;animation-delay:-${rand(0, 16).toFixed(1)}s,-${rand(0, 5).toFixed(1)}s"></i>`;
  }
  return html;
}

function stars(n) {
  let html = '';
  for (let i = 0; i < n; i++) {
    const size = rand(0.12, 0.35).toFixed(2);
    html += `<i class="amb-star" style="left:${rand(0, 100).toFixed(1)}%;top:${rand(0, 70).toFixed(1)}%;width:${size}vmin;height:${size}vmin;animation-duration:${rand(2.5, 6).toFixed(1)}s;animation-delay:-${rand(0, 6).toFixed(1)}s"></i>`;
  }
  return `${html}<i class="amb-shooting"></i>`;
}

function clouds(n, dark = false) {
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<i class="amb-cloud${dark ? ' dark' : ''}" style="top:${rand(-10, 45).toFixed(0)}%;animation-duration:${rand(90, 160).toFixed(0)}s;animation-delay:-${rand(0, 160).toFixed(0)}s;--s:${rand(0.8, 1.6).toFixed(2)}"></i>`;
  }
  return html;
}

function effect(kind, level, w) {
  const tilt = w && w.wind > 25 ? -Math.min(25, (w.wind - 15) * 0.8) : 0;
  const heavy = w?.intensity === 'heavy' ? 1.6 : w?.intensity === 'moderate' ? 1.2 : 1;
  const count = (k) => Math.round(COUNTS[k][level] * (k === 'rain' || k === 'snow' ? heavy : 1));
  switch (kind) {
    case 'thunder':
      return `${clouds(level === 'full' ? 4 : 2, true)}${drops(count('rain'), 'amb-drop', { dur: [0.5, 0.8], tilt })}<i class="amb-flash"></i>`;
    case 'rain':
      return `${level === 'full' ? clouds(3, true) : ''}${drops(count('rain'), 'amb-drop', { dur: [0.55, 0.95], tilt })}`;
    case 'drizzle':
      return drops(count('drizzle'), 'amb-drop light', { dur: [0.9, 1.5], tilt: tilt / 2 });
    case 'snow':
      return flakes(count('snow'));
    case 'fog':
      return '<i class="amb-fog"></i><i class="amb-fog b"></i>';
    case 'cloudy':
      return clouds(level === 'full' ? 6 : 3);
    case 'partly':
      return `${w?.isDay === false ? stars(Math.round(count('stars') / 2)) : '<i class="amb-sun"></i>'}${clouds(level === 'full' ? 3 : 2)}`;
    case 'night':
      return stars(count('stars'));
    case 'clear':
    default:
      return w?.isDay === false ? stars(count('stars')) : '<i class="amb-sun"></i>';
  }
}

function render() {
  if (mode === 'off' || (!weather && !forced)) {
    if (drawn) layer.innerHTML = drawn = '';
    layer.className = '';
    return;
  }
  const kind = forced || weather.kind;
  const key = `${mode}:${kind}:${weather?.isDay}:${weather?.intensity}`;
  layer.className = `amb-${mode} amb-kind-${kind}`;
  if (key === drawn) return;
  drawn = key;
  layer.innerHTML = effect(kind, mode, weather);
}

async function load() {
  clearTimeout(fetchTimer);
  try {
    const res = await fetch('/api/ambient', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) weather = json;
  } catch (err) {
    console.warn('[ambient]', err.message);
  }
  render();
  if (mode !== 'off') fetchTimer = setTimeout(load, 10 * 60 * 1000);
}

// Called by the mirror when a page is shown.
export function setAmbient(next) {
  const was = mode;
  // ?ambient=… previews an effect even on pages where it is off.
  mode = next && next !== 'off' ? next : forced ? 'full' : 'off';
  if (mode !== 'off' && (was === 'off' || !weather)) load();
  else render();
}
