import { MODULE_TYPES, REGIONS, type Config, type Module, type Translate } from './shared';

export const typeLabel = (m: Module, t: Translate) => t(MODULE_TYPES[m.type]?.label || m.type);
export const moduleName = (m: Module, t: Translate) => m.title || typeLabel(m, t);
export const onPage = (m: Module, pageId: string) => m.pages.includes('*') || m.pages.includes(pageId);
export const regionLabel = (id: string, t: Translate) => t(REGIONS.find((r) => r.id === id)?.label || id);

export function pagesSummary(m: Module, cfg: Config, t: Translate) {
  if (m.pages.includes('*')) return t('All pages');
  return m.pages.map((id) => cfg.pages.find((p) => p.id === id)?.name || id).join(', ');
}
