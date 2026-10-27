import { MODULE_TYPES, REGIONS, type Config, type Module, type Translate } from './shared';

export const typeLabel = (m: Module, t: Translate) => t(MODULE_TYPES[m.type]?.label || m.type);
export const moduleName = (m: Module, t: Translate) => m.title || typeLabel(m, t);
export const onPage = (m: Module, pageId: string) => m.pages.includes('*') || m.pages.includes(pageId);
export const regionLabel = (id: string, t: Translate) => t(REGIONS.find((r) => r.id === id)?.label || id);

export function pagesSummary(m: Module, cfg: Config, t: Translate) {
  if (m.pages.includes('*')) return t('All pages');
  return m.pages.map((id) => cfg.pages.find((p) => p.id === id)?.name || id).join(', ');
}

/** Modules that are identical except for id/pages/order (e.g. from an older "duplicate page"). */
export function duplicateGroups(modules: Module[]): Module[][] {
  const groups = new Map<string, Module[]>();
  for (const m of modules) {
    const { id, pages, order, ...rest } = m;
    const key = JSON.stringify(rest);
    groups.set(key, [...(groups.get(key) || []), m]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Keeps the first module of each group and shows it on all pages of the group. */
export function mergeDuplicates(modules: Module[]): number {
  let removed = 0;
  for (const [keep, ...rest] of duplicateGroups(modules)) {
    const pages = new Set(keep.pages);
    for (const m of rest) {
      m.pages.forEach((p) => pages.add(p));
      modules.splice(modules.indexOf(m), 1);
      removed++;
    }
    keep.pages = pages.has('*') ? ['*'] : [...pages];
  }
  return removed;
}
