// News / RSS renderer: list of headlines or a single rotating ticker line.
import { esc } from '../renderers.js';

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  const ticker = s.style === 'ticker';
  let data = { items: [], errors: [] };
  let index = 0;
  let fadeTimer = null;
  let rtf = null;
  try { rtf = new Intl.RelativeTimeFormat(ctx.fmt.locale, { numeric: 'auto', style: 'short' }); } catch { /* old browser */ }

  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return t('just now');
    if (rtf && min < 60) return rtf.format(-min, 'minute');
    if (rtf && min < 12 * 60) return rtf.format(-Math.round(min / 60), 'hour');
    return `${ctx.fmt.dayLabel(ctx.fmt.dayKey(d))}, ${ctx.fmt.time(d)}`;
  };
  const meta = (it) => {
    const parts = [];
    if (s.showSource && it.source) parts.push(`<span class="news-src">${esc(it.source)}</span>`);
    if (s.showTime && it.date) parts.push(`<span class="news-time">${esc(when(it.date))}</span>`);
    return parts.join('<span class="news-sep"> · </span>');
  };
  const desc = (it) => (s.showDescription && it.description ? `<div class="news-desc dim small">${esc(it.description)}</div>` : '');
  const errors = () => (data.errors || []).map((x) => `<div class="err small">${esc(x)}</div>`).join('');

  const empty = () => `<div class="dim">${s.feeds?.length ? t('No headlines') : t('No feed set up')}</div>${errors()}`;

  const renderList = () => {
    if (!data.items.length) return (el.innerHTML = empty());
    el.innerHTML = `<div class="news-list">${data.items
      .map((it) => {
        const m = meta(it);
        return `<div class="news-item"><div class="news-title">${esc(it.title)}</div>${m ? `<div class="news-meta dim small">${m}</div>` : ''}${desc(it)}</div>`;
      })
      .join('')}</div>${errors()}`;
  };

  const tickerHtml = (it) => {
    const m = meta(it);
    return `${m ? `<span class="news-meta accent small">${m}</span>` : ''}<span class="news-title">${esc(it.title)}</span>${desc(it)}`;
  };
  const renderTicker = (animate) => {
    if (!data.items.length) return (el.innerHTML = empty());
    let box = el.querySelector('.news-ticker');
    if (!box) {
      el.innerHTML = '<div class="news-ticker"></div>';
      box = el.firstChild;
      animate = false;
    }
    const it = data.items[index % data.items.length];
    clearTimeout(fadeTimer);
    if (!animate) {
      box.classList.remove('fading');
      box.innerHTML = tickerHtml(it);
      return;
    }
    box.classList.add('fading');
    fadeTimer = setTimeout(() => {
      box.innerHTML = tickerHtml(it);
      box.classList.remove('fading');
    }, 600);
  };

  return {
    update(d) {
      const current = data.items[index % (data.items.length || 1)]?.title;
      data = { items: d?.items || [], errors: d?.errors || [] };
      if (ticker) {
        // Keep showing the same headline if it is still there.
        const i = data.items.findIndex((x) => x.title === current);
        index = i >= 0 ? i : 0;
        renderTicker(false);
      } else renderList();
    },
    tick() {
      if (ticker) {
        if (data.items.length < 2) return renderTicker(false);
        index = (index + 1) % data.items.length;
        renderTicker(true);
      } else if (data.items.length && s.showTime) renderList();
    },
    tickEvery: ticker ? s.intervalSeconds * 1000 : 60000,
    destroy() { clearTimeout(fadeTimer); },
  };
}
