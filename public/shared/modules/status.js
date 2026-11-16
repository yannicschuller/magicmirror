// Service status – are my services up? From an Uptime Kuma status page, a status JSON of
// your own (e.g. written by a GitHub Action) or a Statuspage.io page (GitHub, Cloudflare, …).

export default {
  type: 'status',
  label: 'Service status',
  description: 'Up, degraded or down: services from Uptime Kuma, your own status JSON or a Statuspage.io page',
  defaultRegion: 'middle_right',
  defaultTitle: 'Services',
  refresh: 60,
  fields: [
    { key: 'source', label: 'Source', type: 'select', default: 'uptimekuma', options: [
      { value: 'uptimekuma', label: 'Uptime Kuma (status page)' },
      { value: 'json', label: 'Own status JSON (URL)' },
      { value: 'statuspage', label: 'Statuspage.io page (e.g. githubstatus.com)' },
    ] },
    { key: 'url', label: 'Address', type: 'text', default: '', secret: true, placeholder: 'http://uptime-kuma.local:3001',
      help: 'Uptime Kuma: the address of your Kuma. Own JSON: the URL of the file. Statuspage.io: the address of the status page, e.g. https://www.githubstatus.com.' },
    { key: 'slug', label: 'Status page (slug)', type: 'text', default: '', placeholder: 'home', showIf: { source: 'uptimekuma' },
      help: 'The end of the status page address: …/status/home → "home". Only public monitors of this page are shown.' },
    { key: 'authHeader', label: 'Authorization header (optional)', type: 'text', default: '', secret: true, placeholder: 'Bearer …', showIf: { source: 'json' },
      help: 'For a protected JSON file, e.g. "Bearer <token>" or "token <GitHub token>" for a private repository.' },
    { key: 'names', label: 'Display names (key=Name, comma-separated)', type: 'text', default: '', placeholder: 'app=App, api=API, mcp=MCP server',
      help: 'Renames services. Without an entry the name from the source is used.' },
    { key: 'hide', label: 'Hide services (comma-separated)', type: 'text', default: '', placeholder: 'docs, marketplace' },
    { key: 'layout', label: 'Layout', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List' },
      { value: 'grid', label: 'Compact (two columns)' },
      { value: 'summary', label: 'One line ("All 8 services running")' },
    ] },
    { key: 'onlyProblems', label: 'Only list services with problems', type: 'bool', default: false,
      help: 'While everything runs, only one line "All services running" is shown.' },
    { key: 'showLatency', label: 'Response time', type: 'bool', default: true },
    { key: 'showHistory', label: 'History bars', type: 'bool', default: true,
      help: 'Uptime Kuma: the last checks. Own JSON: one bar per day (from "days"). Statuspage.io has no history.' },
    { key: 'showUptime', label: 'Uptime in %', type: 'bool', default: false },
    { key: 'showIncidents', label: 'Incidents and maintenance', type: 'bool', default: true },
  ],
};
