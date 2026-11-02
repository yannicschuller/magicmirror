// Countdown – the mirror computes everything from the settings. This hands the events back
// as module data (for the "only show when an event is coming up" condition) and adds
// birthdays/anniversaries from an address book (CardDAV: Nextcloud, Baïkal, iCloud, …).
import crypto from 'node:crypto';
import { cached, fetchRaw } from '../util.js';

// vCard date → "YYYY-MM-DD" (year 1604 / missing year → no age), or null.
// Forms: 19850315, 1985-03-15, --0315, --03-15, 1985-03-15T00:00:00Z
export function vcardDate(raw) {
  const s = String(raw || '').trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (m) return { date: `${m[1] === '1604' ? '2000' : m[1]}-${m[2]}-${m[3]}`, yearKnown: m[1] !== '1604' };
  m = /^--(\d{2})-?(\d{2})/.exec(s);
  if (m) return { date: `2000-${m[1]}-${m[2]}`, yearKnown: false };
  return null;
}

// Minimal vCard reader: name, birthday, anniversary per card.
export function parseVcards(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/); // unfold
  const out = [];
  let card = null;
  for (const line of lines) {
    const u = line.toUpperCase();
    if (u.startsWith('BEGIN:VCARD')) card = {};
    else if (u.startsWith('END:VCARD')) {
      if (card) out.push(card);
      card = null;
    } else if (card) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].replace(/^item\d+\./i, '').toUpperCase();
      const value = line.slice(i + 1).replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
      if (key === 'FN') card.name = value;
      else if (key === 'N' && !card.name) card.name = value.split(';').slice(0, 2).reverse().filter(Boolean).join(' ');
      else if (key === 'BDAY') card.bday = vcardDate(value);
      else if (key === 'ANNIVERSARY' || key === 'X-ANNIVERSARY') card.anniversary = vcardDate(value);
    }
  }
  return out.filter((c) => c.name && (c.bday || c.anniversary));
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '').replace(/&amp;/g, '&');

// All vCards of an address book: CardDAV REPORT, or a plain GET (a .vcf file, Nextcloud "?export").
export async function loadContacts(url, user, password) {
  const headers = user ? { Authorization: `Basic ${Buffer.from(`${user}:${password || ''}`).toString('base64')}` } : {};
  try {
    const res = await fetchRaw(url, {
      method: 'REPORT',
      timeout: 30000,
      headers: { ...headers, Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: '<?xml version="1.0" encoding="utf-8"?><c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav"><d:prop><c:address-data/></d:prop></c:addressbook-query>',
    });
    const xml = await res.text();
    const cards = [...xml.matchAll(/<[\w-]*:?address-data[^>]*>([\s\S]*?)<\/[\w-]*:?address-data>/g)].map((m) => unescapeXml(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')));
    if (cards.length || /multistatus/i.test(xml)) return cards.join('\n');
  } catch (err) {
    if (/HTTP 401/.test(err.message)) throw new Error('Address book: wrong user name or password');
  }
  const res = await fetchRaw(url, { timeout: 30000, headers });
  return res.text();
}

export function contactEvents(cards, s) {
  const icon = s.contactsIcon ?? '🎂';
  const out = [];
  for (const c of cards) {
    if (c.bday) out.push({ name: c.name, date: c.bday.date, repeat: 'yearly', years: c.bday.yearKnown && s.contactsAge !== false ? 'age' : 'none', icon, color: s.contactsColor || '#ffffff', fromContacts: true });
    if (c.anniversary && s.contactsAnniversaries) out.push({ name: c.name, date: c.anniversary.date, repeat: 'yearly', years: c.anniversary.yearKnown ? 'count' : 'none', icon: '💍', color: s.contactsColor || '#ffffff', fromContacts: true });
  }
  return out;
}

export async function provider(settings) {
  const own = (settings.events || [])
    .filter((e) => e && e.enabled !== false && e.date)
    .map(({ name, date, time, repeat }) => ({ name, date, time, repeat }));
  const out = { events: own, withinDays: settings.withinDays || 0 };
  const url = String(settings.contactsUrl || '').trim();
  if (settings.contactsEnabled && /^https?:\/\//.test(url)) {
    const key = `countdown:contacts:${crypto.createHash('sha1').update(`${url}|${settings.contactsUser}|${settings.contactsPassword}`).digest('hex')}`;
    try {
      const cards = await cached(key, 6 * 3600, async () => parseVcards(await loadContacts(url, settings.contactsUser, settings.contactsPassword)));
      out.contacts = contactEvents(cards, settings);
      out.events = [...own, ...out.contacts.map(({ name, date, repeat }) => ({ name, date, repeat }))];
    } catch (err) {
      out.errors = [err.message];
    }
  }
  return out;
}
