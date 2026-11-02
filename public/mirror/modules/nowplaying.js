// Now playing renderer: cover, title, artist and a progress bar that moves on locally
// between the server updates. The module hides itself while nothing plays.
import { esc } from '../renderers.js';
import { calIcons } from '../icons.js';

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  let item = null;
  let key = '';

  const pos = () => {
    if (!item || item.position === null) return null;
    const moved = item.playing ? (Date.now() - Date.parse(item.positionAt)) / 1000 : 0;
    return Math.min(item.duration || Infinity, item.position + Math.max(0, moved));
  };

  const progress = () => {
    const bar = el.querySelector('.np-bar i');
    const time = el.querySelector('.np-time');
    const p = pos();
    if (!bar || p === null || !item.duration) return;
    bar.style.width = `${Math.min(100, (p / item.duration) * 100).toFixed(2)}%`;
    if (time) time.textContent = `${mmss(p)} / ${mmss(item.duration)}`;
  };

  return {
    update(d) {
      const wrap = el.closest('.module');
      if (d.needsSetup) {
        wrap?.classList.remove('empty');
        el.innerHTML = `<div class="dim small">${esc(t(s.source === 'spotify' ? 'Connect Spotify in the module settings.' : 'Enter a media player in the module settings.'))}</div>`;
        return;
      }
      item = d.item || null;
      wrap?.classList.toggle('empty', !item);
      if (!item) {
        el.innerHTML = '';
        key = '';
        return;
      }
      // only rebuild when the track changes; the bar moves on in tick()
      const k = JSON.stringify([item.title, item.artist, item.cover, item.playing, item.device]);
      if (k !== key) {
        key = k;
        const cover = s.showCover !== false && item.cover
          ? `<img class="np-cover" src="${esc(item.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
          : `<span class="np-cover np-placeholder">${calIcons.music}</span>`;
        const meta = [item.artist, s.showDevice && item.device ? item.device : ''].filter(Boolean).map(esc).join(' · ');
        el.innerHTML = `<div class="np${item.playing ? '' : ' paused'}">${cover}<div class="np-text">`
          + `<div class="np-title">${esc(item.title)}</div>${meta ? `<div class="np-artist">${meta}</div>` : ''}`
          + (s.showProgress !== false && item.duration ? '<div class="np-bar"><i></i></div><div class="np-time"></div>' : '')
          + `${item.playing ? '' : `<div class="np-state">${esc(t('Paused'))}</div>`}</div></div>`;
      }
      progress();
    },
    tick: progress,
    tickEvery: 1000,
    // faster while something plays (track changes), slower when idle
    refreshSeconds: () => (item?.playing ? 10 : 30),
  };
}
