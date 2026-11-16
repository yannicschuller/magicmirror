// Service status renderer: a summary line, then the services with a coloured dot, response
// time and a small history; incidents below.
import { esc, num } from '../renderers.js';
import { icons } from '../icons.js';

const LABEL = { up: 'Running', degraded: 'Degraded', down: 'Down', maintenance: 'Maintenance', pending: 'Pending', unknown: 'Unknown' };
const ORDER = { down: 0, degraded: 1, pending: 2, maintenance: 3, unknown: 4, up: 5 };

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  const ago = (iso) => {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return '';
    const m = Math.floor(ms / 60000);
    if (m < 60) return t('for {n} min', { n: Math.max(1, m) });
    const h = Math.floor(m / 60);
    if (h < 48) return t('for {n} h', { n: h });
    return t('for {n} days', { n: Math.floor(h / 24) });
  };

  const summary = (d) => {
    const ok = d.problems === 0;
    const text = ok
      ? (d.total === 1 ? t('Service running') : t('All {n} services running', { n: d.total }))
      : t('{p} of {n} with problems', { p: d.problems, n: d.total });
    return `<div class="st-summary ${ok ? 'ok' : 'bad'}"><span class="st-dot st-${ok ? 'up' : d.services.some((x) => x.status === 'down') ? 'down' : 'degraded'}"></span>${esc(text)}</div>`;
  };

  // a history needs a few points to say something
  const history = (h) => (s.showHistory !== false && h?.length >= 3 ? `<span class="st-hist">${h.map((x) => `<i class="st-${x}"></i>`).join('')}</span>` : '');

  const row = (x) => {
    const right = [];
    if (x.status === 'up' && s.showLatency !== false && Number.isFinite(x.latency)) right.push(`${num(x.latency)} ms`);
    if (x.status !== 'up') right.push(`<span class="st-state st-${x.status}">${esc(t(LABEL[x.status]))}</span>`);
    const sub = [];
    if (x.status !== 'up' && x.since) sub.push(ago(x.since));
    if (x.status !== 'up' && x.message) sub.push(x.message);
    if (s.showUptime && Number.isFinite(x.uptime)) sub.push(`${num(x.uptime * 100, x.uptime >= 0.9995 ? 0 : 2)} %`);
    return `<li class="st-row st-${x.status}"><span class="st-dot st-${x.status}"></span><div class="st-main"><div class="st-line"><span class="st-name">${esc(x.name)}</span><span class="st-r">${right.join(' ')}</span></div>${sub.length ? `<div class="st-sub">${sub.map(esc).join(' · ')}</div>` : ''}${history(x.history)}</div></li>`;
  };

  return {
    update(d) {
      const wrap = el.closest('.module');
      wrap?.classList.remove('empty');
      if (d.needsSetup) {
        el.innerHTML = `<div class="dim small">${esc(t('Enter the address in the module settings.'))}</div>`;
        return;
      }
      const services = [...(d.services || [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
      const shown = s.onlyProblems ? services.filter((x) => x.status !== 'up') : services;
      const incidents = s.showIncidents !== false && d.incidents?.length
        ? `<ul class="st-incidents">${d.incidents.map((i) => `<li class="st-${i.status}"><span class="st-inc-ico">${i.status === 'maintenance' ? icons.clockSmall || icons.warning : icons.warning}</span>${esc(i.title)}</li>`).join('')}</ul>`
        : '';
      let body;
      if (s.layout === 'summary' || (s.onlyProblems && !shown.length)) body = summary(d);
      else {
        // the original order of the source stays for a list without problems
        const ordered = d.problems ? shown : s.onlyProblems ? shown : d.services;
        body = (s.onlyProblems ? summary(d) : '') + `<ul class="st-list${s.layout === 'grid' ? ' st-grid' : ''}">${ordered.map(row).join('')}</ul>`;
      }
      el.innerHTML = `<div class="st">${body}${incidents}</div>`;
    },
  };
}
