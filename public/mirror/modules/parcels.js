import { esc } from '../renderers.js';

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const BOX = '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>';
const TRUCK = '<path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7"/><circle cx="6.5" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>';
const ICONS = {
  pre: svg(BOX),
  transit: svg(TRUCK),
  out: svg(TRUCK),
  pickup: svg('<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16v10.5H4zM9.5 20v-5h5v5"/>'),
  delivered: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.5"/>'),
  exception: svg('<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
  unknown: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M12 16.8v.1"/>'),
};
const LABELS = {
  pre: 'Announced',
  transit: 'In transit',
  out: 'Arriving today',
  pickup: 'Ready for pickup',
  delivered: 'Delivered',
  exception: 'Problem',
  unknown: 'Unknown',
};

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const fmt = ctx.fmt;
  const t = fmt.t;
  let last = null;

  const when = (iso) => {
    const d = new Date(iso);
    return `${fmt.dayLabel(fmt.dayKey(d))}, ${fmt.time(d)}`;
  };
  // Midnight (or 23:59) on both ends = only a date is known.
  const dateOnly = (d) => {
    const m = fmt.hourOf(d) * 60 + d.getUTCMinutes();
    return m === 0 || m >= 23 * 60 + 59;
  };

  // { day: "Tomorrow", span: "09:00–10:30" | "" } / { day: "Thu, 30 Oct – Sat, 1 Nov" }; null if past.
  function etaParts(eta) {
    if (!eta?.from) return null;
    const from = new Date(eta.from);
    const to = new Date(eta.to || eta.from);
    const today = fmt.dayKey(new Date());
    const kFrom = fmt.dayKey(from);
    const kTo = fmt.dayKey(to);
    if (fmt.keyDiff(today, kTo) < 0) return null;
    if (kFrom !== kTo) return { day: `${fmt.dayLabel(fmt.keyDiff(today, kFrom) < 0 ? today : kFrom)} – ${fmt.dayLabel(kTo)}`, span: '' };
    const span = dateOnly(from) && dateOnly(to) ? '' : to > from ? `${fmt.time(from)}–${fmt.time(to)}` : fmt.time(from);
    return { day: fmt.dayLabel(kFrom), span };
  }
  const etaText = (eta) => {
    const e = etaParts(eta);
    return e && (e.span ? `${e.day}, ${e.span}` : e.day);
  };

  function statusLine(p) {
    if (p.status === 'out') {
      const span = s.showEta ? etaParts(p.eta)?.span : '';
      return t('Arriving today') + (span ? ` · ${span}` : '');
    }
    if (p.status === 'delivered' && p.deliveredAt) return `${t('Delivered')} · ${fmt.dayLabel(fmt.dayKey(new Date(p.deliveredAt)))}`;
    return t(LABELS[p.status] || 'Unknown');
  }

  function itemList(p) {
    const sub = [];
    if (p.carrier) sub.push(esc(p.carrier));
    const eta = s.showEta && p.status !== 'out' && p.status !== 'delivered' ? etaText(p.eta) : null;
    if (eta) sub.push(`<span class="pc-eta">${esc(t('Expected: {when}', { when: eta }))}</span>`);
    let event = '';
    if (s.showEvent && (p.text || p.time)) {
      const bits = [p.text, p.location, p.time ? when(p.time) : ''].filter(Boolean).map(esc);
      event = `<div class="pc-event">${bits.join(' · ')}</div>`;
    }
    return `<li class="pc-item st-${p.status}">
      <span class="pc-icon">${ICONS[p.status] || ICONS.unknown}</span>
      <div class="pc-main">
        <div class="pc-head"><span class="pc-name">${esc(p.name)}</span><span class="pc-status">${esc(statusLine(p))}</span></div>
        ${sub.length ? `<div class="pc-sub">${sub.join(' · ')}</div>` : ''}${event}${p.error ? `<div class="pc-err">${esc(p.error)}</div>` : ''}
      </div>
    </li>`;
  }

  function itemCompact(p) {
    let right = statusLine(p);
    if (s.showEta && p.status !== 'out' && p.status !== 'delivered') {
      const eta = etaText(p.eta);
      if (eta) right = eta;
    }
    return `<li class="pc-item st-${p.status}${p.error ? ' has-err' : ''}">
      <span class="pc-icon">${ICONS[p.status] || ICONS.unknown}</span>
      <span class="pc-name">${esc(p.name)}</span><span class="pc-status">${esc(right)}</span>
    </li>`;
  }

  function draw() {
    const d = last;
    if (!d) return;
    if (!d.parcels.length) {
      el.innerHTML = `<div class="dim">${esc(d.total ? t('All parcels delivered') : t('No parcels'))}</div>`;
      return;
    }
    const compact = s.layout === 'compact';
    el.innerHTML = `<ul class="pc-list ${compact ? 'pc-compact' : 'pc-full'}">${d.parcels.map(compact ? itemCompact : itemList).join('')}</ul>`;
  }

  return {
    update(d) {
      last = d;
      draw();
    },
    // "Today"/"Tomorrow" labels move on at midnight.
    tick: draw,
    tickEvery: 15 * 60 * 1000,
  };
}
