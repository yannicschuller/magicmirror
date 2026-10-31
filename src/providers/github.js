// GitHub tracker. REST v3 for everything repository-related (works without a
// token, conditional requests with ETags – 304 answers don't count against
// the rate limit), GraphQL for user-level data that needs a token anyway
// (pull requests, review requests, assigned issues, contribution calendar).
// Star snapshots and known followers are kept in DATA_DIR/github.json so
// "new stars this week" and the star history survive restarts.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cached, dateKey } from '../util.js';
import { DATA_DIR } from '../config.js';
import { translator, langOf } from '../../public/shared/i18n.js';

// Errors carry their message id so provider() can translate them.
function fail(id, params) {
  const err = new Error(translator('en')(id, params));
  err.msgId = id;
  err.params = params;
  return err;
}

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const UA = 'MagicMirror';
const STAR_JSON = 'application/vnd.github.star+json';
const DAY = 86400000;
const KEEP_DAYS = 120;
const MAX_TTL = 5.5 * 3600; // util.cached() drops entries after 6 h anyway
const hash = (...parts) => createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 16);
const clamp = (v, min, max, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const cut = (s, n = 100) => {
  const v = String(s ?? '').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

// ---- small helpers ----------------------------------------------------------------

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

// List entries → [{ full, name, branch }]; accepts "owner/name" and GitHub URLs.
export function parseRepos(list, max = 10) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    let full = String(r?.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
    if (!REPO_RE.test(full) || seen.has(full.toLowerCase())) continue;
    seen.add(full.toLowerCase());
    out.push({ full, name: String(r.name || '').trim() || full.split('/')[1], branch: String(r.branch || '').trim() });
    if (out.length >= max) break;
  }
  return out;
}

// Link header → number of the last page (with per_page=1 = total count).
export function lastPage(link) {
  const m = String(link || '').match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

export function shiftKey(key, days) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

// Rate limits and the request budget are per token (or anonymous) and API host.
export const scopeOf = (api, token) => hash(api, token || 'anon');

// ---- rate limits ------------------------------------------------------------------

// Response headers → { resource, limit, remaining, reset, blockedUntil } (ms epoch).
export function rateFromHeaders(headers, status, now = Date.now()) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]);
  const remaining = get('x-ratelimit-remaining');
  const retryAfter = Number(get('retry-after'));
  if (remaining == null && !retryAfter) return null;
  const r = {
    resource: get('x-ratelimit-resource') || 'core',
    limit: Number(get('x-ratelimit-limit')) || null,
    remaining: remaining == null ? null : Number(remaining),
    reset: Number(get('x-ratelimit-reset')) * 1000 || null,
    blockedUntil: 0,
  };
  const limited = status === 403 || status === 429;
  if (limited && retryAfter > 0) r.blockedUntil = now + retryAfter * 1000;
  else if (r.remaining === 0 && r.reset) r.blockedUntil = r.reset;
  else if (limited && r.remaining === 0) r.blockedUntil = now + 60000;
  return r;
}

const limits = new Map(); // `${scope}:${resource}` → rate state

function rateError(until, now = Date.now()) {
  const err = fail('GitHub rate limit reached – trying again in {min} min', { min: Math.max(1, Math.ceil((until - now) / 60000)) });
  err.rateLimited = true;
  err.until = until;
  return err;
}

export function blockedUntil(scope, resource = 'core', now = Date.now()) {
  const l = limits.get(`${scope}:${resource}`);
  return l && l.blockedUntil > now ? l.blockedUntil : 0;
}

// Request budget per hour, shared by all GitHub modules with the same token (or
// none). Without a token GitHub counts every request – even 304 answers – against
// 60 per hour and IP, so the mirror stays well below that.
export const BUDGET = { anon: 40, token: 3000 };
const SHARE = { high: 1, normal: 0.85, low: 0.6 };
const usage = new Map(); // scope → request timestamps (last hour)

export function budgetUsed(scope, now = Date.now()) {
  const list = (usage.get(scope) || []).filter((x) => x > now - 3600000);
  usage.set(scope, list);
  return list.length;
}

// May a request of this priority go out now? Lower priorities stop earlier, so
// overview and builds keep working when the budget runs low.
export function budgetAllows(scope, priority = 'normal', { token = false, rate = null, now = Date.now() } = {}) {
  const limit = token ? BUDGET.token : BUDGET.anon;
  if (budgetUsed(scope, now) >= Math.floor(limit * (SHARE[priority] ?? 1))) return false;
  if (rate && rate.remaining !== null && rate.reset > now) {
    // Keep a reserve of GitHub's own counter: 10 of 60 anonymously, 200 of 5000 with a token.
    const reserve = Math.max(3, Math.round((rate.limit || (token ? 5000 : 60)) * (token ? 0.04 : 0.17)));
    if (priority === 'low' && rate.remaining < reserve * 2) return false;
    if (priority !== 'high' && rate.remaining < reserve) return false;
    if (rate.remaining < 2) return false;
  }
  return true;
}

export function noteRequest(scope, now = Date.now()) {
  budgetUsed(scope, now);
  usage.get(scope).push(now);
}

// Refresh interval: configured, or automatic (15 min without token, 5 min with).
export function baseRefresh(s, token) {
  const m = Number(s.refreshMinutes) || 0;
  return (m > 0 ? clamp(m, 2, 60, 10) : token ? 5 : 15) * 60;
}

// Requests per hour the configuration needs (worst case) and the TTL per
// request class, stretched to stay within the budget.
export function planTtls(s, { token = false, repos = 0, followed = 0, user = false } = {}, rate = null, now = Date.now()) {
  const R = baseRefresh(s, token);
  const slow = token ? 1800 : 3600; // things that rarely change
  const base = {
    repo: R, pulls: R, runs: R, commits: R, events: token ? R : Math.max(R, 1800),
    releases: Math.max(R, slow), stargazers: Math.max(R, slow), security: Math.max(R, 3600), followers: Math.max(R, slow),
    work: R, contrib: Math.max(R, 3600), user: MAX_TTL,
  };
  const anyRepo = repos > 0 && (s.showOverview || s.showStarHistory || s.showBuilds || s.showRunning || s.showStargazers);
  // With a token the overview (incl. open PR count) is one GraphQL query for all repositories.
  const calls = {
    repo: anyRepo && !token ? repos : 0,
    pulls: s.showOverview && !token ? repos : 0,
    runs: s.showBuilds || s.showRunning ? repos : 0,
    commits: s.showCommits ? repos : 0,
    events: s.showActivity ? repos : 0,
    releases: s.showReleases ? repos + followed : 0,
    stargazers: s.showStargazers ? repos : 0,
    security: s.showSecurity && token ? repos : 0,
    followers: s.showFollowers && user ? 2 : 0,
  };
  const perHour = Object.entries(calls).reduce((sum, [k, n]) => sum + (n * 3600) / base[k], 0);
  const budget = token ? BUDGET.token : BUDGET.anon;
  let factor = Math.max(1, perHour / budget);
  if (rate?.limit && rate.remaining !== null && rate.remaining / rate.limit < 0.2 && rate.reset > now) factor *= 2;
  const ttl = {};
  for (const [k, v] of Object.entries(base)) ttl[k] = Math.round(Math.min(MAX_TTL, k === 'user' ? v : v * factor));
  return { ttl, factor: Math.round(factor * 100) / 100, perHour: Math.round(perHour), budget, refresh: R };
}

// ---- HTTP -------------------------------------------------------------------------

const etags = new Map(); // request key → { etag, data, link }
const ETAG_MAX = 400;

// GET (with ETag) or POST against the API. `map` normalises the body before
// it is kept for 304 answers, so only small objects stay in memory.
async function gh(ctx, url, { accept, map = (x) => x, resource = 'core', method = 'GET', body, priority = 'normal' } = {}) {
  const full = url.startsWith('http') ? url : ctx.api + url;
  const until = blockedUntil(ctx.scope, resource);
  if (until) throw rateError(until);
  if (resource === 'core') {
    if (!budgetAllows(ctx.scope, priority, { token: !!ctx.token, rate: limits.get(`${ctx.scope}:core`) })) {
      const err = fail('Postponed to save GitHub API requests');
      err.deferred = true;
      throw err;
    }
    noteRequest(ctx.scope);
  }
  const headers = { Accept: accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': UA };
  if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const key = `${ctx.scope}|${accept || ''}|${full}`;
  const prev = method === 'GET' ? etags.get(key) : null;
  if (prev) headers['If-None-Match'] = prev.etag;
  let res;
  try {
    res = await ctx.fetch(full, { method, headers, body, signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw fail('GitHub not reachable ({reason})', { reason: err.cause?.code || err.name || err.message });
  }
  const rate = rateFromHeaders(res.headers, res.status);
  if (rate) limits.set(`${ctx.scope}:${rate.resource}`, rate);
  if (res.status === 304 && prev) return { data: prev.data, link: prev.link, notModified: true };
  if (!res.ok) {
    let msg = '';
    try {
      msg = String((await res.json())?.message || '');
    } catch {}
    if ((res.status === 403 || res.status === 429) && (rate?.blockedUntil || /rate limit/i.test(msg))) {
      const blocked = rate?.blockedUntil || Date.now() + 60000;
      limits.set(`${ctx.scope}:${rate?.resource || resource}`, { ...(rate || {}), blockedUntil: blocked });
      throw rateError(blocked);
    }
    if (res.status === 401) throw fail('GitHub rejected the access token');
    const err = res.status === 404 ? fail('Not found or no access') : fail('GitHub error {status}', { status: res.status });
    err.status = res.status;
    throw err;
  }
  const raw = await res.json();
  const data = map(raw);
  const link = res.headers.get('link') || '';
  const etag = res.headers.get('etag');
  if (etag && method === 'GET') {
    etags.delete(key);
    etags.set(key, { etag, data, link });
    if (etags.size > ETAG_MAX) etags.delete(etags.keys().next().value);
  }
  return { data, link, raw };
}

async function graphql(ctx, query, variables) {
  const { data } = await gh(ctx, ctx.graphqlUrl, { method: 'POST', resource: 'graphql', body: JSON.stringify({ query, variables }) });
  if (data?.errors?.length && !data.data) {
    const m = String(data.errors[0].message || '');
    if (/rate limit/i.test(m)) throw rateError(Date.now() + 15 * 60000);
    throw fail('GitHub error {status}', { status: cut(m, 80) });
  }
  return data?.data || {};
}

// ---- persisted state (star snapshots, known followers) ------------------------------

let store = null;
let storeFile = null;
let saveTimer = null;

async function loadStore(file) {
  if (store && storeFile === file) return store;
  storeFile = file;
  try {
    store = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    store = {};
  }
  store.stars ||= {};
  store.followers ||= {};
  return store;
}

function saveSoon(delay = 3000) {
  if (saveTimer) return;
  const file = storeFile;
  const data = store;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(data));
      await fs.rename(`${file}.tmp`, file);
    } catch (err) {
      console.warn(`[github] could not save ${file}: ${err.message}`);
    }
  }, delay);
  saveTimer.unref?.();
}

export async function flushStore() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await fs.mkdir(path.dirname(storeFile), { recursive: true });
  await fs.writeFile(storeFile, JSON.stringify(store));
}

// ---- stars ------------------------------------------------------------------------

// Daily snapshot { 'YYYY-MM-DD': count }; returns true when something changed.
export function recordStars(entry, key, count, keep = KEEP_DAYS) {
  entry.days ||= {};
  let changed = entry.days[key] !== count;
  entry.days[key] = count;
  const cutoff = shiftKey(key, -keep);
  for (const k of Object.keys(entry.days)) {
    if (k < cutoff) {
      delete entry.days[k];
      changed = true;
    }
  }
  return changed;
}

// Stars gained since `back` days ago (1 = since yesterday). Without a snapshot
// that old the oldest earlier one is used; null when there is only today.
export function starDelta(days, todayKey, back) {
  const keys = Object.keys(days || {}).sort();
  if (!keys.length) return null;
  const current = days[todayKey] ?? days[keys[keys.length - 1]];
  const target = shiftKey(todayKey, -back);
  let ref = null;
  for (const k of keys) if (k <= target) ref = k;
  if (!ref && keys[0] < todayKey) ref = keys[0];
  return ref ? current - days[ref] : null;
}

// One value per day for the last n days, carried forward over gaps; null before the first snapshot.
export function starSeries(days, todayKey, n) {
  const out = [];
  const keys = Object.keys(days || {}).sort();
  let last = null;
  const start = shiftKey(todayKey, -(n - 1));
  for (const k of keys) if (k < start) last = days[k];
  for (let i = 0; i < n; i++) {
    const k = shiftKey(start, i);
    if (days[k] !== undefined) last = days[k];
    out.push(last);
  }
  return out;
}

// Stargazer timestamps → cumulative daily counts for the kept window.
export function seedDays(timestamps, todayKey, tz, keep = KEEP_DAYS) {
  const keys = timestamps.filter(Boolean).map((t) => dateKey(new Date(t), tz)).sort();
  const days = {};
  const start = shiftKey(todayKey, -keep + 1);
  let i = 0;
  for (let d = 0; d < keep; d++) {
    const k = shiftKey(start, d);
    while (i < keys.length && keys[i] <= k) i++;
    if (i > 0) days[k] = i;
  }
  return days;
}

// ---- followers --------------------------------------------------------------------

// Compares the current follower sample with the known logins. The first
// check only records a baseline.
export function diffFollowers(state, logins, now = Date.now()) {
  if (!state) return { state: { known: [...new Set(logins)].slice(0, 2000), recent: [] }, added: [] };
  const known = new Set(state.known || []);
  const added = logins.filter((l) => !known.has(l));
  const at = new Date(now).toISOString();
  const recent = [...added.map((login) => ({ login, at })), ...(state.recent || [])].slice(0, 20);
  const merged = [...new Set([...logins, ...(state.known || [])])].slice(0, 2000);
  return { state: { known: merged, recent }, added };
}

// ---- normalisers ------------------------------------------------------------------

export function normRepo(r) {
  return {
    full: r.full_name,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    openIssues: r.open_issues_count ?? 0, // issues + pull requests
    pushedAt: r.pushed_at || null,
    defaultBranch: r.default_branch || 'main',
    archived: !!r.archived,
  };
}

export function normRelease(list, prereleases = false) {
  const r = (Array.isArray(list) ? list : []).find((x) => !x.draft && (prereleases || !x.prerelease));
  if (!r) return null;
  return { tag: cut(r.tag_name, 40), name: r.name && r.name !== r.tag_name ? cut(r.name, 60) : '', at: r.published_at || r.created_at, pre: !!r.prerelease };
}

export function normCommits(list) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    sha: String(c.sha || '').slice(0, 7),
    msg: cut(String(c.commit?.message || '').split('\n')[0], 90),
    author: c.author?.login || c.commit?.author?.name || '',
    at: c.commit?.author?.date || c.commit?.committer?.date || null,
  }));
}

const QUEUED = new Set(['queued', 'waiting', 'requested', 'pending']);

// Actions run → running | queued | success | failure | cancelled | skipped | action
export function runStatus(run) {
  if (run.status === 'in_progress') return 'running';
  if (QUEUED.has(run.status)) return 'queued';
  switch (run.conclusion) {
    case 'success': return 'success';
    case 'failure': case 'timed_out': case 'startup_failure': return 'failure';
    case 'cancelled': return 'cancelled';
    case 'action_required': return 'action';
    default: return 'skipped'; // neutral, skipped, stale
  }
}

function slimRun(r) {
  const status = runStatus(r);
  const started = r.run_started_at || r.created_at;
  const done = status !== 'running' && status !== 'queued';
  return {
    id: r.id,
    workflow: cut(r.name || r.path?.split('/').pop() || '', 50),
    wid: r.workflow_id,
    status,
    branch: r.head_branch || '',
    event: r.event || '',
    title: cut(r.display_title || '', 80),
    startedAt: started,
    duration: done && started && r.updated_at ? Math.max(0, Math.round((Date.parse(r.updated_at) - Date.parse(started)) / 1000)) : null,
  };
}

// Runs (newest first) → latest run per workflow on the branch + all active runs.
export function normRuns(json, branch, perRepo = 3) {
  const runs = (json?.workflow_runs || []).map(slimRun);
  const pick = (list) => {
    const seen = new Map();
    for (const r of list) if (!seen.has(r.wid)) seen.set(r.wid, r);
    return [...seen.values()];
  };
  let builds = pick(runs.filter((r) => r.branch === branch));
  if (!builds.length) builds = pick(runs);
  return {
    builds: builds.slice(0, perRepo),
    active: runs.filter((r) => r.status === 'running' || r.status === 'queued').slice(0, 5),
  };
}

export function normJobs(json) {
  const jobs = json?.jobs || [];
  const steps = jobs.flatMap((j) => j.steps || []);
  const running = jobs.find((j) => j.status === 'in_progress');
  const step = running?.steps?.find((x) => x.status === 'in_progress');
  return {
    jobsDone: jobs.filter((j) => j.status === 'completed').length,
    jobsTotal: jobs.length,
    stepsDone: steps.filter((x) => x.status === 'completed').length,
    stepsTotal: steps.length,
    current: cut(step?.name || running?.name || '', 50),
  };
}

// Repository events → short activity lines.
export function normEvents(list, repo) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    const p = e.payload || {};
    const base = { repo, actor: e.actor?.display_login || e.actor?.login || '', at: e.created_at };
    switch (e.type) {
      case 'WatchEvent': out.push({ ...base, kind: 'star' }); break;
      case 'ForkEvent': out.push({ ...base, kind: 'fork' }); break;
      case 'IssuesEvent':
        if (['opened', 'closed', 'reopened'].includes(p.action)) out.push({ ...base, kind: 'issue', action: p.action, n: p.issue?.number, text: cut(p.issue?.title, 70) });
        break;
      case 'IssueCommentEvent':
        if (p.action === 'created') out.push({ ...base, kind: 'comment', n: p.issue?.number, pr: !!p.issue?.pull_request, text: cut(p.issue?.title, 70) });
        break;
      case 'PullRequestEvent':
        if (['opened', 'closed', 'reopened'].includes(p.action)) {
          const action = p.action === 'closed' && p.pull_request?.merged ? 'merged' : p.action;
          out.push({ ...base, kind: 'pr', action, n: p.pull_request?.number ?? p.number, text: cut(p.pull_request?.title, 70) });
        }
        break;
      case 'PullRequestReviewEvent':
        out.push({ ...base, kind: 'review', state: String(p.review?.state || '').toLowerCase(), n: p.pull_request?.number, text: cut(p.pull_request?.title, 70) });
        break;
      case 'ReleaseEvent':
        if (p.action === 'published') out.push({ ...base, kind: 'release', text: cut(p.release?.tag_name, 40) });
        break;
      case 'PushEvent': {
        const n = p.size ?? p.distinct_size ?? p.commits?.length ?? null;
        out.push({ ...base, kind: 'push', branch: String(p.ref || '').replace(/^refs\/heads\//, ''), n });
        break;
      }
      case 'CreateEvent':
        if (p.ref_type === 'tag') out.push({ ...base, kind: 'tag', text: cut(p.ref, 40) });
        break;
      default:
    }
  }
  return out.slice(0, 20);
}

export function normStargazers(list) {
  return (Array.isArray(list) ? list : []).filter((x) => x?.starred_at).map((x) => ({ login: x.user?.login || '', at: x.starred_at }));
}

export function severityCounts(alerts) {
  const out = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  for (const a of Array.isArray(alerts) ? alerts : []) {
    const sev = String(a.security_advisory?.severity || a.security_vulnerability?.severity || 'low').toLowerCase();
    const k = sev === 'moderate' ? 'medium' : sev in out ? sev : 'low';
    out[k]++;
    out.total++;
  }
  return out;
}

const REVIEW = { REVIEW_REQUIRED: 'required', APPROVED: 'approved', CHANGES_REQUESTED: 'changes' };
const CHECKS = { SUCCESS: 'success', FAILURE: 'failure', ERROR: 'failure', PENDING: 'pending', EXPECTED: 'pending' };

export function normPr(n) {
  return {
    repo: n.repository?.nameWithOwner || '',
    n: n.number,
    title: cut(n.title, 80),
    draft: !!n.isDraft,
    review: REVIEW[n.reviewDecision] || null,
    checks: CHECKS[n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state] || null,
    at: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

export function normIssue(n) {
  return {
    repo: n.repository?.nameWithOwner || '',
    n: n.number,
    title: cut(n.title, 80),
    labels: (n.labels?.nodes || []).slice(0, 4).map((l) => ({ name: cut(l.name, 24), color: /^[0-9a-f]{6}$/i.test(l.color) ? l.color : '888888' })),
    at: n.createdAt,
  };
}

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

export function normCalendar(cal) {
  const weeks = (cal?.weeks || []).map((w) => (w.contributionDays || []).map((d) => ({ date: d.date, count: d.contributionCount || 0, level: LEVELS[d.contributionLevel] ?? (d.contributionCount ? 1 : 0) })));
  return { total: cal?.totalContributions || 0, weeks };
}

// Current streak (a day without contributions *today* doesn't break it yet),
// longest streak and contributions this calendar year.
export function streaks(days, todayKey) {
  const list = [...days].filter((d) => d.date <= todayKey).sort((a, b) => (a.date < b.date ? -1 : 1));
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of list) {
    if (d.count > 0) {
      run = prev && shiftKey(prev, 1) === d.date && run > 0 ? run + 1 : 1;
      longest = Math.max(longest, run);
    } else run = 0;
    prev = d.date;
  }
  const byDate = new Map(list.map((d) => [d.date, d.count]));
  let k = byDate.get(todayKey) > 0 ? todayKey : shiftKey(todayKey, -1);
  let current = 0;
  while (byDate.get(k) > 0) {
    current++;
    k = shiftKey(k, -1);
  }
  const year = todayKey.slice(0, 4);
  const thisYear = list.filter((d) => d.date.startsWith(year)).reduce((s, d) => s + d.count, 0);
  return { current, longest, thisYear };
}

// Last n weeks as level strings ("0120340"), plus the weekday (0 = Sunday) of the first cell.
export function contribGrid(weeks, n) {
  const last = weeks.slice(-n);
  const first = last[0]?.[0]?.date;
  return {
    offset: first ? new Date(`${first}T12:00:00Z`).getUTCDay() : 0,
    from: first || null,
    weeks: last.map((w) => w.map((d) => d.level).join('')),
  };
}

const PR_FIELDS = '... on PullRequest { number title isDraft createdAt updatedAt reviewDecision repository { nameWithOwner } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }';

export function workQuery({ prs, reviews, issues }) {
  const parts = [];
  const vars = [];
  if (prs) {
    vars.push('$qPrs: String!', '$nPrs: Int!');
    parts.push(`myPrs: search(query: $qPrs, type: ISSUE, first: $nPrs) { issueCount nodes { ${PR_FIELDS} } }`);
  }
  if (reviews) {
    vars.push('$qReviews: String!', '$nReviews: Int!');
    parts.push(`reviews: search(query: $qReviews, type: ISSUE, first: $nReviews) { issueCount nodes { ${PR_FIELDS} } }`);
  }
  if (issues) {
    vars.push('$qIssues: String!', '$nIssues: Int!');
    parts.push('issues: search(query: $qIssues, type: ISSUE, first: $nIssues) { issueCount nodes { ... on Issue { number title createdAt repository { nameWithOwner } labels(first: 4) { nodes { name color } } } } }');
  }
  return `query(${vars.join(', ')}) { ${parts.join(' ')} }`;
}

export const CONTRIB_QUERY = 'query($login: String!) { user(login: $login) { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount contributionLevel } } } } } }';

// Overview of all repositories in one GraphQL query (token only) – replaces
// one /repos and one /pulls request per repository.
export function repoQuery(repos) {
  const vars = [];
  const parts = repos.map((r, i) => {
    vars.push(`$o${i}: String!`, `$n${i}: String!`);
    return `r${i}: repository(owner: $o${i}, name: $n${i}) { nameWithOwner stargazerCount forkCount pushedAt isArchived defaultBranchRef { name } issues(states: OPEN) { totalCount } pullRequests(states: OPEN) { totalCount } }`;
  });
  const variables = Object.fromEntries(repos.flatMap((r, i) => [[`o${i}`, r.full.split('/')[0]], [`n${i}`, r.full.split('/')[1]]]));
  return { query: `query(${vars.join(', ')}) { ${parts.join(' ')} }`, variables };
}

export function normRepoGql(r) {
  if (!r) return null;
  return {
    full: r.nameWithOwner,
    stars: r.stargazerCount ?? 0,
    forks: r.forkCount ?? 0,
    issues: r.issues?.totalCount ?? 0,
    prs: r.pullRequests?.totalCount ?? 0,
    openIssues: (r.issues?.totalCount ?? 0) + (r.pullRequests?.totalCount ?? 0),
    pushedAt: r.pushedAt || null,
    defaultBranch: r.defaultBranchRef?.name || 'main',
    archived: !!r.isArchived,
  };
}

// ---- provider ---------------------------------------------------------------------

const liveRuns = new Set(); // cache keys of repos with active runs → short TTL

export async function provider(settings, cfg, mod, opts = {}) {
  const s = settings || {};
  const t = translator(langOf(cfg?.general?.locale));
  const tz = cfg?.general?.timezone || 'Europe/Berlin';
  const now = opts.now || Date.now();
  const today = dateKey(new Date(now), tz);
  const token = String(s.token || '').trim();
  const api = (opts.api || API).replace(/\/+$/, '');
  const ctx = { api, graphqlUrl: `${api}/graphql`, token, scope: scopeOf(api, token), fetch: opts.fetch || fetch };
  const repos = parseRepos(s.repos);
  const followed = parseRepos(s.followed, 15).filter((f) => !repos.some((r) => r.full.toLowerCase() === f.full.toLowerCase()));
  const K = (...p) => `github:${ctx.scope}:${p.join(':')}`;
  const msg = (err) => (err.msgId ? t(err.msgId, err.params) : err.message);
  // Without a token running workflows are checked at most every 2 minutes.
  const live = token ? clamp(s.liveSeconds, 15, 300, 30) : Math.max(120, clamp(s.liveSeconds, 15, 300, 30));

  const tokenOnly = ['showMyPrs', 'showReviews', 'showIssues', 'showContrib', 'showStreak', 'showSecurity'].filter((k) => s[k]);
  const out = { mode: token ? 'token' : 'public', errors: {}, failedBuilds: 0, running: 0, refresh: 0 };
  if (!repos.length && !followed.length && !token && !String(s.username || '').trim()) {
    return { ...out, errors: undefined, needsSetup: true, refresh: 3600 };
  }
  // Token-only sections are simply skipped – one hint instead of errors.
  if (!token && tokenOnly.length) out.needsToken = true;

  // User login: configured, or the token's owner.
  let login = String(s.username || '').trim();
  const userNeeded = s.showFollowers || (token && (s.showMyPrs || s.showReviews || s.showIssues || s.showContrib || s.showStreak));
  let loginError = null;
  if (!login && token && userNeeded) {
    try {
      login = await cached(K('user'), MAX_TTL, async () => (await gh(ctx, '/user', { priority: 'high' })).data.login);
    } catch (err) {
      loginError = err;
    }
  }

  const plan = planTtls(s, { token: !!token, repos: repos.length, followed: followed.length, user: !!login }, limits.get(`${ctx.scope}:core`), now);
  const ttl = plan.ttl;
  const st = await loadStore(opts.dataFile || path.join(DATA_DIR, 'github.json'));

  let attempted = 0;
  let failed = 0;
  let firstErr = null;
  // Each section fails on its own; postponed requests (budget) are no error.
  const section = async (names, fn) => {
    const list = [].concat(names);
    attempted += list.length;
    try {
      const v = await fn();
      if (v !== undefined && !Array.isArray(names)) out[names] = v;
    } catch (err) {
      if (err.deferred) {
        attempted -= list.length;
        out.deferred = true;
        return;
      }
      failed += list.length;
      firstErr ||= err;
      for (const n of list) out.errors[n] = msg(err);
    }
  };
  // Per-repository results [{ error }] → throw when every repository failed.
  const allFailed = (res) => {
    if (res.length && res.every((x) => x?.error)) throw res.find((x) => !x.error.deferred)?.error || res[0].error;
  };

  // Repository info (overview, star history, builds, stargazers).
  const needInfo = repos.length && (s.showOverview || s.showStarHistory || s.showBuilds || s.showRunning || s.showStargazers);
  const info = new Map();
  const repoErr = {};
  let infoError = null;
  if (needInfo) {
    if (token) {
      try {
        const map = await cached(K('repos', hash(repos.map((r) => r.full).join(','))), ttl.repo, async () => {
          const { query, variables } = repoQuery(repos);
          const d = await graphql(ctx, query, variables);
          return repos.map((r, i) => normRepoGql(d[`r${i}`]));
        });
        repos.forEach((r, i) => (map[i] ? info.set(r.full, map[i]) : (repoErr[r.name] = t('Not found or no access'))));
      } catch (err) {
        infoError = err;
      }
    } else {
      await Promise.all(repos.map(async (r) => {
        try {
          info.set(r.full, await cached(K('repo', r.full), ttl.repo, async () => (await gh(ctx, `/repos/${r.full}`, { map: normRepo, priority: 'high' })).data));
        } catch (err) {
          infoError ||= err;
          repoErr[r.name] = msg(err);
        }
      }));
    }
    if (info.size && Object.keys(repoErr).length) out.repoErrors = repoErr;
  }
  const needAll = () => {
    if (needInfo && !info.size) throw infoError || fail('Not found or no access');
  };

  const jobs = [];

  if (s.showOverview || s.showStarHistory) {
    jobs.push(section('overview', async () => {
      needAll();
      const days = clamp(s.starWeeks, 2, 16, 8) * 7;
      let dirty = false;
      const list = await Promise.all(repos.filter((r) => info.has(r.full)).map(async (r) => {
        const i = info.get(r.full);
        const entry = (st.stars[r.full.toLowerCase()] ||= { days: {} });
        if (s.showStarHistory && !entry.seeded) {
          const seedMax = token ? 500 : 200;
          if (i.stars === 0 || i.stars > seedMax) entry.seeded = true;
          else {
            try {
              await cached(K('seed', r.full), 3600, async () => {
                const stamps = [];
                for (let page = 1; page <= Math.ceil(i.stars / 100); page++) {
                  const { data } = await gh(ctx, `/repos/${r.full}/stargazers?per_page=100&page=${page}`, { accept: STAR_JSON, map: normStargazers, priority: 'low' });
                  stamps.push(...data.map((x) => x.at));
                  if (data.length < 100) break;
                }
                entry.days = { ...seedDays(stamps, today, tz), ...entry.days };
                entry.seeded = true;
                dirty = true;
                return true;
              });
            } catch {
              // tried again in an hour
            }
          }
        }
        if (recordStars(entry, today, i.stars)) dirty = true;
        const item = { name: r.name, stars: i.stars, forks: i.forks, pushedAt: i.pushedAt, archived: i.archived };
        if (s.showOverview) {
          let prs = i.prs ?? null;
          // Without a token the open PR count costs one request per repository – low priority.
          if (prs === null) {
            try {
              prs = await cached(K('pulls', r.full), ttl.pulls, async () => {
                const { data, link } = await gh(ctx, `/repos/${r.full}/pulls?state=open&per_page=1`, { map: (x) => (Array.isArray(x) ? x.length : 0), priority: 'low' });
                return lastPage(link) ?? data;
              });
            } catch {}
          }
          item.prs = prs;
          item.issues = prs === null ? i.openIssues : i.issues ?? Math.max(0, i.openIssues - prs);
          if (s.starDelta === 'day' || s.starDelta === 'week') item.delta = starDelta(entry.days, today, s.starDelta === 'day' ? 1 : 7);
        }
        if (s.showStarHistory) {
          const series = starSeries(entry.days, today, days);
          if (series.filter((v) => v !== null).length > 1) item.series = series;
        }
        return item;
      }));
      if (dirty) saveSoon();
      return list;
    }));
  }

  if ((s.showBuilds || s.showRunning) && repos.length) {
    jobs.push(section(s.showBuilds ? 'builds' : 'active', async () => {
      needAll();
      const per = clamp(s.buildsPerRepo, 1, 10, 3);
      const res = await Promise.all(repos.filter((r) => info.has(r.full)).map(async (r) => {
        const branch = r.branch || info.get(r.full).defaultBranch;
        const key = K('runs', r.full, branch);
        try {
          const data = await cached(key, liveRuns.has(key) && s.showRunning ? live - 2 : ttl.runs, async () => {
            const { data } = await gh(ctx, `/repos/${r.full}/actions/runs?per_page=30`, { map: (j) => normRuns(j, branch, 10), priority: 'high' });
            if (data.active.length) liveRuns.add(key);
            else liveRuns.delete(key);
            return data;
          });
          return { r, data };
        } catch (err) {
          return { r, error: err };
        }
      }));
      allFailed(res);
      const builds = [];
      const running = [];
      for (const { r, data } of res) {
        if (!data) continue;
        for (const b of data.builds.slice(0, per)) builds.push({ repo: r.name, workflow: b.workflow, status: b.status, startedAt: b.startedAt, duration: b.duration, branch: b.branch });
        for (const a of data.active) running.push({ full: r.full, name: r.name, ...a });
      }
      out.failedBuilds = builds.filter((b) => b.status === 'failure').length;
      out.running = running.length;
      if (s.showRunning) {
        // Job/step progress only with a token (one extra request per active run).
        out.active = await Promise.all(running.slice(0, 4).map(async (a, idx) => {
          const item = { repo: a.name, workflow: a.workflow, branch: a.branch, event: a.event, title: a.title, status: a.status, startedAt: a.startedAt };
          if (token && idx < 3 && a.status === 'running') {
            try {
              Object.assign(item, await cached(K('jobs', a.full, a.id), live - 2, async () => (await gh(ctx, `/repos/${a.full}/actions/runs/${a.id}/jobs?per_page=50`, { map: normJobs })).data));
            } catch {}
          }
          return item;
        }));
      }
      return s.showBuilds ? builds : undefined;
    }));
  }

  if (s.showReleases && (repos.length || followed.length)) {
    out.releaseNewDays = clamp(s.releaseNewDays, 0, 90, 7);
    jobs.push(section('releases', async () => {
      const list = [...repos.map((r) => ({ ...r, own: true })), ...followed.map((r) => ({ ...r, own: false }))];
      const items = await Promise.all(list.map(async (r) => {
        try {
          const rel = await cached(K('rel', r.full, s.prereleases ? 1 : 0), ttl.releases, async () => (await gh(ctx, `/repos/${r.full}/releases?per_page=5`, { map: (x) => normRelease(x, !!s.prereleases) })).data);
          return rel ? { repo: r.name, own: r.own, ...rel } : {};
        } catch (err) {
          return { error: err };
        }
      }));
      allFailed(items);
      return items.filter((x) => x.tag).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, clamp(s.releasesCount, 1, 15, 4));
    }));
  }

  if (s.showCommits && repos.length) {
    jobs.push(section('commits', async () => {
      const n = clamp(s.commitsCount, 1, 10, 3);
      const res = await Promise.all(repos.map(async (r) => {
        try {
          const q = r.branch ? `&sha=${encodeURIComponent(r.branch)}` : '';
          const list = await cached(K('commits', r.full, r.branch), ttl.commits, async () => (await gh(ctx, `/repos/${r.full}/commits?per_page=10${q}`, { map: normCommits })).data);
          return { repo: r.name, commits: list.slice(0, n) };
        } catch (err) {
          return { error: err };
        }
      }));
      allFailed(res);
      return res.filter((x) => x.commits?.length);
    }));
  }

  if (token && (s.showMyPrs || s.showReviews || s.showIssues)) {
    const names = ['myPrs', 'reviews', 'issues'].filter((k, i) => s[['showMyPrs', 'showReviews', 'showIssues'][i]]);
    jobs.push(section(names, async () => {
      if (!login) throw loginError || fail('GitHub user name missing');
      const want = { prs: s.showMyPrs, reviews: s.showReviews, issues: s.showIssues };
      const vars = {};
      if (want.prs) Object.assign(vars, { qPrs: `is:pr is:open archived:false author:${login} sort:updated-desc`, nPrs: clamp(s.myPrsCount, 1, 20, 5) });
      if (want.reviews) Object.assign(vars, { qReviews: `is:pr is:open archived:false review-requested:${login} sort:updated-desc`, nReviews: clamp(s.reviewsCount, 1, 20, 5) });
      if (want.issues) Object.assign(vars, { qIssues: `is:issue is:open archived:false assignee:${login} sort:updated-desc`, nIssues: clamp(s.issuesCount, 1, 20, 5) });
      const data = await cached(K('work', hash(JSON.stringify(vars))), ttl.work, async () => {
        const d = await graphql(ctx, workQuery(want), vars);
        const pack = (x, fn) => x && { total: x.issueCount || 0, items: (x.nodes || []).filter((n) => n && n.number).map(fn) };
        return { myPrs: pack(d.myPrs, normPr), reviews: pack(d.reviews, normPr), issues: pack(d.issues, normIssue) };
      });
      for (const k of names) if (data[k]) out[k] = data[k];
    }));
  }

  if (token && (s.showContrib || s.showStreak)) {
    jobs.push(section('contrib', async () => {
      if (!login) throw loginError || fail('GitHub user name missing');
      const cal = await cached(K('contrib', login.toLowerCase()), ttl.contrib, async () => normCalendar((await graphql(ctx, CONTRIB_QUERY, { login })).user?.contributionsCollection?.contributionCalendar));
      const res = { total: cal.total };
      if (s.showContrib) Object.assign(res, contribGrid(cal.weeks, clamp(s.contribWeeks, 4, 53, 20)));
      if (s.showStreak) res.streak = streaks(cal.weeks.flat(), today);
      return res;
    }));
  }

  if (s.showActivity && repos.length) {
    jobs.push(section('activity', async () => {
      const res = await Promise.all(repos.map(async (r) => {
        try {
          return { list: await cached(K('events', r.full), ttl.events, async () => (await gh(ctx, `/repos/${r.full}/events?per_page=30`, { map: (x) => normEvents(x, r.name), priority: 'low' })).data) };
        } catch (err) {
          return { error: err };
        }
      }));
      allFailed(res);
      return res.flatMap((x) => x.list || []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, clamp(s.activityCount, 1, 20, 6));
    }));
  }

  if (s.showFollowers) {
    if (!login && !loginError) out.needsUser = true;
    else {
      jobs.push(section('followers', async () => {
        if (!login) throw loginError;
        const ukey = login.toLowerCase();
        const state = await cached(K('followers', ukey), ttl.followers, async () => {
          const u = (await gh(ctx, `/users/${login}`, { map: (x) => ({ followers: x.followers ?? 0 }), priority: 'low' })).data;
          const pages = [1];
          const last = Math.ceil(u.followers / 100);
          if (last > 1 && last <= 400) pages.push(last);
          const logins = [];
          for (const p of pages) logins.push(...(await gh(ctx, `/users/${login}/followers?per_page=100&page=${p}`, { map: (x) => (Array.isArray(x) ? x.map((f) => f.login) : []), priority: 'low' })).data);
          const { state: next } = diffFollowers(st.followers[ukey], logins, Date.now());
          st.followers[ukey] = { ...next, count: u.followers };
          saveSoon();
          return st.followers[ukey];
        });
        return { count: state.count, recent: (state.recent || []).slice(0, clamp(s.followersCount, 1, 10, 3)) };
      }));
    }
  }

  if (s.showStargazers && repos.length) {
    jobs.push(section('stargazers', async () => {
      needAll();
      const res = await Promise.all(repos.filter((r) => info.has(r.full)).map(async (r) => {
        const stars = info.get(r.full).stars;
        const page = Math.max(1, Math.ceil(stars / 100));
        if (!stars || page > 400) return { list: [] };
        try {
          const list = await cached(K('stargazers', r.full, page), ttl.stargazers, async () => {
            const get = async (p) => (await gh(ctx, `/repos/${r.full}/stargazers?per_page=100&page=${p}`, { accept: STAR_JSON, map: (x) => normStargazers(x).slice(-10), priority: 'low' })).data;
            const a = await get(page);
            return a.length >= 10 || page === 1 ? a : [...(await get(page - 1)), ...a].slice(-10);
          });
          return { list: list.map((x) => ({ ...x, repo: r.name })) };
        } catch (err) {
          return { error: err };
        }
      }));
      allFailed(res);
      return res.flatMap((x) => x.list || []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, clamp(s.stargazersCount, 1, 10, 3));
    }));
  }

  if (s.showSecurity && token && repos.length) {
    jobs.push(section('security', async () => {
      const res = await Promise.all(repos.map(async (r) => {
        try {
          const counts = await cached(K('dependabot', r.full), ttl.security, async () => (await gh(ctx, `/repos/${r.full}/dependabot/alerts?state=open&per_page=100`, { map: severityCounts })).data);
          return { repo: r.name, ...counts };
        } catch (err) {
          if (err.status === 403 || err.status === 404) return { repo: r.name, noAccess: true };
          return { repo: r.name, error: err };
        }
      }));
      allFailed(res);
      return res.map((x) => (x.error ? { repo: x.repo, error: msg(x.error) } : x));
    }));
  }

  await Promise.all(jobs);

  if (attempted && failed === attempted) {
    const err = new Error(msg(firstErr));
    err.msgId = firstErr.msgId;
    throw err;
  }

  const blocked = Math.max(blockedUntil(ctx.scope, 'core'), blockedUntil(ctx.scope, 'graphql'));
  if (blocked) out.notice = t('GitHub rate limit reached – trying again in {min} min', { min: Math.max(1, Math.ceil((blocked - Date.now()) / 60000)) });
  const core = limits.get(`${ctx.scope}:core`);
  if (core?.limit && core.remaining !== null) out.rate = { remaining: core.remaining, limit: core.limit };
  out.refresh = out.running && s.showRunning ? live : plan.refresh;
  if (!Object.keys(out.errors).length) delete out.errors;
  return out;
}

export const github = provider;
export { gh as _gh };

// For tests: forget ETags, rate-limit state and the loaded store.
export function _reset() {
  etags.clear();
  limits.clear();
  usage.clear();
  liveRuns.clear();
  store = null;
  storeFile = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}
