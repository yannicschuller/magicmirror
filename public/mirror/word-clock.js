// Word clock ("Es ist viertel nach drei" / "It's quarter past three") – pure helpers (unit-tested).
// 5-minute resolution (rounded down); `extra` = minutes past the 5-minute step (0–4, the corner dots).

const DE_HOURS = ['zwölf', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const EN_HOURS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

const WORDS = {
  de: { ES: 'Es', IST: 'ist', M5: 'fünf', M10: 'zehn', M20: 'zwanzig', VIERTEL: 'viertel', DREIVIERTEL: 'dreiviertel', VOR: 'vor', NACH: 'nach', HALB: 'halb', UHR: 'Uhr', H1U: 'ein' },
  en: { IT: 'It', IS: 'is', M5: 'five', M10: 'ten', M20: 'twenty', QUARTER: 'quarter', HALF: 'half', PAST: 'past', TO: 'to', OCLOCK: "o'clock" },
};

// German minute phrases per 5-minute step; `+1` = refers to the next hour.
const DE_STEPS = {
  standard: [[], ['M5', 'NACH'], ['M10', 'NACH'], ['VIERTEL', 'NACH'], ['M20', 'NACH'], ['M5', 'VOR', 'HALB', '+1'], ['HALB', '+1'],
    ['M5', 'NACH', 'HALB', '+1'], ['M20', 'VOR', '+1'], ['VIERTEL', 'VOR', '+1'], ['M10', 'VOR', '+1'], ['M5', 'VOR', '+1']],
};
DE_STEPS.east = DE_STEPS.standard.map((p, i) => (i === 3 ? ['VIERTEL', '+1'] : i === 9 ? ['DREIVIERTEL', '+1'] : p));
const EN_STEPS = [[], ['M5', 'PAST'], ['M10', 'PAST'], ['QUARTER', 'PAST'], ['M20', 'PAST'], ['M20', 'M5', 'PAST'], ['HALF', 'PAST'],
  ['M20', 'M5', 'TO', '+1'], ['M20', 'TO', '+1'], ['QUARTER', 'TO', '+1'], ['M10', 'TO', '+1'], ['M5', 'TO', '+1']];

/**
 * @returns {{ ids: string[], words: string[], hourIndex: number, text: string, extra: number }}
 * ids are grid word ids (hour ids: H1…H12, H1U = German "ein" before "Uhr").
 */
export function wordClock(hours, minutes, lang = 'de', dialect = 'standard') {
  const en = lang === 'en';
  const step = Math.floor(minutes / 5);
  const extra = minutes % 5;
  const phrase = en ? EN_STEPS[step] : (DE_STEPS[dialect] || DE_STEPS.standard)[step];
  const h12 = ((hours + (phrase.includes('+1') ? 1 : 0)) % 12) || 12;
  const ids = en ? ['IT', 'IS'] : ['ES', 'IST'];
  ids.push(...phrase.filter((x) => x !== '+1'));
  let hourId = `H${h12}`;
  if (!en && step === 0 && h12 === 1) hourId = 'H1U';
  ids.push(hourId);
  if (step === 0) ids.push(en ? 'OCLOCK' : 'UHR');
  let words = ids.map((id) => (id === hourId && id !== 'H1U' ? (en ? EN_HOURS : DE_HOURS)[h12] : WORDS[en ? 'en' : 'de'][id]));
  if (en) words = ["It's", ...words.slice(2).join(' ').replace('twenty five', 'twenty-five').split(' ')];
  // The hour is always the last word, or the one before "Uhr" / "o'clock".
  const hourIndex = words.length - (step === 0 ? 2 : 1);
  return { ids, words, hourIndex, text: words.join(' '), extra };
}

// Letter grids (11 × 10) with the position of every word id: [row, col, length].
export const GRIDS = {
  de: {
    rows: ['ESKISTAFÜNF', 'ZEHNZWANZIG', 'DREIVIERTEL', 'VORFUNKNACH', 'HALBAELFÜNF', 'EINSXAMZWEI', 'DREIPMJVIER', 'SECHSNLACHT', 'SIEBENZWÖLF', 'ZEHNEUNKUHR'],
    words: {
      ES: [0, 0, 2], IST: [0, 3, 3], M5: [0, 7, 4], M10: [1, 0, 4], M20: [1, 4, 7], DREIVIERTEL: [2, 0, 11], VIERTEL: [2, 4, 7],
      VOR: [3, 0, 3], NACH: [3, 7, 4], HALB: [4, 0, 4], H11: [4, 5, 3], H5: [4, 7, 4], H1: [5, 0, 4], H1U: [5, 0, 3], H2: [5, 7, 4],
      H3: [6, 0, 4], H4: [6, 7, 4], H6: [7, 0, 5], H8: [7, 7, 4], H7: [8, 0, 6], H12: [8, 6, 5], H10: [9, 0, 4], H9: [9, 3, 4], UHR: [9, 8, 3],
    },
  },
  en: {
    rows: ['ITLISASAMPM', 'ACQUARTERDC', 'TWENTYFIVEX', 'HALFSTENFTO', 'PASTERUNINE', 'ONESIXTHREE', 'FOURFIVETWO', 'EIGHTELEVEN', 'SEVENTWELVE', 'TENSEOCLOCK'],
    words: {
      IT: [0, 0, 2], IS: [0, 3, 2], QUARTER: [1, 2, 7], M20: [2, 0, 6], M5: [2, 6, 4], HALF: [3, 0, 4], M10: [3, 5, 3], TO: [3, 9, 2],
      PAST: [4, 0, 4], H9: [4, 7, 4], H1: [5, 0, 3], H6: [5, 3, 3], H3: [5, 6, 5], H4: [6, 0, 4], H5: [6, 4, 4], H2: [6, 8, 3],
      H8: [7, 0, 5], H11: [7, 5, 6], H7: [8, 0, 5], H12: [8, 5, 6], H10: [9, 0, 3], OCLOCK: [9, 5, 6],
    },
  },
};

// Set of lit cells ("row:col") for the given word ids.
export function litCells(ids, lang = 'de') {
  const g = GRIDS[lang === 'en' ? 'en' : 'de'];
  const lit = new Set();
  for (const id of ids) {
    const w = g.words[id];
    if (!w) continue;
    for (let i = 0; i < w[2]; i++) lit.add(`${w[0]}:${w[1] + i}`);
  }
  return lit;
}
