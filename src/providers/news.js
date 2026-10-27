// News / RSS: merges RSS 2.0 / RSS 1.0 (RDF) / Atom feeds into one sorted,
// de-duplicated headline list. Hand-written parser – no XML dependency.
import { fetchText, cached } from '../util.js';

const FEED_TTL = 600; // seconds
const MAX_PER_FEED = 100;
const SNIPPET_LEN = 180;

// ---- text helpers --------------------------------------------------------------
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', lsaquo: '‹', rsaquo: '›',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', oacute: 'ó', ograve: 'ò',
  iacute: 'í', uacute: 'ú', ccedil: 'ç', ntilde: 'ñ', Eacute: 'É', oslash: 'ø', aring: 'å', aelig: 'æ',
  euro: '€', pound: '£', yen: '¥', cent: '¢', copy: '©', reg: '®', trade: '™', deg: '°', sect: '§',
  para: '¶', times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾',
  zwj: '', zwnj: '', lrm: '', rlm: '', thinsp: ' ', ensp: ' ', emsp: ' ', minus: '−',
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripTags(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '');
}

const squash = (s) => s.replace(/[\s ]+/g, ' ').trim();

export function truncate(s, max = SNIPPET_LEN) {
  if (!s || s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–-]+$/, '') + ' …';
}

// Common time zone abbreviations Date.parse() does not know (RFC 822 feeds).
const TZ = { CET: '+0100', CEST: '+0200', MEZ: '+0100', MESZ: '+0200', BST: '+0100', IST: '+0530', AEST: '+1000', AEDT: '+1100' };

export function parseDate(s) {
  if (!s) return null;
  let str = squash(String(s)).replace(/\b([A-Z]{3,4})$/, (m, z) => TZ[z] || m);
  let t = Date.parse(str);
  // "27 Oct 2026 10:00:00 +0100" without weekday, or German weekday names.
  if (Number.isNaN(t)) t = Date.parse(str.replace(/^[^,\d]*,\s*/, ''));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---- parser ----------------------------------------------------------------------
// CDATA sections are cut out first (they may contain "<" or even "</item>") and
// re-inserted as raw HTML when a field's text is extracted.
export function parseFeed(xml) {
  const cdata = [];
  const src = String(xml)
    .replace(/^﻿/, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (m, c) => `\u0000${cdata.push(c) - 1}\u0000`)
    .replace(/<!--[\s\S]*?-->/g, '');

  const text = (raw) => {
    if (raw == null) return '';
    const html = raw
      .split(/\u0000(\d+)\u0000/)
      .map((part, i) => (i % 2 ? cdata[Number(part)] : decodeEntities(part)))
      .join('');
    return squash(decodeEntities(stripTags(html)));
  };
  const tag = (block, name) => {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${name}\\s*>)`, 'i');
    const m = block.match(re);
    return m ? m[1] ?? '' : null;
  };
  const first = (block, names) => {
    for (const n of names) {
      const v = tag(block, n);
      if (v != null && v.trim()) return v;
    }
    return null;
  };
  const attr = (el, name) => {
    const m = el.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    return m ? decodeEntities(m[2] ?? m[3]) : null;
  };

  const isAtom = /<feed[\s>]/i.test(src) && !/<rss[\s>]|<rdf:RDF[\s>]/i.test(src);
  const head = src.split(/<(?:item|entry)[\s>]/i)[0];
  const feedTitle = text(first(head, ['title']));

  const items = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;
  let m;
  while ((m = re.exec(src)) && items.length < MAX_PER_FEED) {
    const b = m[2];
    const title = text(tag(b, 'title'));
    let link = null;
    if (isAtom || m[1].toLowerCase() === 'entry') {
      const links = b.match(/<link\b[^>]*>/gi) || [];
      const alt = links.find((l) => !/\srel\s*=/i.test(l) || /\srel\s*=\s*["']alternate["']/i.test(l)) || links[0];
      link = alt ? attr(alt, 'href') : null;
    } else {
      link = text(tag(b, 'link')) || null;
      const guid = tag(b, 'guid');
      if (!link && guid && /^https?:/i.test(text(guid))) link = text(guid);
    }
    const date = parseDate(text(first(b, ['pubDate', 'dc:date', 'published', 'updated', 'issued', 'modified'])));
    const description = text(first(b, ['description', 'summary', 'content:encoded', 'content']));
    if (!title && !description) continue;
    items.push({ title: title || truncate(description, 100), link, date, description });
  }
  return { title: feedTitle, items };
}

// ---- merge -----------------------------------------------------------------------
const linkKey = (l) => {
  if (!l) return null;
  try {
    const u = new URL(l);
    return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return l.trim().toLowerCase();
  }
};
const titleKey = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function mergeItems(lists, { maxItems = 10, maxAgeHours = 0, now = Date.now() } = {}) {
  const seen = new Set();
  const out = [];
  const minTime = maxAgeHours > 0 ? now - maxAgeHours * 3600 * 1000 : -Infinity;
  const all = lists.flatMap((l, li) => l.items.map((it, i) => ({ ...it, source: l.source, _o: li * 1000 + i })));
  // Newest first; undated items go last in feed order. Future dates (bad clocks) count as now.
  const time = (it) => (it.date ? Math.min(Date.parse(it.date), now) : -Infinity);
  all.sort((a, b) => time(b) - time(a) || a._o - b._o);
  for (const it of all) {
    if (it.date && Date.parse(it.date) < minTime) continue;
    const keys = [linkKey(it.link), it.title && 't:' + titleKey(it.title)].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    delete it._o;
    out.push(it);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ---- provider --------------------------------------------------------------------
async function loadFeed(url) {
  const u = new URL(url.trim().replace(/^feed:\/\//i, 'https://'));
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed');
  return cached(`news:${u.href}`, FEED_TTL, async () => {
    const xml = await fetchText(u.href, { headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5' } });
    const feed = parseFeed(xml);
    if (!feed.items.length && !/<(rss|feed|rdf:RDF)[\s>]/i.test(xml)) throw new Error('Not an RSS or Atom feed');
    return feed;
  });
}

export async function provider(settings) {
  const feeds = (settings.feeds || []).filter((f) => f.enabled && f.url && f.url.trim());
  if (!feeds.length) return { items: [], errors: [] };
  const errors = [];
  const lists = [];
  await Promise.all(
    feeds.map(async (f, i) => {
      try {
        const feed = await loadFeed(f.url);
        lists[i] = { source: f.name || feed.title || new URL(f.url).host, items: feed.items };
      } catch (err) {
        errors.push(`${f.name || 'Feed'}: ${err.message}`);
      }
    }),
  );
  const ok = lists.filter(Boolean);
  if (!ok.length) throw new Error(errors[0] || 'No feed could be loaded');
  const items = mergeItems(ok, { maxItems: settings.maxItems, maxAgeHours: settings.maxAgeHours }).map((it) => ({
    title: it.title,
    source: it.source,
    date: it.date,
    ...(settings.showDescription && it.description && it.description !== it.title ? { description: truncate(it.description) } : {}),
  }));
  return { items, errors };
}
