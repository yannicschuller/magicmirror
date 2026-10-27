// News / RSS – headlines from any number of RSS 2.0 / Atom feeds.

export default {
  type: 'news',
  label: 'News / RSS',
  description: 'Headlines from RSS and Atom feeds',
  defaultRegion: 'bottom_bar',
  defaultTitle: 'News',
  refresh: 600,
  fields: [
    // Feed name/URL are message ids so the default feed follows the language
    // (German dictionary maps them to tagesschau).
    { key: 'feeds', label: 'Feeds', type: 'list', itemLabel: 'Feed', default: (t) => [
      { name: t('BBC News'), url: t('https://feeds.bbci.co.uk/news/rss.xml'), enabled: true },
    ], fields: [
      { key: 'name', label: 'Name', type: 'text', default: '' },
      // Some private feeds carry tokens in the URL, so never send it to the mirror.
      { key: 'url', label: 'Feed URL (RSS or Atom)', type: 'text', default: '', secret: true, placeholder: 'https://example.com/feed.xml' },
      { key: 'enabled', label: 'Enabled', type: 'bool', default: true },
    ] },
    { key: 'style', label: 'Display style', type: 'select', default: 'list', options: [
      { value: 'list', label: 'List of latest headlines' },
      { value: 'ticker', label: 'Ticker (one rotating headline)' },
    ] },
    { key: 'intervalSeconds', label: 'Change headline every (sec.)', type: 'number', default: 12, min: 3, max: 600, showIf: { style: 'ticker' } },
    { key: 'maxItems', label: 'Max. headlines', type: 'number', default: 6, min: 1, max: 50 },
    { key: 'maxAgeHours', label: 'Max. age (hours, 0 = any)', type: 'number', default: 24, min: 0, max: 720 },
    { key: 'showSource', label: 'Show source name', type: 'bool', default: true },
    { key: 'showTime', label: 'Show time', type: 'bool', default: true },
    { key: 'showDescription', label: 'Show description snippet', type: 'bool', default: false },
  ],
};
