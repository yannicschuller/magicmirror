import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goStatus, goOptions, nextReachable } from '../public/mirror/transit-go.js';
import { wordClock, litCells, GRIDS } from '../public/mirror/word-clock.js';

const NOW = Date.parse('2026-10-27T08:00:00Z');
const MIN = 60000;
const S = { walkMinutes: 5, bufferMinutes: 2, rushMinutes: 3 };
const level = (depMin, s = S) => goStatus(NOW + depMin * MIN, NOW, s).level;

test('leave-now classification with boundaries', () => {
  // leave = dep − walk; relaxed ≥ 5, go 0…5, run −3…0, gone < −3
  assert.equal(level(30), 'relaxed');
  assert.equal(level(10), 'relaxed'); // leave = 5 exactly
  assert.equal(level(9.99), 'go');
  assert.equal(level(5), 'go'); // leave = 0 exactly
  assert.equal(level(4.99), 'run');
  assert.equal(level(2), 'run'); // leave = −3 exactly
  assert.equal(level(1.99), 'gone');
  assert.equal(level(-1), 'gone');
  assert.equal(goStatus(NOW + 9 * MIN, NOW, S).leave, 4);
});

test('leave-now defaults and zero margins', () => {
  assert.deepEqual(goOptions({}), { walk: 0, buffer: 2, rush: 3 });
  assert.deepEqual(goOptions({ walkMinutes: '', bufferMinutes: null }), { walk: 0, buffer: 2, rush: 3 });
  const z = { walkMinutes: 4, bufferMinutes: 0, rushMinutes: 0 };
  assert.equal(level(4, z), 'relaxed');
  assert.equal(level(3.99, z), 'gone');
  assert.equal(level(5, { walkMinutes: 0 }), 'relaxed');
  assert.equal(level(4, { walkMinutes: 0 }), 'go');
  assert.equal(level(-2, { walkMinutes: 0 }), 'run');
});

test('next reachable departure for the banner', () => {
  const dep = (line, min, extra = {}) => ({ line, destination: 'X', planned: new Date(NOW + min * MIN).toISOString(), realtime: null, ...extra });
  const list = [dep('U6', 1), dep('S1', 3, { cancelled: true }), dep('U6', 4, { realtime: new Date(NOW + 6 * MIN).toISOString() }), dep('U14', 8)];
  const n = nextReachable(list, NOW, S);
  assert.equal(n.departure, list[2]); // realtime counts, cancelled skipped, 1 min is gone
  assert.equal(n.level, 'go');
  assert.equal(nextReachable(list, NOW, { ...S, goNowLines: 'u14, s2' }).departure, list[3]);
  assert.equal(nextReachable(list, NOW, { ...S, goNowLines: 'S9' }), null);
});

const at = (h, m, lang, dialect) => wordClock(h, m, lang, dialect).text;

test('word clock German (standard)', () => {
  const cases = {
    '3:00': 'Es ist drei Uhr', '3:05': 'Es ist fünf nach drei', '3:10': 'Es ist zehn nach drei', '3:15': 'Es ist viertel nach drei',
    '3:20': 'Es ist zwanzig nach drei', '3:25': 'Es ist fünf vor halb vier', '3:30': 'Es ist halb vier', '3:35': 'Es ist fünf nach halb vier',
    '3:40': 'Es ist zwanzig vor vier', '3:45': 'Es ist viertel vor vier', '3:50': 'Es ist zehn vor vier', '3:58': 'Es ist fünf vor vier',
    '12:00': 'Es ist zwölf Uhr', '0:00': 'Es ist zwölf Uhr', '1:00': 'Es ist ein Uhr', '13:05': 'Es ist fünf nach eins',
    '12:45': 'Es ist viertel vor eins', '23:59': 'Es ist fünf vor zwölf', '0:30': 'Es ist halb eins', '15:17': 'Es ist viertel nach drei',
  };
  for (const [k, v] of Object.entries(cases)) {
    const [h, m] = k.split(':').map(Number);
    assert.equal(at(h, m, 'de'), v, k);
    assert.equal(at(h, m, 'de', 'standard'), v, k);
  }
});

test('word clock German (east)', () => {
  const cases = {
    '3:00': 'Es ist drei Uhr', '3:05': 'Es ist fünf nach drei', '3:15': 'Es ist viertel vier', '3:25': 'Es ist fünf vor halb vier',
    '3:30': 'Es ist halb vier', '3:35': 'Es ist fünf nach halb vier', '3:45': 'Es ist dreiviertel vier', '3:58': 'Es ist fünf vor vier',
    '12:00': 'Es ist zwölf Uhr', '0:00': 'Es ist zwölf Uhr', '12:15': 'Es ist viertel eins', '23:45': 'Es ist dreiviertel zwölf',
  };
  for (const [k, v] of Object.entries(cases)) {
    const [h, m] = k.split(':').map(Number);
    assert.equal(at(h, m, 'de', 'east'), v, k);
  }
});

test('word clock English', () => {
  const cases = {
    '3:00': "It's three o'clock", '3:05': "It's five past three", '3:15': "It's quarter past three", '3:20': "It's twenty past three",
    '3:25': "It's twenty-five past three", '3:30': "It's half past three", '3:35': "It's twenty-five to four", '3:40': "It's twenty to four",
    '3:45': "It's quarter to four", '3:50': "It's ten to four", '3:58': "It's five to four", '12:00': "It's twelve o'clock",
    '0:00': "It's twelve o'clock", '11:45': "It's quarter to twelve", '12:35': "It's twenty-five to one",
  };
  for (const [k, v] of Object.entries(cases)) {
    const [h, m] = k.split(':').map(Number);
    assert.equal(at(h, m, 'en'), v, k);
  }
});

test('word clock extra minutes and highlighted hour', () => {
  assert.equal(wordClock(3, 58, 'de').extra, 3);
  assert.equal(wordClock(3, 55, 'de').extra, 0);
  const w = wordClock(3, 15, 'de');
  assert.equal(w.words[w.hourIndex], 'drei');
  assert.equal(wordClock(1, 0, 'de').words[wordClock(1, 0, 'de').hourIndex], 'ein');
  const hour = (h, m) => { const x = wordClock(h, m, 'en'); return x.words[x.hourIndex]; };
  assert.equal(hour(5, 5), 'five');
  assert.equal(hour(4, 55), 'five');
  assert.equal(hour(5, 0), 'five');
  assert.deepEqual(wordClock(3, 25, 'en').words, ["It's", 'twenty-five', 'past', 'three']);
});

test('word clock grids light exactly the sentence letters', () => {
  for (const g of Object.values(GRIDS)) for (const r of g.rows) assert.equal([...r].length, 11, r);
  for (const [lang, dialect] of [['de', 'standard'], ['de', 'east'], ['en']]) {
    const g = GRIDS[lang];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 5) {
        const w = wordClock(h, m, lang, dialect);
        for (const id of w.ids) assert.ok(g.words[id], `${lang} ${id} missing`);
        const letters = [...litCells(w.ids, lang)].map((k) => k.split(':').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
          .map(([r, c]) => [...g.rows[r]][c]).join('');
        const expect = w.ids.map((id) => { const [r, c, n] = g.words[id]; return [...g.rows[r]].slice(c, c + n).join(''); }).join('');
        assert.equal(letters, expect, `${lang} ${h}:${m}`); // words appear in reading order, no overlap
        if (lang === 'de') assert.equal(expect, w.words.join('').toUpperCase().replace('DREIVIERTEL', 'DREIVIERTEL'));
      }
    }
  }
});
