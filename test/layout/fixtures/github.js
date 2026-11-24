// GitHub tracker with a token (provider() in src/providers/github.js): overview with star
// history, running workflow, builds, releases, pull requests, reviews, issues and the
// contribution graph. Sections that are off by default (commits, activity, followers,
// stargazers, security) follow the settings – and are all on in the "long" stress version.
import { iso, addMin, addDays, dayKey, LONG } from './index.js';

const clamp = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
};

export default ({ now, settings, long }) => {
  const s = settings;
  const ago = (m) => iso(addMin(now, -m));
  const H = 60;
  const D = 24 * 60;
  const on = (k) => long || s[k];
  const out = { mode: 'token', failedBuilds: 0, running: 0, refresh: 0 };

  // ---- overview + star history
  const days = clamp(s.starWeeks, 2, 16, 8) * 7;
  const series = (from, to) => Array.from({ length: days }, (_, i) => Math.round(from + ((to - from) * i * i) / ((days - 1) * (days - 1)) + ((i * 7) % 5)));
  const repos = long
    ? [
      { name: `yannic/${LONG}-magicmirror-fuer-den-flur`, stars: 123456, forks: 9876, issues: 1234, prs: 567, delta: 2345, from: 98000, pushedAt: ago(4), archived: false },
      { name: 'leipzig-open-data/haltestellen-abfahrtsmonitor-lvb-mdv', stars: 98765, forks: 12345, issues: 23456, prs: 3456, delta: 789, from: 91000, pushedAt: ago(3 * D), archived: false },
      { name: 'yannic/dotfiles', stars: 12, forks: 0, issues: 0, prs: 0, delta: 0, from: 12, pushedAt: ago(420 * D), archived: true },
    ]
    : [
      { name: 'magicmirror', stars: 1284, forks: 97, issues: 23, prs: 4, delta: 38, from: 1050, pushedAt: ago(35), archived: false },
      { name: 'ha-sensoren', stars: 312, forks: 18, issues: 6, prs: 1, delta: 5, from: 280, pushedAt: ago(2 * D + 3 * H), archived: false },
    ];
  if (s.showOverview || s.showStarHistory) {
    out.overview = repos.map((r) => {
      const item = { name: r.name, stars: r.stars, forks: r.forks, pushedAt: r.pushedAt, archived: r.archived };
      if (s.showOverview) {
        item.prs = r.prs;
        item.issues = r.issues;
        if (s.starDelta === 'day' || s.starDelta === 'week') item.delta = r.delta;
      }
      if (s.showStarHistory) {
        const ser = series(r.from, r.stars);
        ser[ser.length - 1] = r.stars;
        item.series = ser;
      }
      return item;
    });
  }

  // ---- builds + running workflows
  const repoName = (i) => repos[Math.min(i, repos.length - 1)].name;
  const builds = [
    { repo: repoName(0), workflow: 'CI', status: 'running', startedAt: ago(3.5), duration: null, branch: 'main' },
    { repo: repoName(0), workflow: 'Docker-Image bauen', status: 'success', startedAt: ago(2 * H), duration: 412, branch: 'main' },
    { repo: repoName(0), workflow: 'Shellcheck', status: 'success', startedAt: ago(2 * H), duration: 38, branch: 'main' },
    { repo: repoName(1), workflow: 'Tests', status: 'failure', startedAt: ago(5 * H), duration: 127, branch: 'main' },
    { repo: repoName(1), workflow: 'Release', status: 'success', startedAt: ago(3 * D), duration: 254, branch: 'main' },
  ];
  if (long) {
    builds.push(
      { repo: repoName(2), workflow: `Nightly ${LONG} Integrationstests (Matrix: Node 20/22, arm64/amd64)`, status: 'action', startedAt: ago(9 * H), duration: 98765, branch: 'renovate/major-alle-abhaengigkeiten-aktualisieren' },
      { repo: repoName(2), workflow: 'CodeQL', status: 'cancelled', startedAt: ago(26 * H), duration: 61, branch: 'main' },
      { repo: repoName(1), workflow: 'Deploy', status: 'queued', startedAt: null, duration: null, branch: 'main' },
    );
  }
  out.failedBuilds = builds.filter((b) => b.status === 'failure').length;
  const active = [
    { repo: repoName(0), workflow: 'CI', branch: 'main', event: 'push', title: 'Wetter: Regenzeile ausgerichtet', status: 'running', startedAt: ago(3.5), jobsDone: 2, jobsTotal: 4, stepsDone: 17, stepsTotal: 31, current: 'Layout-Tests (WebKit)' },
  ];
  if (long) {
    active.push(
      { repo: repoName(1), workflow: `Deploy auf den Raspberry Pi im Flur – ${LONG}`, branch: 'feature/sehr-langer-branch-name-fuer-den-abfahrtsmonitor', event: 'workflow_dispatch', title: 'Deploy', status: 'running', startedAt: ago(61), jobsDone: 11, jobsTotal: 12, stepsDone: 123, stepsTotal: 130, current: 'docker buildx build --platform linux/arm64,linux/amd64 --push' },
      { repo: repoName(1), workflow: 'Deploy', branch: 'main', event: 'push', title: 'Deploy', status: 'queued', startedAt: null },
      { repo: repoName(2), workflow: 'Pages', branch: 'gh-pages', event: 'push', title: 'Pages', status: 'queued', startedAt: null },
    );
  }
  out.running = active.length;
  if (s.showRunning) out.active = active;
  if (s.showBuilds) out.builds = builds;

  // ---- releases
  if (s.showReleases) {
    out.releaseNewDays = clamp(s.releaseNewDays, 0, 90, 7);
    const rel = [
      { repo: repoName(0), own: true, tag: 'v2.14.0', name: 'Layout-Editor: Breite und Höhe pro Seite', at: ago(2 * D), pre: false },
      { repo: 'Home Assistant', own: false, tag: '2026.11.3', name: '', at: ago(4 * D + 6 * H), pre: false },
      { repo: repoName(1), own: true, tag: 'v0.9.2', name: 'Fehlerbehebungen für Zigbee-Sensoren', at: ago(19 * D), pre: false },
      { repo: 'Zigbee2MQTT', own: false, tag: '2.6.1', name: '', at: ago(26 * D), pre: false },
    ];
    if (long) {
      for (let i = 0; i < 11; i++) rel.push({ repo: i % 2 ? repoName(1) : `Followed-Repository-${LONG}`, own: i % 2 === 1, tag: `v${10 + i}.${i * 3}.${123 + i}-beta.${i + 1}`, name: `Vorabversion mit vielen Änderungen am ${LONG}`.slice(0, 60), at: ago((30 + i * 9) * D), pre: true });
    }
    out.releases = rel.slice(0, long ? 15 : clamp(s.releasesCount, 1, 15, 4));
  }

  // ---- commits
  if (on('showCommits')) {
    const n = long ? 10 : clamp(s.commitsCount, 1, 10, 3);
    const msgs = ['Maps: kein heller Blitz mehr beim Nachladen der Kacheln', 'Now playing: Cover erst nach dem Laden tauschen', 'Wetter: Regenzeile wie die Zeilen darüber ausrichten', 'Aufgaben: überfällige Erinnerungen zeigen, wie lange sie her sind', 'Layout: Breite und Höhe pro Seite im Layout-Editor', `Refactoring des ${LONG}-Moduls`, 'Abhängigkeiten aktualisiert', 'Tests für den Pollenflug-Index', 'Übersetzungen ergänzt', 'Typo im README'];
    out.commits = repos.slice(0, long ? 2 : repos.length).map((r, ri) => ({
      repo: r.name,
      commits: Array.from({ length: n }, (_, i) => ({ sha: (0x7b28cd7 + ri * 977 + i * 4099).toString(16).slice(0, 7), msg: msgs[(i + ri) % msgs.length], author: ri ? 'anna-schmidt' : 'yannic', at: ago(40 + i * 190 + ri * 600) })),
    }));
  }

  // ---- my PRs, reviews, issues
  const pr = (repo, n, title, extra, at) => ({ repo, n, title, draft: false, review: null, checks: null, at: ago(at * 2), updatedAt: ago(at), ...extra });
  if (s.showMyPrs) {
    const items = [
      pr('yannic/magicmirror', 412, 'Kalender: Ganztagstermine über mehrere Tage', { review: 'approved', checks: 'success' }, 50),
      pr('home-assistant/core', 128734, 'Add Leipzig LVB departures sensor', { review: 'required', checks: 'pending' }, 6 * H),
      pr('yannic/ha-sensoren', 37, 'Feuchtigkeitssensor im Keller', { draft: true, checks: 'failure' }, 3 * D),
    ];
    if (long) for (let i = 0; i < 17; i++) items.push(pr(`leipzig-open-data/${LONG}`, 98765 + i, `Sehr langer Titel eines Pull Requests über ${LONG} und noch viel mehr Text`.slice(0, 80), { review: ['changes', 'required', 'approved'][i % 3], checks: ['failure', 'success', 'pending'][i % 3], draft: i % 4 === 0 }, (i + 4) * D));
    out.myPrs = { total: long ? 123 : items.length, items };
  }
  if (s.showReviews) {
    const items = [
      pr('anna-schmidt/einkaufsliste', 9, 'Kategorien für Supermarkt-Gänge', { review: 'required', checks: 'success' }, 95),
      pr('yannic/magicmirror', 415, 'Transit: Verspätungen farbig hervorheben', { review: 'changes', checks: 'success' }, 22 * H),
    ];
    if (long) for (let i = 0; i < 18; i++) items.push(pr('leipzig-open-data/haltestellen-abfahrtsmonitor-lvb-mdv', 23456 + i, `Bitte prüfen: ${LONG} – Umstellung der Haltestellenliste`, { review: 'required', checks: 'pending' }, (i + 2) * D));
    out.reviews = { total: long ? 4567 : items.length, items };
  }
  if (s.showIssues) {
    const items = [
      { repo: 'yannic/magicmirror', n: 398, title: 'Kiosk-Browser friert nach Bildschirmschoner ein', labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'raspberry-pi', color: 'c5def5' }], at: ago(5 * D) },
      { repo: 'yannic/ha-sensoren', n: 31, title: 'Batteriestand der Fensterkontakte anzeigen', labels: [{ name: 'enhancement', color: 'a2eeef' }], at: ago(12 * D) },
    ];
    if (long) for (let i = 0; i < 18; i++) items.push({ repo: `yannic/${LONG}-magicmirror-fuer-den-flur`, n: 12345 + i, title: `Fehler im ${LONG} bei sehr langen Haltestellennamen`, labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'needs-triage-and-reproduction', color: 'fbca04' }, { name: 'help wanted', color: '008672' }, { name: 'good first issue', color: '7057ff' }], at: ago((i + 1) * 30 * D) });
    out.issues = { total: long ? 23456 : items.length, items };
  }

  // ---- contributions
  if (s.showContrib || s.showStreak) {
    const weeksN = long ? 53 : clamp(s.contribWeeks, 4, 53, 20);
    const today = dayKey(now);
    const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
    const first = dayKey(addDays(now, -(weeksN - 1) * 7 - wd));
    const res = { total: long ? 12345 : 1873 };
    if (s.showContrib || long) {
      const weeks = Array.from({ length: weeksN }, (_, w) => {
        const len = w === weeksN - 1 ? wd + 1 : 7;
        return Array.from({ length: len }, (_, d) => String((w * 7 + d * 3 + (w * d) % 5) % 5 === 0 ? 0 : ((w + d * 2) % 4) + 1)).join('');
      });
      Object.assign(res, { offset: 0, from: first, weeks });
    }
    if (s.showStreak) res.streak = long ? { current: 1234, longest: 2345, thisYear: 12345 } : { current: 12, longest: 47, thisYear: 1641 };
    out.contrib = res;
  }

  // ---- activity, followers, stargazers, security
  if (on('showActivity') && repos.length) {
    const ev = [
      { repo: repoName(0), actor: 'anna-schmidt', at: ago(12), kind: 'pr', action: 'merged', n: 414, text: 'Bikes: Nextbike-Stationen in der Nähe', times: 1, actors: ['anna-schmidt'] },
      { repo: repoName(0), actor: 'yannic', at: ago(40), kind: 'push', branch: 'main', n: 7, times: 3, actors: ['yannic'] },
      { repo: repoName(0), actor: 'leipziger-jung', at: ago(95), kind: 'star', times: 4, actors: ['leipziger-jung', 'sachsen-dev', 'mirror-fan', 'k-weber'] },
      { repo: repoName(1), actor: 'k-weber', at: ago(4 * H), kind: 'issue', action: 'opened', n: 32, text: 'Temperatur springt nach Neustart auf 0 °C', times: 1, actors: ['k-weber'] },
      { repo: repoName(1), actor: 'anna-schmidt', at: ago(7 * H), kind: 'review', state: 'approved', n: 30, text: 'Neue Sensoren für den Garten', times: 1, actors: ['anna-schmidt'] },
      { repo: repoName(0), actor: 'yannic', at: ago(2 * D), kind: 'release', text: 'v2.14.0', times: 1, actors: ['yannic'] },
    ];
    if (long) for (let i = 0; i < 14; i++) ev.push({ repo: repoName(i % 3), actor: `benutzer-mit-einem-sehr-langen-namen-${i}`, at: ago((3 + i) * D), kind: 'comment', n: 98765 + i, pr: false, text: `Kommentar zu ${LONG}`, times: 1, actors: [`benutzer-${i}`] });
    out.activity = ev.slice(0, long ? 20 : clamp(s.activityCount, 1, 20, 6));
  }
  if (on('showFollowers')) {
    const recent = [{ login: 'sachsen-dev', at: ago(3 * H) }, { login: 'mirror-fan', at: ago(2 * D) }, { login: 'k-weber', at: ago(9 * D) }];
    if (long) for (let i = 0; i < 7; i++) recent.push({ login: `${LONG.toLowerCase().slice(0, 30)}-${i}`, at: ago((10 + i) * D) });
    out.followers = { count: long ? 123456 : 214, recent: recent.slice(0, long ? 10 : clamp(s.followersCount, 1, 10, 3)) };
  }
  if (on('showStargazers')) {
    const st = [{ login: 'leipziger-jung', repo: repoName(0), at: ago(95) }, { login: 'k-weber', repo: repoName(1), at: ago(5 * H) }, { login: 'octo-sachse', repo: repoName(0), at: ago(D) }];
    if (long) for (let i = 0; i < 7; i++) st.push({ login: `sternchen-sammlerin-aus-plagwitz-${i}`, repo: repoName(i % 3), at: ago((2 + i) * D) });
    out.stargazers = st.slice(0, long ? 10 : clamp(s.stargazersCount, 1, 10, 3));
  }
  if (on('showSecurity')) {
    out.security = [
      { repo: repoName(0), critical: long ? 123 : 0, high: 2, medium: 5, low: 1, total: long ? 131 : 8 },
      { repo: repoName(1), critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    ];
    if (long) out.security.push({ repo: repoName(2), noAccess: true });
  }

  out.rate = { remaining: 4873, limit: 5000 };
  out.refresh = out.running && s.showRunning ? clamp(s.liveSeconds, 15, 300, 30) : 300;
  return out;
};
