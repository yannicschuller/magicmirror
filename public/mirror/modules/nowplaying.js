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
  // One cover element for the module's lifetime: a new cover is loaded in the background
  // and swapped in once decoded, so a track change or rebuild never shows an empty or
  // white box (WebKit paints a not-yet-decoded image as a light rectangle).
  const coverImg = document.createElement('img');
  coverImg.className = 'np-cover';
  coverImg.alt = '';
  coverImg.referrerPolicy = 'no-referrer';
  let coverSrc = '';
  let coverWanted = '';
  const setCover = (src) => {
    if (src === coverWanted) return;
    coverWanted = src;
    const pre = new Image();
    pre.referrerPolicy = 'no-referrer';
    pre.onload = () => {
      if (coverWanted !== src) return;
      (pre.decode ? pre.decode() : Promise.resolve()).catch(() => {}).then(() => {
        if (coverWanted !== src) return;
        coverImg.src = src;
        coverSrc = src;
        coverImg.hidden = false;
      });
    };
    pre.onerror = () => {
      if (coverWanted === src) coverImg.hidden = true;
    };
    pre.src = src;
  };

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
      const withCover = s.showCover !== false && Boolean(item.cover);
      const k = JSON.stringify([item.title, item.artist, withCover, item.playing, item.device]);
      if (withCover) setCover(item.cover);
      if (k !== key) {
        key = k;
        const cover = withCover ? '<span class="np-cover-slot"></span>' : `<span class="np-cover np-placeholder">${calIcons.music}</span>`;
        const meta = [item.artist, s.showDevice && item.device ? item.device : ''].filter(Boolean).map(esc).join(' · ');
        el.innerHTML = `<div class="np${item.playing ? '' : ' paused'}">${cover}<div class="np-text">`
          + `<div class="np-title">${esc(item.title)}</div>${meta ? `<div class="np-artist">${meta}</div>` : ''}`
          + (s.showProgress !== false && item.duration ? '<div class="np-bar"><i></i></div><div class="np-time"></div>' : '')
          + `${item.playing ? '' : `<div class="np-state">${esc(t('Paused'))}</div>`}</div></div>`;
        // the same (already decoded) element moves into the new markup
        if (withCover) {
          if (!coverSrc) coverImg.hidden = true;
          el.querySelector('.np-cover-slot')?.replaceWith(coverImg);
        }
      }
      progress();
    },
    tick: progress,
    tickEvery: 1000,
    // faster while something plays (track changes), slower when idle
    refreshSeconds: () => (item?.playing ? 10 : 30),
  };
}
