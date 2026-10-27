// Differences between the saved config and the working copy – for the "Unsaved changes" dialog.
import { CONDITIONS as CONDITIONS_JS } from '../../../public/shared/conditions.js';
import { GENERAL_FIELDS, MODULE_TYPES, REGIONS, type Field, type Translate, type Values } from '@/lib/shared';

const CONDITIONS = CONDITIONS_JS as Record<string, { label: string } | undefined>;
const WEEKDAY_IDS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export type Change = { label: string; from: string; to: string };
export type DiffEntry = {
  section: 'general' | 'page' | 'module';
  title: string;
  kind: 'added' | 'removed' | 'changed';
  changes: Change[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function scheduleText(s: Values | undefined, t: Translate) {
  if (!s?.enabled) return t('Off');
  const days = (s.days || []).length === 7 ? '' : `${(s.days || []).map((d: number) => t(WEEKDAY_IDS[d - 1] || String(d))).join(', ')} · `;
  return `${days}${s.from}–${s.to}`;
}

function valueText(v: unknown, field: Field | undefined, t: Translate): string {
  if (field?.secret) return v ? '••••••' : '–';
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'boolean') return v ? t('On') : t('Off');
  const opt = field?.options?.find((o) => o.value === v);
  if (opt) return t(opt.label);
  if (Array.isArray(v)) {
    if (field?.options) return v.map((x) => t(field.options!.find((o) => o.value === x)?.label || String(x))).join(', ') || '–';
    if (field?.fields) return t('{n} entries', { n: v.length });
    return short(v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')) || '–';
  }
  if (typeof v === 'object') {
    const o = v as Values;
    return short(String(o.name ?? o.label ?? JSON.stringify(o)));
  }
  return short(String(v));
}

// Field-by-field changes of a settings object, using the schema labels.
function fieldChanges(fields: Field[], a: Values, b: Values, t: Translate): Change[] {
  const out: Change[] = [];
  const known = new Set<string>();
  for (const f of fields) {
    known.add(f.key);
    if (same(a[f.key], b[f.key])) continue;
    if (f.fields && Array.isArray(a[f.key]) && Array.isArray(b[f.key]) && a[f.key].length === b[f.key].length) {
      // list of items (calendars, waste types …): name the changed entries
      (b[f.key] as Values[]).forEach((item, i) => {
        for (const c of fieldChanges(f.fields!, a[f.key][i] || {}, item || {}, t)) {
          out.push({ ...c, label: `${t(f.label)} › ${item?.name || item?.title || `#${i + 1}`} › ${c.label}` });
        }
      });
      continue;
    }
    out.push({ label: t(f.label), from: valueText(a[f.key], f, t), to: valueText(b[f.key], f, t) });
  }
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (!known.has(k) && !k.startsWith('_') && !same(a[k], b[k])) out.push({ label: k, from: valueText(a[k], undefined, t), to: valueText(b[k], undefined, t) });
  }
  return out;
}

export function configDiff(savedJson: string, cur: Values, t: Translate): DiffEntry[] {
  let saved: Values;
  try {
    saved = JSON.parse(savedJson);
  } catch {
    return [];
  }
  const out: DiffEntry[] = [];
  const pageName = (id: string, cfg: Values) => (id === '*' ? t('all pages') : cfg.pages.find((p: Values) => p.id === id)?.name || id);
  const modName = (m: Values) => m.title || t(MODULE_TYPES[m.type]?.label || m.type);
  const regionName = (id: string) => t(REGIONS.find((r) => r.id === id)?.label || id);

  // ---- general
  const g = fieldChanges(GENERAL_FIELDS, saved.general || {}, cur.general || {}, t);
  if (g.length) out.push({ section: 'general', title: t('General'), kind: 'changed', changes: g });

  // ---- pages
  const pagesBefore = new Map<string, Values>(saved.pages.map((p: Values) => [p.id, p]));
  const pagesAfter = new Map<string, Values>(cur.pages.map((p: Values) => [p.id, p]));
  const pageProps: [string, string, (v: any, cfg: Values) => string][] = [
    ['name', 'Name', (v) => v || '–'],
    ['duration', 'Display duration in seconds', (v) => String(v)],
    ['enabled', 'Page active', (v) => (v ? t('On') : t('Off'))],
    ['schedule', 'Only show at certain times', (v) => scheduleText(v, t)],
    ['dateFrom', 'From', (v) => v || '–'],
    ['dateTo', 'Until', (v) => v || '–'],
    ['exclusive', 'Exclusive', (v) => (v ? t('On') : t('Off'))],
    ['skipEmpty', 'Skip when empty', (v) => (v !== false ? t('On') : t('Off'))],
    ['ambient', 'Weather animation in the background', (v) => t({ subtle: 'Subtle', full: 'Strong' }[v as string] || 'Off')],
    ['showWhen', 'Only show when a module has something to show', (v, cfg) => {
      const m = v && cfg.modules.find((x: Values) => x.id === v);
      return m ? modName(m) : v ? String(v) : t('Always');
    }],
  ];
  for (const [id, p] of pagesAfter) {
    const before = pagesBefore.get(id);
    if (!before) {
      out.push({ section: 'page', title: p.name, kind: 'added', changes: [] });
      continue;
    }
    const changes = pageProps
      .filter(([k]) => !same(before[k], p[k]))
      .map(([k, label, fmt]) => ({ label: t(label), from: fmt(before[k], saved), to: fmt(p[k], cur) }));
    if (changes.length) out.push({ section: 'page', title: p.name, kind: 'changed', changes });
  }
  for (const [id, p] of pagesBefore) if (!pagesAfter.has(id)) out.push({ section: 'page', title: p.name, kind: 'removed', changes: [] });
  const orderBefore = saved.pages.map((p: Values) => p.id).filter((id: string) => pagesAfter.has(id));
  const orderAfter = cur.pages.map((p: Values) => p.id).filter((id: string) => pagesBefore.has(id));
  if (!same(orderBefore, orderAfter)) {
    out.push({ section: 'page', title: t('Pages'), kind: 'changed', changes: [{ label: t('Order'), from: orderBefore.map((id: string) => pageName(id, saved)).join(' → '), to: orderAfter.map((id: string) => pageName(id, cur)).join(' → ') }] });
  }

  // ---- modules
  const modsBefore = new Map<string, Values>(saved.modules.map((m: Values) => [m.id, m]));
  const modsAfter = new Map<string, Values>(cur.modules.map((m: Values) => [m.id, m]));
  for (const [id, m] of modsAfter) {
    const before = modsBefore.get(id);
    const typeLabel = t(MODULE_TYPES[m.type]?.label || m.type);
    const title = m.title && m.title !== typeLabel ? `${m.title} (${typeLabel})` : typeLabel;
    if (!before) {
      out.push({ section: 'module', title, kind: 'added', changes: [{ label: t('Position'), from: '', to: `${regionName(m.region)} · ${m.pages.map((p: string) => pageName(p, cur)).join(', ')}` }] });
      continue;
    }
    const changes: Change[] = [];
    const prop = (k: string, label: string, fmt: (v: any, cfg: Values) => string) => {
      if (!same(before[k], m[k])) changes.push({ label: t(label), from: fmt(before[k], saved), to: fmt(m[k], cur) });
    };
    prop('enabled', 'Module active', (v) => (v ? t('On') : t('Off')));
    prop('title', 'Heading (empty = none)', (v) => v || '–');
    prop('region', 'Position', (v) => regionName(v));
    prop('pages', 'Pages', (v: string[], cfg) => v.map((p) => pageName(p, cfg)).join(', ') || '–');
    prop('height', 'Height', (v) => (v === 'fill' ? t('Use as much space as possible') : t('Automatic')));
    prop('order', 'Order within the area', (v) => String(v));
    prop('schedule', 'Only show at certain times', (v) => scheduleText(v, t));
    prop('onlyWithContent', CONDITIONS[m.type]?.label || 'onlyWithContent', (v) => (v ? t('On') : t('Off')));
    changes.push(...fieldChanges(MODULE_TYPES[m.type]?.fields || [], before.settings || {}, m.settings || {}, t));
    if (changes.length) out.push({ section: 'module', title, kind: 'changed', changes });
  }
  for (const [id, m] of modsBefore) {
    if (!modsAfter.has(id)) out.push({ section: 'module', title: m.title || t(MODULE_TYPES[m.type]?.label || m.type), kind: 'removed', changes: [] });
  }
  return out;
}
