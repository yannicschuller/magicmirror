// Layout scenarios. Every module type is placed once in each area ("solo", with normal and
// with long/many test entries; one module per row and column at a time), plus a few full mirrors with neighbours side by side, "fill"
// heights and half widths ("dense"). "options": every setting of every module (each select
// value, each switch flipped, numbers at min/max, all on, all off), each variant placed in turn
// at half width next to another one, with "fill" height and at full width.
import { MODULE_TYPES } from '../../public/shared/modules.js';

const DIAGONALS = [
  ['top_left', 'middle_center', 'bottom_right'],
  ['top_center', 'middle_right', 'bottom_left'],
  ['top_right', 'middle_left', 'bottom_center'],
  ['top_bar'],
  ['bottom_bar'],
];

// Settings that change the look; text, colours, dates, lists and places stay at their defaults.
const SKIP = new Set(['text', 'textarea', 'color', 'date', 'time', 'location', 'list']);
const label = (v) => (Array.isArray(v) ? `[${v.join(',')}]` : String(v));

export function optionVariants(type) {
  const fields = (MODULE_TYPES[type]?.fields || []).filter((f) => !SKIP.has(f.type) && !f.secret);
  const needs = (f) => Object.fromEntries(Object.entries(f.showIf || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const out = [];
  const seen = new Set();
  const add = (name, settings, long = false) => {
    const sig = JSON.stringify(settings);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ name, settings, long });
  };
  for (const f of fields) {
    const values = [];
    if (f.type === 'select' && f.options) values.push(...f.options.map((o) => o.value).filter((v) => v !== f.default));
    else if (f.type === 'bool') values.push(!f.default);
    else if (f.type === 'number') values.push(...[f.min, f.max].filter((v) => Number.isFinite(v) && v !== f.default));
    else if (f.type === 'multiselect' && f.options) values.push(f.options.map((o) => o.value), []);
    for (const v of values) add(`${f.key}=${label(v)}`, { ...needs(f), [f.key]: v });
  }
  // everything on with many long entries / everything off
  const all = (on) => Object.fromEntries(fields.filter((f) => !f.showIf && f.type !== 'select').map((f) => [f.key,
    f.type === 'bool' ? on : f.type === 'number' ? (on ? f.max ?? f.default : f.min ?? f.default) : on ? (f.options || []).map((o) => o.value) : []]));
  add('all on', all(true), true);
  add('all off', all(false));
  return out;
}

// Placements every option variant runs through: two half-width modules side by side (one of
// them "fill"), a full-width "fill" one, and one at its natural size – in every column.
const SLOTS = [
  [{ region: 'middle_left', width: 'half' }, { region: 'middle_left', width: 'half', height: 'fill' }, { region: 'middle_right', height: 'fill' }, { region: 'top_center' }],
  [{ region: 'top_left', width: 'half' }, { region: 'top_left', width: 'half' }, { region: 'bottom_right', height: 'fill' }, { region: 'middle_center' }],
  [{ region: 'bottom_bar' }, { region: 'middle_right', width: 'half' }, { region: 'middle_right', width: 'half', height: 'fill' }, { region: 'top_bar' }],
  [{ region: 'bottom_left', width: 'half', height: 'fill' }, { region: 'bottom_left', width: 'half' }, { region: 'top_right' }, { region: 'middle_left', height: 'fill' }],
  [{ region: 'middle_center', width: 'half' }, { region: 'middle_center', width: 'half' }, { region: 'bottom_center', height: 'fill' }, { region: 'top_right', width: 'half' }],
];

export function scenarios(types) {
  const out = [];
  for (const type of types) {
    const variants = optionVariants(type);
    // each variant visits several slots: chunks of 4 go through the slot sets in turn,
    // and the list is run twice, shifted, so every variant also lands at another kind of place
    const runs = [...variants, ...variants.slice(2), ...variants.slice(0, 2)];
    for (let i = 0, k = 0; i < runs.length; i += 4, k++) {
      const chunk = runs.slice(i, i + 4);
      const slots = SLOTS[k % SLOTS.length];
      out.push({ kind: 'options', name: `options-${type}-${k + 1}`, types: [type], modules: chunk.map((v, j) => ({ type, ...slots[j], title: v.name, settings: v.settings, long: v.long })) });
    }
  }
  for (const type of types) {
    // one module per row and per column at a time, so neighbours don't compete for space
    DIAGONALS.forEach((set, i) => {
      out.push({ kind: 'solo', name: `solo-${type}-${i + 1}`, types: [type], modules: set.map((region) => ({ type, region })) });
      out.push({ kind: 'long', name: `long-${type}-${i + 1}`, types: [type], modules: set.map((region) => ({ type, region, long: true })) });
    });
  }
  const dense = (name, modules) => out.push({ kind: 'dense', name: `dense-${name}`, types: [...new Set(modules.map((m) => m.type))], modules });

  // a hallway mirror like the default one, with a busy right column
  dense('hallway', [
    { type: 'clock', region: 'top_left' },
    { type: 'weather', region: 'top_right' },
    { type: 'weather_hints', region: 'top_center' },
    { type: 'calendar', region: 'middle_left', height: 'fill' },
    { type: 'waste', region: 'middle_right' },
    { type: 'tasks', region: 'middle_right', title: 'Erinnerungen' },
    { type: 'tasks', region: 'middle_right', title: 'Einkaufsliste', settings: { layout: 'inline' } },
    { type: 'greeting', region: 'bottom_center' },
    { type: 'news', region: 'bottom_bar' },
  ]);
  // two half-width modules next to each other, one of them "fill", with something below
  dense('half-fill', [
    { type: 'clock', region: 'top_left' },
    { type: 'github', region: 'middle_left', width: 'half' },
    { type: 'status', region: 'middle_left', width: 'half', height: 'fill' },
    { type: 'tasks', region: 'bottom_left' },
    { type: 'weather', region: 'top_right' },
    { type: 'transit', region: 'middle_right', height: 'fill' },
    { type: 'energy', region: 'bottom_right' },
  ]);
  // everything that is usually small, stacked in one column
  dense('stacked', [
    { type: 'fuel', region: 'middle_right' },
    { type: 'bikes', region: 'middle_right' },
    { type: 'airpollen', region: 'middle_right' },
    { type: 'parcels', region: 'middle_right' },
    { type: 'countdown', region: 'middle_right' },
    { type: 'football', region: 'middle_right' },
    { type: 'nowplaying', region: 'bottom_right' },
    { type: 'pistatus', region: 'bottom_left' },
    { type: 'network', region: 'bottom_left' },
    { type: 'homeassistant', region: 'middle_left' },
    { type: 'sky', region: 'middle_left' },
    { type: 'nightsky', region: 'middle_left' },
  ]);
  // big content in the centre and around it
  dense('centre', [
    { type: 'flights', region: 'middle_center', height: 'fill' },
    { type: 'f1', region: 'middle_left' },
    { type: 'transit', region: 'middle_right' },
    { type: 'camera', region: 'bottom_right' },
    { type: 'text', region: 'top_bar' },
    { type: 'clock', region: 'top_left' },
    { type: 'weather', region: 'top_right', settings: { layout: 'compact' } },
  ]);
  // every clock style in the narrow side columns and the centre
  dense('clocks', [
    { type: 'clock', region: 'top_left', settings: { size: 'huge' } },
    { type: 'clock', region: 'top_right', settings: { style: 'analogDigital' } },
    { type: 'clock', region: 'middle_left', settings: { style: 'word', wordStyle: 'grid' } },
    { type: 'clock', region: 'middle_center', settings: { style: 'word' } },
    { type: 'clock', region: 'middle_right', settings: { style: 'word', wordStyle: 'grid', size: 'medium' } },
    { type: 'clock', region: 'top_center', settings: { format24: false } },
  ]);
  dense('clocks-analog', [
    { type: 'clock', region: 'top_center', settings: { style: 'analog', size: 'huge' } },
    { type: 'clock', region: 'bottom_left', settings: { style: 'analog' } },
    { type: 'clock', region: 'bottom_right', settings: { format24: false, size: 'huge' } },
  ]);
  // half widths in every column
  dense('halves', [
    { type: 'tasks', region: 'middle_left', width: 'half' },
    { type: 'waste', region: 'middle_left', width: 'half' },
    { type: 'countdown', region: 'middle_center', width: 'half' },
    { type: 'fuel', region: 'middle_center', width: 'half' },
    { type: 'github', region: 'middle_right', width: 'half' },
    { type: 'energy', region: 'middle_right', width: 'half' },
  ]);
  return out;
}
