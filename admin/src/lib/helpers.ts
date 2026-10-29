import { MODULE_TYPES, REGIONS, type Config, type Module, type Translate } from './shared';

export const typeLabel = (m: Module, t: Translate) => t(MODULE_TYPES[m.type]?.label || m.type);
export const moduleName = (m: Module, t: Translate) => m.title || typeLabel(m, t);
export const onPage = (m: Module, pageId: string) => m.pages.includes('*') || m.pages.includes(pageId);

/** Where a module sits on a page: its own position there, else its default position. */
export const placement = (m: Module, pageId: string) => {
  const p = m.placements?.[pageId];
  return p ? { region: p.region, order: p.order } : { region: m.region, order: m.order };
};

/** Pages a module is shown on (ids). */
const pagesOf = (m: Module, allPages: string[]) => (m.pages.includes('*') ? allPages : m.pages);

/**
 * Moves a module on one page only. A module that is on just this page keeps it as its
 * default position; on several pages this page gets its own position.
 */
export function setPlacement(m: Module, pageId: string, region: string, order: number, allPages: string[]) {
  const shown = pagesOf(m, allPages);
  if (shown.length <= 1 && (shown[0] ?? pageId) === pageId) {
    m.region = region;
    m.order = order;
    if (m.placements) delete m.placements[pageId];
    return;
  }
  m.placements = { ...(m.placements || {}), [pageId]: { region, order } };
}
export const regionLabel = (id: string, t: Translate) => t(REGIONS.find((r) => r.id === id)?.label || id);

export function pagesSummary(m: Module, cfg: Config, t: Translate) {
  if (m.pages.includes('*')) return t('All pages');
  if (!m.pages.length) return t('Not on any page yet');
  return m.pages.map((id) => cfg.pages.find((p) => p.id === id)?.name || id).join(', ');
}

/** Modules that are identical except for id/pages/order (e.g. from an older "duplicate page"). */
export function duplicateGroups(modules: Module[]): Module[][] {
  const groups = new Map<string, Module[]>();
  for (const m of modules) {
    if (!m.pages.length) continue; // not placed yet (e.g. just added with default settings)
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
