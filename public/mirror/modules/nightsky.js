// "Night sky & ISS" renderer – data comes from src/providers/nightsky.js; the
// minute tick only re-formats countdowns ("in 2 h 13 min", "now visible").
import { esc, num, countdown } from '../renderers.js';

const MIN = 60000;

// Direction of the ISS right now from the coarse track ([sec, az, el], …).
function currentLook(pass, now) {
  const tr = pass.track;
  if (!tr?.length) return { dir: pass.maxDir, el: pass.maxEl };
  const sec = (now - Date.parse(pass.start)) / 1000;
  let best = tr[0];
  for (const p of tr) if (Math.abs(p[0] - sec) < Math.abs(best[0] - sec)) best = p;
  const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return { dir: COMPASS[Math.round((((best[1] % 360) + 360) % 360) / 45) % 8], el: best[2] };
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t, dayKey, dayLabel, time } = ctx.fmt;
  let data = null;

  const when = (iso) => {
    const d = new Date(iso);
    return `${dayLabel(dayKey(d))} ${time(d)}`;
  };
  const until = (ms) => (ms <= MIN ? t('now') : t('in {time}', { time: countdown(ms) }));
  const deg = (v) => `${num(v)}°`;
  const tonightOf = (p) => data.night && p.start >= data.night.start && p.start < data.night.end;

  const passRow = (p, now) => {
    const start = Date.parse(p.start);
    const mins = Math.max(1, Math.round(p.duration / 60));
    const path = [
      `${esc(t(p.startDir))} → ${esc(t(p.endDir))}`,
      esc(t('max. {el}', { el: deg(p.maxEl) })),
      esc(t('{m} min', { m: mins })),
      p.visible ? esc(t(p.brightness)) : esc(t('not visible')),
    ].join(' · ');
    const cls = ['ns-pass', p.visible ? '' : 'ns-invisible', p.visible && tonightOf(p) ? 'ns-tonight' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}"><div class="ns-line"><span class="ns-when">${esc(when(p.start))}</span> <span class="ns-in">${esc(until(start - now))}</span></div><div class="ns-path">${path}</div></div>`;
  };

  // "Now visible – look NW" while a visible pass is running.
  const banner = (passes, now) => {
    const p = passes.find((x) => x.visible && Date.parse(x.start) <= now && Date.parse(x.end) >= now);
    if (!p) return '';
    const look = currentLook(p, now);
    return `<div class="ns-now">${esc(t('ISS now visible – look {dir}', { dir: t(look.dir) }))} <span class="ns-now-el">${esc(deg(look.el))}</span></div>`;
  };

  const issBlock = (passes, now) => {
    if (data.iss.error) return `<div class="ns-note">${esc(data.iss.error)}</div>`;
    if (!passes.length) {
      return `<div class="ns-note">${esc(t(s.onlyVisible === false ? 'No ISS passes in the next {n} days' : 'No visible ISS passes in the next {n} days', { n: data.iss.days }))}</div>`;
    }
    return passes.map((p) => passRow(p, now)).join('');
  };

  const planetRows = () => {
    if (!data.night) return `<div class="ns-note">${esc(t('The sky does not get dark tonight'))}</div>`;
    if (!data.planets.length) return `<div class="ns-note">${esc(t('No bright planets visible tonight'))}</div>`;
    return `<table class="ns-table">${data.planets
      .map((p) => `<tr><td class="ns-name">${esc(t(p.name))}</td><td class="ns-time">${esc(time(new Date(p.best)))}</td><td class="ns-dir">${esc(t(p.dir))} ${esc(deg(p.alt))}</td></tr>`)
      .join('')}</table>`;
  };

  const moonText = () => {
    const m = data.moon;
    const parts = [t('{p} % illuminated', { p: num(m.fraction * 100) })];
    const times = [m.rise && ['↑', m.rise], m.set && ['↓', m.set]].filter(Boolean).sort((a, b) => a[1].localeCompare(b[1]));
    for (const [arrow, iso] of times) parts.push(`${arrow} ${time(new Date(iso))}`);
    return parts.map(esc).join(' · ');
  };

  const eventText = (e) => {
    if (e.type === 'conjunction') {
      return `<span class="ns-ev-when">${esc(when(e.at))}</span> ${esc(t('{a} and {b} {sep} apart', { a: t(e.a), b: t(e.b), sep: `${num(e.sep, 1)}°` }))} <span class="ns-sub">${esc(t(e.dir))}</span>`;
    }
    const moon = e.moon >= 0.5 ? ` · ${t('moon {p} %', { p: num(e.moon * 100) })}` : '';
    return `<span class="ns-ev-when">${esc(dayLabel(e.peak))}</span> ${esc(t('{name} peak', { name: t(e.name) }))} <span class="ns-sub">${esc(t('up to {zhr}/h', { zhr: e.zhr }) + moon)}</span>`;
  };

  const list = (passes, now) => {
    let html = banner(passes, now);
    html += `<div class="ns-sec"><div class="ns-head">${esc(t('ISS passes'))}</div>${issBlock(passes, now)}</div>`;
    if (data.planets || data.moon) {
      html += `<div class="ns-sec"><div class="ns-head">${esc(t('Tonight'))}</div>`;
      if (data.planets) html += planetRows();
      if (data.moon) html += `<div class="ns-moon"><span class="ns-name">${esc(t('Moon'))}</span> <span class="ns-sub">${moonText()}</span></div>`;
      html += '</div>';
    }
    if (data.events?.length) {
      html += `<div class="ns-sec"><div class="ns-head">${esc(t('Sky events'))}</div>${data.events.slice(0, 4).map((e) => `<div class="ns-ev">${eventText(e)}</div>`).join('')}</div>`;
    }
    return html;
  };

  const compact = (passes, now) => {
    let html = banner(passes, now);
    const next = passes.find((p) => p.visible && Date.parse(p.start) > now) || passes.find((p) => Date.parse(p.start) > now);
    let iss;
    if (data.iss.error) iss = `<span class="ns-sub">${esc(data.iss.error)}</span>`;
    else if (!next) iss = `<span class="ns-sub">${esc(t('no visible pass'))}</span>`;
    else {
      iss = `<span class="ns-when${tonightOf(next) && next.visible ? ' ns-tonight' : ''}">${esc(when(next.start))}</span> <span class="ns-in">${esc(until(Date.parse(next.start) - now))}</span> <span class="ns-sub">${esc(`${t(next.startDir)} → ${t(next.endDir)} · ${deg(next.maxEl)}`)}</span>`;
    }
    html += `<div class="ns-row"><span class="ns-lbl">${esc(t('ISS'))}</span> ${iss}</div>`;
    if (data.planets?.length) html += `<div class="ns-row"><span class="ns-lbl">${esc(t('Planets'))}</span> ${data.planets.map((p) => esc(t(p.name))).join(' · ')}</div>`;
    if (data.moon) html += `<div class="ns-row"><span class="ns-lbl">${esc(t('Moon'))}</span> <span class="ns-sub">${moonText()}</span></div>`;
    if (data.events?.length) html += `<div class="ns-row ns-ev">${eventText(data.events[0])}</div>`;
    return html;
  };

  const draw = () => {
    if (!data) return;
    const now = Date.now();
    const passes = (data.iss.passes || []).filter((p) => Date.parse(p.end) > now);
    const layout = s.layout === 'compact' ? 'compact' : 'list';
    el.innerHTML = `<div class="ns ns-${layout}">${layout === 'compact' ? compact(passes, now) : list(passes, now)}</div>`;
  };

  return {
    update(d) {
      data = d;
      draw();
    },
    tick: draw,
    tickEvery: MIN,
  };
}
