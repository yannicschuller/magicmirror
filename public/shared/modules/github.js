// GitHub tracker: repository stats, star history, releases, commits, Actions
// builds (live while running), your pull requests / reviews / issues,
// contribution graph & streak, activity, followers, stargazers, Dependabot.

export default {
  type: 'github',
  label: 'GitHub',
  description: 'Repositories, builds, releases, pull requests, issues and your contribution graph',
  defaultRegion: 'middle_right',
  defaultTitle: 'GitHub',
  refresh: 600,
  fields: [
    { key: 'token', label: 'Access token (optional)', type: 'text', default: '', secret: true,
      help: 'Without a token the module shows public data only (repository overview, star history, releases, commits, builds, activity, followers, stargazers) and is frugal: GitHub allows 60 requests per hour, so it updates every 15 minutes, checks running workflows at most every 2 minutes and postpones less important sections when the budget runs low. A token adds your pull requests, review requests, assigned issues, the contribution graph & streak, Dependabot alerts and private repositories, and updates every 5 minutes (30 seconds while a workflow runs). Fine-grained token (read-only): Metadata, Contents, Actions, Pull requests, Issues and Dependabot alerts for the selected repositories. Classic token: "read:user" for public repositories, "repo" for private ones, plus "security_events" for Dependabot alerts.' },
    { key: 'username', label: 'GitHub user name (empty = owner of the token)', type: 'text', default: '', placeholder: 'octocat',
      help: 'Used for followers and the contribution graph.' },
    { key: 'repos', label: 'Repositories', type: 'list', itemLabel: 'Repository', default: [], fields: [
      { key: 'repo', label: 'Repository (owner/name)', type: 'text', default: '', placeholder: 'octocat/hello-world' },
      { key: 'name', label: 'Display name (optional)', type: 'text', default: '' },
      { key: 'branch', label: 'Branch for commits and builds (empty = default branch)', type: 'text', default: '' },
    ] },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List with details' },
      { value: 'compact', label: 'Compact' },
    ] },
    { key: 'refreshMinutes', label: 'Update interval (minutes, 0 = automatic)', type: 'number', default: 0, min: 0, max: 60,
      help: 'Automatic: 15 minutes without a token, 5 minutes with one. Without a token the module stretches the interval further when needed to stay below 40 requests per hour (shared by all GitHub modules).' },

    { key: 'showOverview', label: 'Repository overview (stars, forks, issues, pull requests, last push)', type: 'bool', default: true },
    { key: 'starDelta', label: 'Star change', type: 'select', default: 'week', showIf: { showOverview: true }, options: [
      { value: 'off', label: 'Off' },
      { value: 'day', label: 'New stars today' },
      { value: 'week', label: 'New stars this week' },
    ] },
    { key: 'showStarHistory', label: 'Star history chart', type: 'bool', default: true,
      help: 'Built from daily snapshots kept by the mirror. Repositories with few stars (up to 200, with a token up to 500) are filled in once from the stargazer list.' },
    { key: 'starWeeks', label: 'Weeks in the star history', type: 'number', default: 8, min: 2, max: 16, showIf: { showStarHistory: true } },

    { key: 'showRunning', label: 'Running workflows (live)', type: 'bool', default: true },
    { key: 'liveSeconds', label: 'Update interval while a workflow runs (seconds)', type: 'number', default: 30, min: 15, max: 300, showIf: { showRunning: true },
      help: 'Without a token at least 120 seconds.' },
    { key: 'showBuilds', label: 'Build status (GitHub Actions)', type: 'bool', default: true },
    { key: 'buildsPerRepo', label: 'Workflows per repository', type: 'number', default: 3, min: 1, max: 10, showIf: { showBuilds: true } },

    { key: 'showReleases', label: 'Latest releases', type: 'bool', default: true },
    { key: 'followed', label: 'Followed repositories (releases only)', type: 'list', itemLabel: 'Repository', default: [], showIf: { showReleases: true }, fields: [
      { key: 'repo', label: 'Repository (owner/name)', type: 'text', default: '', placeholder: 'home-assistant/core' },
      { key: 'name', label: 'Display name (optional)', type: 'text', default: '' },
    ] },
    { key: 'releasesCount', label: 'Number of releases', type: 'number', default: 4, min: 1, max: 15, showIf: { showReleases: true } },
    { key: 'releaseNewDays', label: 'Highlight releases newer than (days)', type: 'number', default: 7, min: 0, max: 90, showIf: { showReleases: true } },
    { key: 'prereleases', label: 'Include pre-releases', type: 'bool', default: false, showIf: { showReleases: true } },

    { key: 'showCommits', label: 'Latest commits', type: 'bool', default: false },
    { key: 'commitsCount', label: 'Commits per repository', type: 'number', default: 3, min: 1, max: 10, showIf: { showCommits: true } },

    { key: 'showMyPrs', label: 'My open pull requests (token)', type: 'bool', default: true },
    { key: 'myPrsCount', label: 'Number of pull requests', type: 'number', default: 5, min: 1, max: 20, showIf: { showMyPrs: true } },
    { key: 'showReviews', label: 'Review requests for me (token)', type: 'bool', default: true },
    { key: 'reviewsCount', label: 'Number of review requests', type: 'number', default: 5, min: 1, max: 20, showIf: { showReviews: true } },
    { key: 'showIssues', label: 'Issues assigned to me (token)', type: 'bool', default: true },
    { key: 'issuesCount', label: 'Number of issues', type: 'number', default: 5, min: 1, max: 20, showIf: { showIssues: true } },

    { key: 'showContrib', label: 'Contribution graph (token)', type: 'bool', default: true },
    { key: 'contribWeeks', label: 'Weeks in the contribution graph', type: 'number', default: 20, min: 4, max: 53, showIf: { showContrib: true } },
    { key: 'contribColor', label: 'Colour', type: 'select', default: 'green', showIf: { showContrib: true }, options: [
      { value: 'green', label: 'GitHub green' },
      { value: 'accent', label: 'Accent colour' },
    ] },
    { key: 'showStreak', label: 'Contribution streak (token)', type: 'bool', default: true },

    { key: 'showActivity', label: 'Activity in my repositories', type: 'bool', default: false },
    { key: 'activityCount', label: 'Number of activities', type: 'number', default: 6, min: 1, max: 20, showIf: { showActivity: true } },
    { key: 'showFollowers', label: 'New followers', type: 'bool', default: false,
      help: 'New followers are recognised by comparing with the last check, so the list starts empty.' },
    { key: 'followersCount', label: 'Number of followers', type: 'number', default: 3, min: 1, max: 10, showIf: { showFollowers: true } },
    { key: 'showStargazers', label: 'New stargazers', type: 'bool', default: false },
    { key: 'stargazersCount', label: 'Number of stargazers', type: 'number', default: 3, min: 1, max: 10, showIf: { showStargazers: true } },
    { key: 'showSecurity', label: 'Security alerts (Dependabot, token)', type: 'bool', default: false,
      help: 'Open Dependabot alerts per repository by severity. Needs the "Dependabot alerts" read permission (classic token: "security_events" or "repo").' },
  ],
};
