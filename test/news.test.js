import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseFeed, mergeItems, decodeEntities, parseDate, truncate, provider } from '../src/providers/news.js';
import schema from '../public/shared/modules/news.js';
import { applyDefaults } from '../public/shared/modules.js';
import { translator } from '../public/shared/i18n.js';
import deNews from '../public/shared/locales/de/modules/news.js';

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000);
const rfc = (d) => d.toUTCString();

const RSS = () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Test &amp; News</title>
  <link>https://example.com/</link>
  <atom:link href="https://example.com/feed.xml" rel="self" type="application/rss+xml"/>
  <image><title>Logo</title><url>https://example.com/logo.png</url></image>
  <!-- <item><title>commented out</title></item> -->
  <item>
    <title><![CDATA[Bundestag beschließt <b>Gesetz</b> & mehr]]></title>
    <link>https://example.com/a?x=1&amp;y=2</link>
    <pubDate>${rfc(iso(1))}</pubDate>
    <description>&lt;p&gt;Erster &amp;amp; bester &lt;a href="#"&gt;Absatz&lt;/a&gt;&lt;/p&gt;&lt;img src="x.jpg"/&gt;</description>
    <content:encoded><![CDATA[<p>Full text with </item> inside</p>]]></content:encoded>
  </item>
  <item>
    <title>Numeric &#8222;quotes&#8220; &#x2013; and &eacute;t&eacute; &hellip;</title>
    <guid isPermaLink="true">https://example.com/b</guid>
    <dc:date>${iso(3).toISOString()}</dc:date>
  </item>
  <item>
    <title>No date here</title>
    <link>https://example.com/c</link>
  </item>
  <item>
    <title>Old news</title>
    <link>https://example.com/old</link>
    <pubDate>${rfc(iso(100))}</pubDate>
  </item>
</channel>
</rss>`;

const ATOM = () => `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom Feed</title>
  <link href="https://atom.example.org/" rel="alternate"/>
  <updated>${iso(0).toISOString()}</updated>
  <entry>
    <title type="html">&lt;em&gt;Atom&lt;/em&gt; headline one</title>
    <link rel="self" href="https://atom.example.org/self/1"/>
    <link rel="alternate" type="text/html" href="https://atom.example.org/1"/>
    <id>urn:uuid:1</id>
    <published>${iso(2).toISOString()}</published>
    <updated>${iso(0.5).toISOString()}</updated>
    <summary type="html">&lt;p&gt;Summary &amp;amp; more&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Duplicate of RSS</title>
    <link href="https://www.example.com/a/?x=1&amp;y=2"/>
    <updated>${iso(0.2).toISOString()}</updated>
  </entry>
  <entry>
    <title>  Bundestag beschließt Gesetz &amp; mehr! </title>
    <link href='https://other.example.net/z'/>
    <updated>${iso(0.1).toISOString()}</updated>
  </entry>
</feed>`;

test('decodeEntities handles named, decimal and hex entities', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#228;&#xFC;&#X00DF; &bdquo;x&ldquo; &unknown; &#0;'), 'a & b <c> äüß „x“ &unknown; &#0;');
});

test('parseDate understands RFC 822, ISO 8601 and German zone names', () => {
  assert.equal(parseDate('Tue, 27 Oct 2026 10:00:00 GMT'), '2026-10-27T10:00:00.000Z');
  assert.equal(parseDate('Tue, 27 Oct 2026 10:00:00 +0100'), '2026-10-27T09:00:00.000Z');
  assert.equal(parseDate('Di, 27 Oct 2026 10:00:00 MESZ'), '2026-10-27T08:00:00.000Z');
  assert.equal(parseDate('2026-10-27T10:00:00+02:00'), '2026-10-27T08:00:00.000Z');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('gestern'), null);
});

test('truncate cuts at a word boundary', () => {
  assert.equal(truncate('short', 10), 'short');
  assert.equal(truncate('one two three four five six', 15), 'one two three …');
});

test('parses RSS 2.0 with CDATA, entities, guid links and missing dates', () => {
  const f = parseFeed(RSS());
  assert.equal(f.title, 'Test & News');
  assert.equal(f.items.length, 4);
  const [a, b, c] = f.items;
  assert.equal(a.title, 'Bundestag beschließt Gesetz & mehr');
  assert.equal(a.link, 'https://example.com/a?x=1&y=2');
  assert.equal(a.description, 'Erster & bester Absatz');
  assert.ok(a.date);
  assert.equal(b.title, 'Numeric „quotes“ – and été …');
  assert.equal(b.link, 'https://example.com/b');
  assert.ok(b.date.endsWith('Z'));
  assert.equal(c.date, null);
  assert.equal(c.description, '');
});

test('parses Atom entries with alternate links and HTML titles', () => {
  const f = parseFeed(ATOM());
  assert.equal(f.title, 'Atom Feed');
  assert.equal(f.items.length, 3);
  assert.equal(f.items[0].title, 'Atom headline one');
  assert.equal(f.items[0].link, 'https://atom.example.org/1');
  assert.equal(f.items[0].description, 'Summary & more');
  // published wins over updated
  assert.equal(Math.round((Date.now() - Date.parse(f.items[0].date)) / 3600000), 2);
  assert.equal(f.items[2].link, 'https://other.example.net/z');
});

test('parses RSS 1.0 (RDF)', () => {
  const f = parseFeed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="x"><title>RDF</title><items><rdf:Seq><rdf:li resource="https://r.example/1"/></rdf:Seq></items></channel>
    <item rdf:about="https://r.example/1"><title>RDF item</title><link>https://r.example/1</link><dc:date>2026-10-27T08:00:00Z</dc:date></item>
  </rdf:RDF>`);
  assert.equal(f.title, 'RDF');
  assert.deepEqual(f.items, [{ title: 'RDF item', link: 'https://r.example/1', date: '2026-10-27T08:00:00.000Z', description: '' }]);
});

test('mergeItems sorts, dedupes by link and title, filters by age', () => {
  const rss = { source: 'RSS', ...parseFeed(RSS()) };
  const atom = { source: 'Atom', ...parseFeed(ATOM()) };
  const merged = mergeItems([rss, atom], { maxItems: 20, maxAgeHours: 24 });
  assert.deepEqual(merged.map((x) => x.title), [
    'Bundestag beschließt Gesetz & mehr!', // newest (Atom, same title as RSS one, wins as newer)
    'Duplicate of RSS',                    // same link as RSS item "a" → RSS "a" dropped
    'Atom headline one',
    'Numeric „quotes“ – and été …',
    'No date here',                        // undated last
  ]);
  assert.equal(merged[0].source, 'Atom');
  assert.equal(mergeItems([rss, atom], { maxItems: 2 }).length, 2);
  assert.ok(mergeItems([rss], { maxItems: 20, maxAgeHours: 0 }).some((x) => x.title === 'Old news'));
});

test('schema defaults depend on the language', () => {
  const en = applyDefaults(schema.fields, {}, translator('en'));
  assert.equal(en.feeds[0].url, 'https://feeds.bbci.co.uk/news/rss.xml');
  assert.equal(en.style, 'list');
  assert.equal(en.showDescription, false);
  const de = applyDefaults(schema.fields, {}, (s) => deNews[s] ?? s);
  assert.equal(de.feeds[0].url, 'https://www.tagesschau.de/index~rss2.xml');
  assert.equal(de.feeds[0].name, 'tagesschau');
  assert.ok(schema.fields.find((f) => f.key === 'feeds').fields.find((f) => f.key === 'url').secret);
});

let server, base;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/rss') return res.end(RSS());
    if (req.url === '/atom') return res.end(ATOM());
    if (req.url === '/html') return res.end('<html><body>nope</body></html>');
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('provider merges feeds and reports failing ones', async () => {
  const settings = applyDefaults(schema.fields, {
    feeds: [
      { name: 'Eins', url: `${base}/rss`, enabled: true },
      { name: 'Zwei', url: `${base}/atom`, enabled: true },
      { name: 'Kaputt', url: `${base}/missing`, enabled: true },
      { name: 'Aus', url: `${base}/html`, enabled: false },
    ],
    maxItems: 3,
    showDescription: true,
  });
  const d = await provider(settings, { general: { locale: 'de-DE', timezone: 'Europe/Berlin' } });
  assert.equal(d.items.length, 3);
  assert.deepEqual(d.items.map((x) => x.source), ['Zwei', 'Zwei', 'Zwei']);
  assert.equal(d.items[2].description, 'Summary & more');
  assert.equal(d.items[0].link, undefined);
  assert.equal(d.errors.length, 1);
  assert.match(d.errors[0], /^Kaputt: HTTP 404/);
});

test('provider throws when no feed works, returns empty without feeds', async () => {
  await assert.rejects(provider({ feeds: [{ name: 'X', url: `${base}/html`, enabled: true }], maxItems: 5, maxAgeHours: 0 }), /Not an RSS or Atom feed/);
  await assert.rejects(provider({ feeds: [{ name: 'X', url: 'ftp://x/y', enabled: true }], maxItems: 5, maxAgeHours: 0 }), /http\(s\)/);
  assert.deepEqual(await provider({ feeds: [], maxItems: 5 }), { items: [], errors: [] });
});
