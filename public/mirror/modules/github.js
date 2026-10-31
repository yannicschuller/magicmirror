// GitHub tracker renderer. Every section is optional; the HTML is only
// replaced when it actually changed (ticks update ages and elapsed times).
import { esc, num } from '../renderers.js';

const svg = (d, cls = '') => `<svg class="gh-i${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const RING = '<circle cx="12" cy="12" r="8.5"/>';
export const ICONS = {
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  fork: svg('<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v1a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 11v6"/>'),
  pr: svg('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4m2-2-2 2 2 2"/>'),
  merge: svg('<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="13" r="2"/><path d="M6 7v10M6 7c0 3.5 3 6 10 6"/>'),
  issue: svg(`${RING}<circle cx="12" cy="12" r="1.4" fill="currentColor"/>`),
  commit: svg('<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>'),
  tag: svg('<path d="M3.5 12.5V4h8.5l8.5 8.5-8 8z"/><circle cx="8" cy="8" r="1.3"/>'),
  success: svg(`${RING}<path d="m8.3 12.3 2.6 2.6 4.9-5.3"/>`),
  failure: svg(`${RING}<path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>`),
  running: svg(`${RING}<path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>`),
  queued: svg(`${RING}<path d="M12 7.5V12l3 2"/>`),
  cancelled: svg(`${RING}<path d="M6 18 18 6"/>`),
  skipped: svg(`${RING}<path d="M8.5 12h7"/>`),
  action: svg(`${RING}<path d="M12 7.5v5M12 16v.1"/>`),
  shield: svg('<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/>'),
  user: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-5.5 7-5.5s6 1.5 7 5.5"/>'),
  comment: svg('<path d="M4 5h16v11H9.5L5 20v-4H4z"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  pulse: svg('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  flame: svg('<path d="M12 3c.8 3.5 5 5.3 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.6 2-5.4.9 1.4 1.8 2 2.8 2.1C11 7 11.6 5 12 3z"/>'),
  repo: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/>'),
};
const BUILD_LABELS = { running: 'Running', queued: 'Queued', success: 'Passed', failure: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped', action: 'Action required' };
const REVIEW_LABELS = { required: 'Review required', approved: 'Approved', changes: 'Changes requested' };
const CHECK_LABELS = { success: 'Checks passed', failure: 'Checks failed', pending: 'Checks running' };

// Star history as a small polyline (null = no snapshot yet).
export function sparkline(values, w = 120, h = 18) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  if (pts.length < 2) return '';
  const vs = pts.map(([, v]) => v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const n = values.length - 1 || 1;
  const p = pts.map(([i, v]) => `${((i / n) * w).toFixed(1)},${(h - 1.5 - ((v - min) / span) * (h - 3)).toFixed(1)}`).join(' ');
  return `<svg class="gh-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${p}"/></svg>`;
}

// Contribution calendar: weeks as columns, Sunday on top.
export function contribSvg(c, cell = 9, gap = 2) {
  const step = cell + gap;
  let rects = '';
  c.weeks.forEach((w, x) => {
    const off = x === 0 ? c.offset || 0 : 0;
    for (let d = 0; d < w.length; d++) rects += `<rect x="${x * step}" y="${(d + off) * step}" width="${cell}" height="${cell}" rx="2" class="l${w[d]}"/>`;
  });
  const wd = c.weeks.length * step - gap;
  const ht = 7 * step - gap;
  return `<svg class="gh-cal" viewBox="0 0 ${wd} ${ht}" width="${wd}" height="${ht}" aria-hidden="true">${rects}</svg>`;
}

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  const compact = s.layout === 'compact';
  let last = null;
  let lastHtml = '';

  const age = (iso) => {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return t('just now');
    if (m < 60) return t('{n} min ago', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t('{n} h ago', { n: h });
    const d = Math.floor(h / 24);
    if (d < 14) return t('{n} d ago', { n: d });
    if (d < 60) return t('{n} wk ago', { n: Math.floor(d / 7) });
    if (d < 365) return t('{n} mo ago', { n: Math.floor(d / 30) });
    return t('{n} y ago', { n: Math.floor(d / 365) });
  };
  const dur = (sec) => {
    if (sec === null || sec === undefined || !Number.isFinite(sec)) return '';
    if (sec < 60) return t('{n} s', { n: Math.max(0, Math.round(sec)) });
    const m = Math.floor(sec / 60);
    if (m < 60) return t('{m} min {s} s', { m, s: Math.round(sec % 60) });
    return t('{h} h {m} min', { h: Math.floor(m / 60), m: m % 60 });
  };
  const elapsed = (iso) => dur((Date.now() - Date.parse(iso)) / 1000);
  const big = (n) => (n >= 10000 ? `${num(n / 1000, n >= 100000 ? 0 : 1)}k` : String(n ?? '–'));

  const head = (icon, title, extra = '') => `<div class="gh-h">${ICONS[icon]}<span class="gh-ht">${esc(title)}</span>${extra ? `<span class="gh-hx">${extra}</span>` : ''}</div>`;
  const errLine = (d, key) => (d.errors?.[key] ? `<div class="gh-err">${esc(d.errors[key])}</div>` : '');
  const sec = (key, html) => `<section class="gh-sec gh-${key}">${html}</section>`;
  const row = (icon, main, right = '', sub = '', cls = '') => `<li class="gh-row${cls ? ` ${cls}` : ''}">${icon ? `<span class="gh-ic">${icon}</span>` : ''}<div class="gh-main"><div class="gh-line"><span class="gh-t">${main}</span>${right ? `<span class="gh-r">${right}</span>` : ''}</div>${sub && !compact ? `<div class="gh-sub">${sub}</div>` : ''}</div></li>`;
  const list = (rows) => `<ul class="gh-list">${rows.join('')}</ul>`;
  const stat = (icon, value, title) => `<span class="gh-stat" title="${esc(title)}">${ICONS[icon]}${value}</span>`;

  function overview(d) {
    if (!d.overview?.length && !d.errors?.overview) return '';
    if (!s.showOverview) {
      // Star history only.
      const rows = (d.overview || []).filter((r) => r.series).map((r) => row('', esc(r.name), `${sparkline(r.series)}<span class="gh-num">${esc(big(r.stars))}</span>`));
      return rows.length || d.errors?.overview ? sec('overview', head('star', t('Star history')) + errLine(d, 'overview') + list(rows)) : '';
    }
    const rows = (d.overview || []).map((r) => {
      const delta = r.delta ? `<span class="gh-delta">+${esc(r.delta)}</span>` : '';
      const stats = [
        stat('star', `${esc(big(r.stars))}${delta}`, t('Stars')),
        stat('fork', esc(big(r.forks)), t('Forks')),
        stat('issue', esc(big(r.issues)), r.prs === null || r.prs === undefined ? t('Open issues and pull requests') : t('Open issues')),
      ];
      if (r.prs !== null && r.prs !== undefined) stats.push(stat('pr', esc(big(r.prs)), t('Open pull requests')));
      const pushed = r.pushedAt ? t('Pushed {age}', { age: age(r.pushedAt) }) : '';
      const sub = [pushed && esc(pushed), r.archived ? esc(t('Archived')) : ''].filter(Boolean).join(' · ');
      const spark = !compact && r.series ? sparkline(r.series) : '';
      return `<li class="gh-repo">
        <div class="gh-line"><span class="gh-t gh-name">${esc(r.name)}</span><span class="gh-stats">${stats.join('')}</span></div>
        ${compact ? '' : `<div class="gh-sub gh-repo-sub"><span>${sub}</span>${spark}</div>`}
      </li>`;
    });
    const errs = d.repoErrors ? Object.entries(d.repoErrors).map(([k, v]) => `<div class="gh-err">${esc(k)}: ${esc(v)}</div>`).join('') : '';
    return sec('overview', head('repo', t('Repositories')) + errLine(d, 'overview') + list(rows) + errs);
  }

  function active(d) {
    if (!s.showRunning || !d.active?.length) return '';
    const rows = d.active.map((a) => {
      const running = a.status === 'running';
      const right = running && a.startedAt ? esc(elapsed(a.startedAt)) : esc(t(BUILD_LABELS[a.status] || 'Queued'));
      const sub = [esc(a.repo), a.branch ? esc(a.branch) : ''];
      if (a.jobsTotal) sub.push(esc(t('Job {done}/{total}', { done: Math.min(a.jobsDone + (running ? 1 : 0), a.jobsTotal), total: a.jobsTotal })));
      if (a.current) sub.push(esc(a.current));
      const pct = a.stepsTotal ? Math.round((a.stepsDone / a.stepsTotal) * 100) : null;
      const bar = pct !== null ? `<div class="gh-bar"><span style="width:${pct}%"></span></div>` : '';
      return row(ICONS[a.status] || ICONS.queued, esc(a.workflow), right, sub.filter(Boolean).join(' · ') + bar, `st-${a.status}`);
    });
    return sec('active', head('running', t('Running workflows')) + list(rows));
  }

  function builds(d) {
    if (!s.showBuilds || (!d.builds?.length && !d.errors?.builds)) return '';
    const multi = new Set((d.builds || []).map((b) => b.repo)).size > 1;
    const rows = (d.builds || []).map((b) => {
      const label = esc(t(BUILD_LABELS[b.status] || 'Skipped'));
      const time = b.status === 'running' && b.startedAt ? elapsed(b.startedAt) : dur(b.duration);
      const right = compact ? (b.startedAt ? esc(age(b.startedAt)) : label) : [label, time && esc(time)].filter(Boolean).join(' · ');
      const main = multi ? `<span class="gh-dim">${esc(b.repo)} ·</span> ${esc(b.workflow)}` : esc(b.workflow);
      const sub = [b.branch && esc(b.branch), b.startedAt && esc(age(b.startedAt))].filter(Boolean).join(' · ');
      return row(ICONS[b.status] || ICONS.skipped, main, right, sub, `st-${b.status}`);
    });
    const failed = d.failedBuilds ? `<span class="gh-bad">${esc(t('{n} failed', { n: d.failedBuilds }))}</span>` : '';
    return sec('builds', head('success', t('Builds'), failed) + errLine(d, 'builds') + list(rows));
  }

  function releases(d) {
    if (!d.releases?.length && !d.errors?.releases) return '';
    const days = d.releaseNewDays ?? 7;
    const rows = (d.releases || []).map((r) => {
      const isNew = days > 0 && Date.now() - Date.parse(r.at) < days * 86400000;
      const badges = [isNew ? `<span class="gh-badge gh-new">${esc(t('New'))}</span>` : '', r.pre ? `<span class="gh-badge">${esc(t('Pre-release'))}</span>` : ''].join('');
      const main = `<span class="gh-dim">${esc(r.repo)}</span> <span class="gh-tag">${esc(r.tag)}</span>${badges}`;
      return row(ICONS.tag, main, esc(age(r.at)), r.name ? esc(r.name) : '', isNew ? 'is-new' : '');
    });
    return sec('releases', head('tag', t('Releases')) + errLine(d, 'releases') + list(rows));
  }

  function commits(d) {
    if (!d.commits?.length && !d.errors?.commits) return '';
    const multi = (d.commits || []).length > 1;
    const rows = (d.commits || []).flatMap((g) => g.commits.map((c) => {
      const main = `${multi ? `<span class="gh-dim">${esc(g.repo)} ·</span> ` : ''}${esc(c.msg)}`;
      const sub = `<span class="gh-sha">${esc(c.sha)}</span> ${esc(c.author)}`;
      return row(ICONS.commit, main, esc(age(c.at)), sub);
    }));
    return sec('commits', head('commit', t('Latest commits')) + errLine(d, 'commits') + list(rows));
  }

  function prList(key, icon, title, empty) {
    return (d) => {
      const x = d[key];
      if (!x && !d.errors?.[key]) return '';
      const rows = (x?.items || []).map((p) => {
        const badges = [];
        if (p.draft) badges.push(`<span class="gh-rv rv-draft">${esc(t('Draft'))}</span>`);
        if (p.review) badges.push(`<span class="gh-rv rv-${p.review}">${esc(t(REVIEW_LABELS[p.review]))}</span>`);
        const checks = p.checks ? `<span class="gh-chk ck-${p.checks}" title="${esc(t(CHECK_LABELS[p.checks]))}">${ICONS[p.checks === 'pending' ? 'running' : p.checks]}</span>` : '';
        const sub = [`${esc(p.repo)}#${esc(p.n)}`, ...badges].join(' · ');
        return row(ICONS.pr, esc(p.title), `${checks}${esc(age(p.updatedAt || p.at))}`, sub, `rv-${p.review || 'none'}`);
      });
      const total = x && x.total > rows.length ? `<span class="gh-dim">${esc(x.total)}</span>` : '';
      const body = rows.length ? list(rows) : x ? `<div class="gh-empty">${esc(empty)}</div>` : '';
      return sec(key, head(icon, title, total) + errLine(d, key) + body);
    };
  }
  const myPrs = prList('myPrs', 'pr', t('My pull requests'), t('No open pull requests'));
  const reviews = prList('reviews', 'eye', t('Review requests'), t('No review requests'));

  function issues(d) {
    const x = d.issues;
    if (!x && !d.errors?.issues) return '';
    const rows = (x?.items || []).map((i) => {
      const labels = compact ? '' : i.labels.map((l) => `<span class="gh-label" style="--lc:#${esc(l.color)}">${esc(l.name)}</span>`).join('');
      return row(ICONS.issue, esc(i.title), esc(age(i.at)), `${esc(i.repo)}#${esc(i.n)}${labels ? ` ${labels}` : ''}`);
    });
    const total = x && x.total > rows.length ? `<span class="gh-dim">${esc(x.total)}</span>` : '';
    const body = rows.length ? list(rows) : x ? `<div class="gh-empty">${esc(t('No assigned issues'))}</div>` : '';
    return sec('issues', head('issue', t('Assigned issues'), total) + errLine(d, 'issues') + body);
  }

  function contrib(d) {
    const c = d.contrib;
    if (!c && !d.errors?.contrib) return '';
    let body = '';
    if (c?.weeks?.length && s.showContrib) body += `<div class="gh-calwrap ${s.contribColor === 'accent' ? 'gh-accent' : 'gh-green'}">${contribSvg(c)}</div>`;
    if (c?.streak && s.showStreak) {
      const k = c.streak;
      body += `<div class="gh-streak">
        <span><b>${esc(k.current)}</b>${esc(t('current streak'))}</span>
        <span><b>${esc(k.longest)}</b>${esc(t('longest streak'))}</span>
        <span><b>${esc(k.thisYear)}</b>${esc(t('this year'))}</span>
      </div>`;
    }
    const total = c ? `<span class="gh-dim">${esc(t('{n} in the last year', { n: c.total }))}</span>` : '';
    return sec('contrib', head(s.showContrib ? 'commit' : 'flame', t('Contributions'), s.showContrib ? total : '') + errLine(d, 'contrib') + body);
  }

  function eventText(e) {
    const p = { actor: e.actor, repo: e.repo, n: e.n, tag: e.text, branch: e.branch };
    switch (e.kind) {
      case 'star': return t('{actor} starred {repo}', p);
      case 'fork': return t('{actor} forked {repo}', p);
      case 'issue':
        if (e.action === 'closed') return t('{actor} closed issue #{n}', p);
        if (e.action === 'reopened') return t('{actor} reopened issue #{n}', p);
        return t('{actor} opened issue #{n}', p);
      case 'comment': return t('{actor} commented on #{n}', p);
      case 'pr':
        if (e.action === 'merged') return t('{actor} merged PR #{n}', p);
        if (e.action === 'closed') return t('{actor} closed PR #{n}', p);
        if (e.action === 'reopened') return t('{actor} reopened PR #{n}', p);
        return t('{actor} opened PR #{n}', p);
      case 'review':
        if (e.state === 'approved') return t('{actor} approved PR #{n}', p);
        if (e.state === 'changes_requested') return t('{actor} requested changes on PR #{n}', p);
        return t('{actor} reviewed PR #{n}', p);
      case 'release': return t('{actor} released {tag}', p);
      case 'tag': return t('{actor} created tag {tag}', p);
      case 'push':
        if (e.n === 1) return t('{actor} pushed 1 commit to {branch}', p);
        if (e.n) return t('{actor} pushed {n} commits to {branch}', p);
        return t('{actor} pushed to {branch}', p);
      default: return '';
    }
  }
  const EVENT_ICONS = { star: 'star', fork: 'fork', issue: 'issue', comment: 'comment', pr: 'pr', review: 'eye', release: 'tag', tag: 'tag', push: 'commit' };

  function activity(d) {
    if (!d.activity?.length && !d.errors?.activity) return '';
    const multi = new Set((d.activity || []).map((e) => e.repo)).size > 1;
    const rows = (d.activity || []).map((e) => {
      const icon = ICONS[e.kind === 'pr' && e.action === 'merged' ? 'merge' : EVENT_ICONS[e.kind] || 'pulse'];
      const sub = [multi && e.kind !== 'star' && e.kind !== 'fork' ? esc(e.repo) : '', e.text && e.kind !== 'release' && e.kind !== 'tag' ? esc(e.text) : ''].filter(Boolean).join(' · ');
      return row(icon, esc(eventText(e)), esc(age(e.at)), sub, `ev-${e.kind}${e.action ? ` ev-${e.action}` : ''}`);
    });
    return sec('activity', head('pulse', t('Activity')) + errLine(d, 'activity') + list(rows));
  }

  function followers(d) {
    const f = d.followers;
    if (!f && !d.errors?.followers) return '';
    const rows = (f?.recent || []).map((x) => row(ICONS.user, esc(x.login), esc(age(x.at))));
    const total = f ? `<span class="gh-dim">${esc(t('{n} followers', { n: f.count }))}</span>` : '';
    const body = rows.length ? list(rows) : f ? `<div class="gh-empty">${esc(t('No new followers yet'))}</div>` : '';
    return sec('followers', head('user', t('New followers'), total) + errLine(d, 'followers') + body);
  }

  function stargazers(d) {
    if (!d.stargazers && !d.errors?.stargazers) return '';
    const rows = (d.stargazers || []).map((x) => row(ICONS.star, `${esc(x.login)} <span class="gh-dim">→ ${esc(x.repo)}</span>`, esc(age(x.at))));
    const body = rows.length ? list(rows) : d.stargazers ? `<div class="gh-empty">${esc(t('No stars yet'))}</div>` : '';
    return sec('stargazers', head('star', t('New stargazers')) + errLine(d, 'stargazers') + body);
  }

  function security(d) {
    if (!d.security && !d.errors?.security) return '';
    const rows = (d.security || []).map((r) => {
      if (r.noAccess) return row(ICONS.shield, esc(r.repo), `<span class="gh-dim">${esc(t('No access'))}</span>`, '', 'sev-none');
      if (r.error) return row(ICONS.shield, esc(r.repo), `<span class="gh-errt">${esc(r.error)}</span>`);
      if (!r.total) return row(ICONS.success, esc(r.repo), `<span class="gh-dim">${esc(t('No open alerts'))}</span>`, '', 'sev-ok');
      const chips = ['critical', 'high', 'medium', 'low'].filter((k) => r[k]).map((k) => `<span class="gh-sev sev-${k}" title="${esc(t(k[0].toUpperCase() + k.slice(1)))}">${esc(r[k])}</span>`).join('');
      const worst = ['critical', 'high', 'medium', 'low'].find((k) => r[k]);
      return row(ICONS.shield, esc(r.repo), chips, '', `sev-${worst}`);
    });
    return sec('security', head('shield', t('Security alerts')) + errLine(d, 'security') + list(rows));
  }

  function hints(d) {
    const out = [];
    if (d.notice) out.push(`<div class="gh-hint gh-warn">${esc(d.notice)}</div>`);
    if (d.needsToken) out.push(`<div class="gh-hint">${esc(t('Pull requests, issues, contribution graph and security alerts need a GitHub token'))}</div>`);
    if (d.needsUser) out.push(`<div class="gh-hint">${esc(t('Set a GitHub user name for followers'))}</div>`);
    if (d.deferred) out.push(`<div class="gh-hint">${esc(t('Some sections are postponed to save GitHub API requests'))}</div>`);
    if (d.rate && d.rate.limit && d.rate.remaining / d.rate.limit < 0.2 && !d.notice) out.push(`<div class="gh-hint">${esc(t('API: {remaining} of {limit} requests left', d.rate))}</div>`);
    return out.join('');
  }

  // Strings used via the label maps above (listed so translations are found):
  // t('Running') t('Queued') t('Passed') t('Failed') t('Cancelled') t('Skipped') t('Action required')
  // t('Review required') t('Approved') t('Changes requested') t('Checks passed') t('Checks failed') t('Checks running')
  // t('Critical') t('High') t('Medium') t('Low')

  function draw() {
    const d = last;
    if (!d) return;
    let html;
    if (d.needsSetup) html = `<div class="gh-hint">${esc(t('Add repositories or an access token in the admin panel'))}</div>`;
    else {
      const body = [overview, active, builds, myPrs, reviews, issues, releases, commits, contrib, activity, followers, stargazers, security].map((f) => f(d)).join('');
      html = `<div class="gh${compact ? ' gh-compact' : ''}">${body || `<div class="gh-empty">${esc(t('Nothing to show'))}</div>`}${hints(d)}</div>`;
    }
    if (html !== lastHtml) {
      lastHtml = html;
      el.innerHTML = html;
    }
  }

  return {
    update(d) {
      last = d;
      draw();
    },
    // Ages and elapsed times of running workflows.
    tick: draw,
    tickEvery: 30000,
    // Faster while a workflow runs (30 s with token, 2 min without).
    refreshSeconds: () => last?.refresh || 0,
  };
}
