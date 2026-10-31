import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseRepos, lastPage, shiftKey, rateFromHeaders, budgetAllows, noteRequest, budgetUsed, planTtls, baseRefresh, BUDGET,
  recordStars, starDelta, starSeries, seedDays, diffFollowers, normRepo, normRelease, normCommits, runStatus, normRuns,
  normJobs, normEvents, normStargazers, severityCounts, normPr, normIssue, normCalendar, streaks, contribGrid, workQuery,
  repoQuery, normRepoGql, scopeOf, provider, flushStore, _reset, _gh,
} from '../src/providers/github.js';
import schema from '../public/shared/modules/github.js';
import { applyDefaults } from '../public/shared/modules.js';
import de from '../public/shared/locales/de/modules/github.js';
import core from '../public/shared/locales/de/index.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/github.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-31T12:00:00Z');
const TODAY = '2026-10-31';
const CFG = { general: { locale: 'en-GB', timezone: 'Europe/Berlin' } };
const settings = (extra) => applyDefaults(schema.fields, extra);

// Contribution calendar ending on TODAY (a Saturday): 5-day current streak,
// longest streak 11 days (Oct 10–20).
function calendar() {
  const weeks = [];
  let week = [];
  for (let i = 364; i >= 0; i--) {
    const date = shiftKey(TODAY, -i);
    const active = (date >= '2026-10-27') || (date >= '2026-10-10' && date <= '2026-10-20') || date === '2026-01-05' || date === '2025-12-30';
    const count = active ? 3 : 0;
    week.push({ date, contributionCount: count, contributionLevel: active ? 'SECOND_QUARTILE' : 'NONE' });
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === 6) {
      weeks.push({ contributionDays: week });
      week = [];
    }
  }
  if (week.length) weeks.push({ contributionDays: week });
  return { totalContributions: 999, weeks };
}

// ---- local GitHub stand-in -----------------------------------------------------------

let server;
let base;
const seen = [];

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const p = u.pathname.replace(/^\/x\d+/, ''); // per-test prefix → separate cache/budget scope
      seen.push({ method: req.method, path: p, query: u.search, headers: req.headers, body });
      const json = (status, data, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '55', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3000), 'x-ratelimit-resource': 'core', ...headers });
        res.end(status === 304 ? undefined : JSON.stringify(data));
      };
      const hw = '/repos/octocat/hello-world';
      if (req.method === 'POST' && p === '/graphql') {
        const q = JSON.parse(body).query;
        if (q.includes('repository(')) return json(200, F.gqlRepos, { 'x-ratelimit-resource': 'graphql', 'x-ratelimit-limit': '5000' });
        if (q.includes('search(')) return json(200, F.gqlWork, { 'x-ratelimit-resource': 'graphql', 'x-ratelimit-limit': '5000' });
        if (q.includes('contributionsCollection')) return json(200, { data: { user: { contributionsCollection: { contributionCalendar: calendar() } } } }, { 'x-ratelimit-resource': 'graphql' });
        return json(400, { message: 'bad query' });
      }
      if (p === hw) {
        if (req.headers['if-none-match'] === '"r1"') return json(304);
        return json(200, F.repo, { ETag: '"r1"' });
      }
      if (p === `${hw}/pulls`) return json(200, [{ number: 12 }], { Link: `<${base}${hw}/pulls?state=open&per_page=1&page=2>; rel="next", <${base}${hw}/pulls?state=open&per_page=1&page=3>; rel="last"` });
      if (p === `${hw}/actions/runs`) return json(200, F.runs);
      if (p === `${hw}/actions/runs/905/jobs`) return json(200, F.jobs);
      if (p === `${hw}/releases`) return json(200, F.releases);
      if (p === '/repos/home-assistant/core/releases') return json(200, [{ tag_name: '2026.10.4', name: '2026.10.4', draft: false, prerelease: false, created_at: '2026-10-31T06:00:00Z', published_at: '2026-10-31T06:10:00Z' }]);
      if (p === `${hw}/commits`) return json(200, F.commits);
      if (p === `${hw}/events`) return json(200, F.events);
      if (p === `${hw}/stargazers`) return json(200, req.headers.accept?.includes('star+json') ? F.stargazers : F.stargazers.map((x) => x.user));
      if (p === `${hw}/dependabot/alerts`) return json(200, F.dependabot);
      if (p === '/repos/octocat/missing/dependabot/alerts') return json(404, { message: 'Not Found' });
      if (p === '/user') return json(200, { login: 'octocat', id: 1 });
      if (p === '/users/octocat') return json(200, { login: 'octocat', followers: 2 });
      if (p === '/users/octocat/followers') return json(200, [{ login: 'alice' }, { login: 'bob' }]);
      if (p.startsWith('/repos/limited/')) return json(403, { message: 'API rate limit exceeded for 1.2.3.4.' }, { 'x-ratelimit-remaining': '0' });
      return json(404, { message: 'Not Found' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());
beforeEach(() => _reset());

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gh-')), 'github.json');
let prefix = 0;
const apiUrl = () => `${base}/x${++prefix}`;

// ---- helpers -----------------------------------------------------------------------

test('parseRepos accepts owner/name and URLs, drops duplicates and junk', () => {
  const r = parseRepos([{ repo: 'octocat/Hello-World' }, { repo: 'https://github.com/home-assistant/core.git', name: 'HA' }, { repo: 'octocat/hello-world' }, { repo: 'nope' }, { repo: '' }]);
  assert.deepEqual(r, [{ full: 'octocat/Hello-World', name: 'Hello-World', branch: '' }, { full: 'home-assistant/core', name: 'HA', branch: '' }]);
});

test('lastPage reads rel="last" from the Link header', () => {
  assert.equal(lastPage('<https://api.github.com/x?per_page=1&page=2>; rel="next", <https://api.github.com/x?per_page=1&page=17>; rel="last"'), 17);
  assert.equal(lastPage(''), null);
});

// ---- normalisers -------------------------------------------------------------------

test('normRepo keeps only the needed fields', () => {
  assert.deepEqual(normRepo(F.repo), { full: 'octocat/hello-world', stars: 42, forks: 5, openIssues: 7, pushedAt: '2026-10-31T09:12:44Z', defaultBranch: 'main', archived: false });
});

test('normRelease skips drafts and (optionally) pre-releases', () => {
  assert.deepEqual(normRelease(F.releases), { tag: 'v1.2.0', name: 'Spooky release', at: '2026-10-28T10:30:00Z', pre: false });
  assert.equal(normRelease(F.releases, true).tag, 'v1.3.0-rc.1');
  assert.equal(normRelease([]), null);
});

test('normCommits: first message line, login or author name', () => {
  const c = normCommits(F.commits);
  assert.deepEqual(c[0], { sha: '6dcb09b', msg: 'Fix the flux capacitor', author: 'octocat', at: '2026-10-31T09:12:00Z' });
  assert.equal(c[1].author, 'Jane Doe');
});

test('runStatus maps status/conclusion to the traffic light', () => {
  const m = (status, conclusion) => runStatus({ status, conclusion });
  assert.equal(m('in_progress', null), 'running');
  for (const s of ['queued', 'waiting', 'requested', 'pending']) assert.equal(m(s, null), 'queued');
  assert.equal(m('completed', 'success'), 'success');
  for (const c of ['failure', 'timed_out', 'startup_failure']) assert.equal(m('completed', c), 'failure');
  assert.equal(m('completed', 'cancelled'), 'cancelled');
  assert.equal(m('completed', 'action_required'), 'action');
  for (const c of ['skipped', 'neutral', 'stale', null]) assert.equal(m('completed', c), 'skipped');
});

test('normRuns: latest run per workflow on the branch, plus active runs', () => {
  const r = normRuns(F.runs, 'main');
  assert.deepEqual(r.builds.map((b) => [b.workflow, b.status]), [['CI', 'running'], ['Deploy', 'failure'], ['CodeQL', 'cancelled']]);
  assert.equal(r.builds[1].duration, 265);
  assert.equal(r.builds[0].duration, null);
  assert.deepEqual(r.active.map((a) => [a.id, a.status, a.branch]), [[905, 'running', 'main'], [904, 'queued', 'feature-x']]);
  // No run on that branch → any branch.
  assert.equal(normRuns(F.runs, 'gone').builds.length, 3);
  assert.equal(normRuns(F.runs, 'main', 1).builds.length, 1);
});

test('normJobs counts jobs and steps and names the current step', () => {
  assert.deepEqual(normJobs(F.jobs), { jobsDone: 1, jobsTotal: 2, stepsDone: 3, stepsTotal: 5, current: 'Run tests' });
});

test('normEvents turns repository events into activity lines', () => {
  const e = normEvents(F.events, 'Hello');
  assert.deepEqual(e.map((x) => x.kind), ['star', 'pr', 'issue', 'comment', 'push', 'release', 'review', 'push']);
  assert.equal(e[1].action, 'merged');
  assert.equal(e[1].n, 12);
  assert.equal(e[3].pr, true);
  assert.equal(e[4].branch, 'main');
  assert.equal(e[4].n, null, 'newer PushEvents carry no size');
  assert.equal(e[7].n, 3);
  assert.equal(e[6].state, 'approved');
  assert.equal(e[0].repo, 'Hello');
});

test('stargazers and Dependabot severities', () => {
  assert.deepEqual(normStargazers(F.stargazers).at(-1), { login: 'carol', at: '2026-10-31T07:00:00Z' });
  assert.deepEqual(normStargazers([{ login: 'x' }]), [], 'without star+json there are no timestamps');
  assert.deepEqual(severityCounts(F.dependabot), { critical: 1, high: 1, medium: 2, low: 1, total: 5 });
  assert.equal(severityCounts([{ security_advisory: { severity: 'moderate' } }]).medium, 1);
});

test('GraphQL pull requests and issues', () => {
  const [a, b] = F.gqlWork.data.myPrs.nodes.map(normPr);
  assert.deepEqual(a, { repo: 'octocat/hello-world', n: 12, title: 'Add dark mode', draft: false, review: 'approved', checks: 'success', at: '2026-10-29T10:00:00Z', updatedAt: '2026-10-31T08:00:00Z' });
  assert.equal(b.review, 'required');
  assert.equal(b.checks, null);
  assert.equal(b.draft, true);
  const r = normPr(F.gqlWork.data.reviews.nodes[0]);
  assert.equal(r.review, 'changes');
  assert.equal(r.checks, 'failure');
  const i = normIssue(F.gqlWork.data.issues.nodes[0]);
  assert.deepEqual(i.labels, [{ name: 'bug', color: 'd73a4a' }, { name: 'help wanted', color: '008672' }]);
  assert.equal(normIssue({ number: 1, labels: { nodes: [{ name: 'x', color: 'javascript:' }] } }).labels[0].color, '888888');
});

test('GraphQL queries only contain the requested parts', () => {
  const q = workQuery({ prs: true, reviews: false, issues: true });
  assert.match(q, /myPrs: search/);
  assert.doesNotMatch(q, /reviews:/);
  assert.match(q, /\$qIssues: String!/);
  const { query, variables } = repoQuery(parseRepos([{ repo: 'octocat/hello-world' }, { repo: 'a/b' }]));
  assert.match(query, /r1: repository\(owner: \$o1, name: \$n1\)/);
  assert.deepEqual(variables, { o0: 'octocat', n0: 'hello-world', o1: 'a', n1: 'b' });
  assert.deepEqual(normRepoGql(F.gqlRepos.data.r0), { full: 'octocat/hello-world', stars: 42, forks: 5, issues: 4, prs: 3, openIssues: 7, pushedAt: '2026-10-31T09:12:44Z', defaultBranch: 'main', archived: false });
  assert.equal(normRepoGql(null), null);
});

// ---- contributions -----------------------------------------------------------------

test('streaks: current (today may still be empty), longest, this year', () => {
  const cal = normCalendar(calendar());
  const days = cal.weeks.flat();
  assert.equal(cal.total, 999);
  assert.equal(days.length, 365);
  assert.deepEqual(streaks(days, TODAY), { current: 5, longest: 11, thisYear: (5 + 11 + 1) * 3 });
  // Nothing yet today → the streak up to yesterday still counts.
  const noToday = days.map((d) => (d.date === TODAY ? { ...d, count: 0 } : d));
  assert.equal(streaks(noToday, TODAY).current, 4);
  // A gap yesterday as well → broken.
  const broken = noToday.map((d) => (d.date === '2026-10-30' ? { ...d, count: 0 } : d));
  assert.equal(streaks(broken, TODAY).current, 0);
  assert.deepEqual(streaks([], TODAY), { current: 0, longest: 0, thisYear: 0 });
});

test('contribGrid: last n weeks as level strings', () => {
  const cal = normCalendar(calendar());
  const g = contribGrid(cal.weeks, 4);
  assert.equal(g.weeks.length, 4);
  assert.equal(g.offset, 0, 'a full week starts on Sunday');
  assert.equal(g.weeks.at(-1), '0022222');
  const all = contribGrid(cal.weeks, 60);
  assert.equal(all.weeks.length, cal.weeks.length);
  assert.equal(all.offset, new Date(`${cal.weeks[0][0].date}T12:00:00Z`).getUTCDay());
});

// ---- stars & followers -------------------------------------------------------------

test('star snapshots: record, prune, delta and series', () => {
  const e = {};
  assert.equal(recordStars(e, '2026-10-20', 10), true);
  assert.equal(recordStars(e, '2026-10-20', 10), false);
  recordStars(e, '2026-10-24', 12);
  recordStars(e, '2026-10-30', 15);
  recordStars(e, TODAY, 18);
  assert.equal(starDelta(e.days, TODAY, 1), 3);
  assert.equal(starDelta(e.days, TODAY, 7), 6);
  // History shorter than a week → oldest earlier snapshot.
  assert.equal(starDelta({ '2026-10-29': 4, [TODAY]: 9 }, TODAY, 7), 5);
  assert.equal(starDelta({ [TODAY]: 9 }, TODAY, 1), null);
  assert.equal(starDelta({}, TODAY, 7), null);
  assert.deepEqual(starSeries(e.days, TODAY, 3), [12, 15, 18]);
  const s = starSeries(e.days, TODAY, 14);
  assert.equal(s.length, 14);
  assert.equal(s[0], null);
  assert.equal(s.at(-1), 18);
  recordStars(e, '2027-06-01', 20, 120);
  assert.deepEqual(Object.keys(e.days), ['2027-06-01'], 'old snapshots are pruned');
});

test('seedDays builds cumulative counts from stargazer timestamps', () => {
  const d = seedDays(F.stargazers.map((x) => x.starred_at), TODAY, 'Europe/Berlin', 10);
  assert.equal(Object.keys(d).length, 10);
  assert.equal(d['2026-10-24'], 1);
  assert.equal(d['2026-10-25'], 2);
  assert.equal(d[TODAY], 3);
});

test('diffFollowers: baseline first, then new logins with time', () => {
  const a = diffFollowers(undefined, ['alice', 'bob'], NOW);
  assert.deepEqual(a.added, []);
  assert.deepEqual(a.state.recent, []);
  const b = diffFollowers(a.state, ['carol', 'alice', 'bob'], NOW + 1000);
  assert.deepEqual(b.added, ['carol']);
  assert.deepEqual(b.state.recent, [{ login: 'carol', at: new Date(NOW + 1000).toISOString() }]);
  // Someone who unfollowed and refollows is not "new" again.
  const c = diffFollowers(b.state, ['carol', 'alice'], NOW + 2000);
  assert.deepEqual(c.added, []);
  assert.ok(c.state.known.includes('bob'));
});

// ---- rate limits & budget ----------------------------------------------------------

test('rateFromHeaders: remaining, reset and back-off', () => {
  const h = (o) => new Headers(o);
  const ok = rateFromHeaders(h({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': '1793450000', 'x-ratelimit-resource': 'core' }), 200, NOW);
  assert.deepEqual(ok, { resource: 'core', limit: 60, remaining: 12, reset: 1793450000000, blockedUntil: 0 });
  const empty = rateFromHeaders(h({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1793450000' }), 403, NOW);
  assert.equal(empty.blockedUntil, 1793450000000);
  const secondary = rateFromHeaders(h({ 'retry-after': '90', 'x-ratelimit-remaining': '30' }), 403, NOW);
  assert.equal(secondary.blockedUntil, NOW + 90000);
  assert.equal(rateFromHeaders(h({}), 200, NOW), null);
});

test('budget: lower priorities stop earlier; anonymous 40/h, token 3000/h', () => {
  const scope = 'test-budget';
  for (let i = 0; i < 24; i++) noteRequest(scope, NOW);
  assert.equal(budgetUsed(scope, NOW), 24);
  assert.equal(budgetAllows(scope, 'low', { now: NOW }), false);
  assert.equal(budgetAllows(scope, 'normal', { now: NOW }), true);
  for (let i = 0; i < 10; i++) noteRequest(scope, NOW);
  assert.equal(budgetAllows(scope, 'normal', { now: NOW }), false);
  assert.equal(budgetAllows(scope, 'high', { now: NOW }), true);
  for (let i = 0; i < 6; i++) noteRequest(scope, NOW);
  assert.equal(budgetAllows(scope, 'high', { now: NOW }), false);
  assert.equal(budgetAllows(scope, 'high', { now: NOW, token: true }), true);
  // An hour later the window is empty again.
  assert.equal(budgetAllows(scope, 'low', { now: NOW + 3600001 }), true);
  // GitHub's own counter (shared with everything else on this IP) is respected too.
  const rate = (remaining) => ({ remaining, limit: 60, reset: NOW + 60000 });
  assert.equal(budgetAllows('fresh', 'low', { now: NOW, rate: rate(15) }), false);
  assert.equal(budgetAllows('fresh', 'normal', { now: NOW, rate: rate(15) }), true);
  assert.equal(budgetAllows('fresh', 'normal', { now: NOW, rate: rate(5) }), false);
  assert.equal(budgetAllows('fresh', 'high', { now: NOW, rate: rate(5) }), true);
  assert.equal(budgetAllows('fresh', 'high', { now: NOW, rate: rate(1) }), false);
  assert.equal(BUDGET.anon, 40);
});

test('planTtls: automatic intervals and stretching to the budget', () => {
  assert.equal(baseRefresh({ refreshMinutes: 0 }, false), 900);
  assert.equal(baseRefresh({ refreshMinutes: 0 }, true), 300);
  assert.equal(baseRefresh({ refreshMinutes: 1 }, false), 120);
  const s = settings({});
  // Defaults, no token, one repository: repo + PR count + runs every 15 min, releases hourly.
  const one = planTtls(s, { repos: 1 });
  assert.equal(one.refresh, 900);
  assert.equal(one.factor, 1);
  assert.equal(one.perHour, 13);
  // Ten repositories with everything public switched on → stretched to stay at 40/h.
  const all = settings({ showCommits: true, showActivity: true, showStargazers: true, showFollowers: true });
  const many = planTtls(all, { repos: 10, followed: 5, user: true });
  assert.ok(many.factor > 1);
  const calls = { repo: 10, pulls: 10, runs: 10, commits: 10, events: 10, releases: 15, stargazers: 10, followers: 2 };
  const effective = Object.entries(calls).reduce((sum, [k, n]) => sum + (n * 3600) / many.ttl[k], 0);
  assert.ok(effective <= 41, `effective ${effective}`);
  // With a token: 5 min, overview via one GraphQL query, no stretching.
  const tok = planTtls(all, { token: true, repos: 10, followed: 5, user: true });
  assert.equal(tok.refresh, 300);
  assert.equal(tok.factor, 1);
  assert.ok(tok.perHour < 3000);
  // GitHub reports < 20 % left → twice as slow.
  const low = planTtls(s, { repos: 1 }, { limit: 60, remaining: 5, reset: NOW + 1000 }, NOW);
  assert.equal(low.ttl.repo, 1800);
});

test('conditional requests: the second request sends If-None-Match and reuses the body', async () => {
  const api = apiUrl();
  const ctx = { api, graphqlUrl: `${api}/graphql`, token: '', scope: scopeOf(api, ''), fetch };
  const a = await _gh(ctx, '/repos/octocat/hello-world', { map: normRepo });
  const b = await _gh(ctx, '/repos/octocat/hello-world', { map: normRepo });
  assert.equal(b.notModified, true);
  assert.deepEqual(b.data, a.data);
  const reqs = seen.filter((r) => r.path === '/repos/octocat/hello-world').slice(-2);
  assert.equal(reqs[1].headers['if-none-match'], '"r1"');
  assert.equal(reqs[0].headers['user-agent'], 'MagicMirror');
  assert.equal(reqs[0].headers['x-github-api-version'], '2022-11-28');
  assert.equal(reqs[0].headers.accept, 'application/vnd.github+json');
  assert.equal(reqs[0].headers.authorization, undefined);
});

// ---- provider ----------------------------------------------------------------------

test('provider without setup asks for it', async () => {
  const d = await provider(settings({}), CFG, { id: 'g0' }, { api: apiUrl(), dataFile: tmpFile() });
  assert.equal(d.needsSetup, true);
});

test('provider without token: public sections, frugal, token sections only hinted', async () => {
  const api = apiUrl();
  const file = tmpFile();
  const start = seen.length;
  const s = settings({
    username: 'octocat',
    repos: [{ repo: 'octocat/hello-world', name: 'Hello' }],
    followed: [{ repo: 'home-assistant/core', name: 'Home Assistant' }],
    showCommits: true, showActivity: true, showFollowers: true, showStargazers: true, showSecurity: true,
  });
  const d = await provider(s, CFG, { id: 'g1' }, { api, dataFile: file, now: NOW });
  const reqs = seen.slice(start);
  assert.ok(reqs.every((r) => !r.headers.authorization));
  assert.ok(reqs.every((r) => r.path !== '/graphql'), 'no GraphQL without a token');
  assert.ok(reqs.length <= 12, `${reqs.length} requests`);
  assert.equal(d.mode, 'public');
  assert.equal(d.needsToken, true);
  assert.equal(d.errors, undefined);
  assert.equal(d.myPrs, undefined);
  assert.equal(d.security, undefined);

  const o = d.overview[0];
  assert.equal(o.name, 'Hello');
  assert.equal(o.stars, 42);
  assert.equal(o.prs, 3);
  assert.equal(o.issues, 4);
  assert.equal(o.delta, 41, 'seeded from the stargazer timestamps');
  assert.ok(o.series.length === 56 && o.series.at(-1) === 42);

  assert.deepEqual(d.builds.map((b) => b.status), ['running', 'failure', 'cancelled']);
  assert.equal(d.failedBuilds, 1);
  assert.equal(d.running, 2);
  assert.equal(d.active[0].jobsTotal, undefined, 'job progress needs a token');
  assert.equal(d.refresh, 120, 'running workflows at most every 2 minutes without token');

  assert.deepEqual(d.releases.map((r) => [r.repo, r.tag, r.own]), [['Home Assistant', '2026.10.4', false], ['Hello', 'v1.2.0', true]]);
  assert.equal(d.commits[0].commits[0].msg, 'Fix the flux capacitor');
  assert.equal(d.activity[0].kind, 'star');
  assert.equal(d.stargazers[0].login, 'carol');
  assert.deepEqual(d.followers, { count: 2, recent: [] });
  assert.equal(JSON.stringify(d).includes('starred_at'), false, 'only trimmed data goes to the mirror');

  await flushStore();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.stars['octocat/hello-world'].days[TODAY], 42);
  assert.equal(saved.stars['octocat/hello-world'].seeded, true);
  assert.deepEqual(saved.followers.octocat.known, ['alice', 'bob']);

  // The condition "only show when a build failed".
  const condition = (x) => (x.failedBuilds || 0) > 0;
  assert.equal(condition(d), true);
  assert.equal(condition({ failedBuilds: 0 }), false);
});

test('provider without token postpones low-priority requests when the budget runs low', async () => {
  const api = apiUrl();
  for (let i = 0; i < 24; i++) noteRequest(scopeOf(api, ''));
  const s = settings({ repos: [{ repo: 'octocat/hello-world' }], showActivity: true, showStarHistory: false, showReleases: false });
  const start = seen.length;
  const d = await provider(s, CFG, { id: 'g2' }, { api, dataFile: tmpFile(), now: NOW });
  const paths = seen.slice(start).map((r) => r.path);
  assert.ok(paths.includes('/repos/octocat/hello-world'));
  assert.ok(paths.includes('/repos/octocat/hello-world/actions/runs'));
  assert.ok(!paths.includes('/repos/octocat/hello-world/events'));
  assert.ok(!paths.includes('/repos/octocat/hello-world/pulls'));
  assert.equal(d.deferred, true);
  assert.equal(d.errors, undefined, 'postponed is not an error');
  assert.equal(d.overview[0].prs, null);
  assert.equal(d.overview[0].issues, 7, 'issues + PRs combined without the extra request');
});

test('provider with token: GraphQL overview, PRs, reviews, issues, contributions, security', async () => {
  const api = apiUrl();
  const start = seen.length;
  const s = settings({
    token: 'tok-secret-1',
    repos: [{ repo: 'octocat/hello-world', name: 'Hello' }, { repo: 'octocat/missing' }],
    showSecurity: true, showFollowers: true,
  });
  const d = await provider(s, CFG, { id: 'g3' }, { api, dataFile: tmpFile(), now: NOW });
  const reqs = seen.slice(start);
  assert.ok(reqs.every((r) => r.headers.authorization === 'Bearer tok-secret-1'));
  assert.ok(!reqs.some((r) => r.path === '/repos/octocat/hello-world'), 'overview comes from GraphQL');
  assert.ok(!reqs.some((r) => r.path.endsWith('/pulls')));
  assert.equal(JSON.stringify(d).includes('tok-secret-1'), false);
  assert.equal(d.mode, 'token');
  assert.equal(d.needsToken, undefined);

  assert.equal(d.overview[0].prs, 3);
  assert.equal(d.overview[0].issues, 4);
  assert.deepEqual(Object.keys(d.repoErrors), ['missing']);
  assert.deepEqual(d.active[0], { repo: 'Hello', workflow: 'CI', branch: 'main', event: 'push', title: 'Fix the flux capacitor', status: 'running', startedAt: '2026-10-31T09:12:52Z', jobsDone: 1, jobsTotal: 2, stepsDone: 3, stepsTotal: 5, current: 'Run tests' });
  assert.equal(d.refresh, 30);
  assert.equal(d.myPrs.total, 2);
  assert.deepEqual(d.myPrs.items.map((p) => [p.review, p.checks]), [['approved', 'success'], ['required', null]]);
  assert.equal(d.reviews.items[0].review, 'changes');
  assert.equal(d.issues.items[0].labels[0].name, 'bug');
  assert.equal(d.contrib.weeks.length, 20);
  assert.deepEqual(d.contrib.streak, { current: 5, longest: 11, thisYear: 51 });
  assert.deepEqual(d.security, [{ repo: 'Hello', critical: 1, high: 1, medium: 2, low: 1, total: 5 }, { repo: 'missing', noAccess: true }]);
  assert.deepEqual(d.followers, { count: 2, recent: [] });
  assert.ok(reqs.some((r) => r.path === '/user'), 'user name from the token');
  const work = reqs.find((r) => r.body.includes('search('));
  assert.match(JSON.parse(work.body).variables.qPrs, /author:octocat/);
});

test('rate limit: back off without further requests, translated message', async () => {
  const api = apiUrl();
  const s = settings({ repos: [{ repo: 'limited/x' }], showStarHistory: false });
  await assert.rejects(provider(s, CFG, { id: 'g4' }, { api, dataFile: tmpFile(), now: NOW }), /rate limit reached – trying again in \d+ min/);
  const n = seen.length;
  await assert.rejects(provider(s, CFG, { id: 'g4' }, { api, dataFile: tmpFile(), now: NOW }), /rate limit/);
  assert.equal(seen.length, n, 'blocked until the reset – no requests');
});

// ---- schema & translations -----------------------------------------------------------

test('schema defaults', () => {
  const s = settings({});
  assert.equal(s.token, '');
  assert.equal(s.refreshMinutes, 0);
  assert.equal(s.layout, 'list');
  assert.equal(s.liveSeconds, 30);
  assert.deepEqual(s.repos, []);
  assert.equal(schema.fields.find((f) => f.key === 'token').secret, true);
});

test('every schema, renderer and provider string has a German translation; keys sorted', () => {
  const ids = new Set([schema.label, schema.description, schema.defaultTitle]);
  const walk = (fields) => {
    for (const f of fields) {
      for (const k of ['label', 'help', 'itemLabel']) if (f[k]) ids.add(f[k]);
      for (const o of f.options || []) ids.add(o.label);
      if (f.fields) walk(f.fields);
    }
  };
  walk(schema.fields);
  for (const file of ['../public/mirror/modules/github.js', '../src/providers/github.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\b(?:t|fail)\('([^']+)'/g)) ids.add(m[1]);
  }
  const missing = [...ids].filter((id) => !(id in de) && !(id in core));
  assert.deepEqual(missing, []);
  const keys = Object.keys(de);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  // Placeholders survive the translation.
  for (const [k, v] of Object.entries(de)) {
    const ph = (x) => (x.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(v), ph(k), k);
  }
});

test('activity: repeated events in a row are grouped', async () => {
  const { groupEvents } = await import('../src/providers/github.js');
  const ev = (kind, actor, extra = {}) => ({ repo: 'MM', kind, actor, at: '2026-10-29T22:00:00Z', ...extra });
  const out = groupEvents([
    ev('push', 'a', { branch: 'main', n: 2 }), ev('push', 'a', { branch: 'main', n: 1 }), ev('push', 'a', { branch: 'main', n: null }),
    ev('star', 'x'), ev('star', 'y'), ev('star', 'x'),
    ev('push', 'b', { branch: 'main' }),
  ]);
  assert.deepEqual(out.map((e) => [e.kind, e.times]), [['push', 3], ['star', 3], ['push', 1]]);
  assert.equal(out[0].n, 3);
  assert.deepEqual(out[1].actors, ['x', 'y']);
});
