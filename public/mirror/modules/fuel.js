import { esc, num } from '../renderers.js';

const LABELS = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };
const SHORT = { e5: 'E5', e10: 'E10', diesel: 'Diesel' };

// 1.779 → "1,77" + superscript "9" (German petrol-station style).
export function priceHtml(p) {
  if (p === null || p === undefined) return '<span class="fuel-none">–</span>';
  const s = num(p, 3);
  return `${s.slice(0, -1)}<sup>${s.slice(-1)}</sup>`;
}

// Colour hint relative to the cheapest open station for that fuel type.
export function priceLevel(p, best) {
  if (p === null || p === undefined || !best) return '';
  const d = p - best.price;
  if (d < 0.0005) return 'best';
  if (d <= 0.03) return 'ok';
  if (d <= 0.08) return 'mid';
  return 'high';
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const t = ctx.fmt.t;
  return {
    update(d) {
      const types = d.fuelTypes;
      const attribution = `<div class="fuel-attr">${esc(t('Data: MTS-K / Tankerkönig (CC BY 4.0)'))}</div>`;
      if (!d.stations.length) {
        const msg = d.mode === 'stations' && !(s.stations || []).length ? t('No stations selected') : t('No petrol stations found');
        el.innerHTML = `<div class="dim">${esc(msg)}</div>${attribution}`;
        return;
      }
      const head =
        types.length > 1
          ? `<div class="fuel-row fuel-head"><span></span>${types.map((k) => `<span class="fuel-type">${esc(SHORT[k])}</span>`).join('')}</div>`
          : `<div class="fuel-row fuel-head"><span></span><span class="fuel-type">${esc(LABELS[types[0]])}</span></div>`;
      const rows = d.stations
        .map((st) => {
          const title = st.custom ? st.name : st.brand || st.name;
          const sub = [];
          if (!st.open) sub.push(`<span class="fuel-closed">${esc(t('closed'))}</span>`);
          if (s.showAddress) {
            if (st.street) sub.push(esc(st.street));
            if (st.dist !== null && st.dist !== undefined) sub.push(`${num(st.dist, 1)} km`);
          }
          const cells = types
            .map((k) => {
              const p = st.prices[k];
              const lvl = st.open && s.highlightCheapest ? priceLevel(p, d.cheapest[k]) : '';
              return `<span class="fuel-p${lvl ? ` lvl-${lvl}` : ''}">${priceHtml(p)}</span>`;
            })
            .join('');
          return `<div class="fuel-row${st.open ? '' : ' closed'}"><div class="fuel-st"><div class="fuel-name">${esc(title)}</div>${sub.length ? `<div class="fuel-sub">${sub.join(' · ')}</div>` : ''}</div>${cells}</div>`;
        })
        .join('');
      el.innerHTML = `<div class="fuel" style="--n:${types.length}">${head}${rows}</div>${attribution}`;
    },
  };
}
