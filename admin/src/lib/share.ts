// Share single modules or pages between mirrors: export as a small JSON file (without
// tokens/passwords), import as new modules (and a new page) next to the existing ones.
import { clone } from '@/lib/api';
import { MODULE_TYPES, uid, type Config, type Field, type Module, type Page, type Values } from '@/lib/shared';

type SharedModule = Omit<Module, 'id' | 'pages' | 'placements' | 'insteadOf'> & { ref: string; insteadOf?: string };
export type SharedFile =
  | { app: 'magicmirror'; kind: 'module'; exportVersion: 1; exportedAt: string; module: SharedModule }
  | { app: 'magicmirror'; kind: 'page'; exportVersion: 1; exportedAt: string; page: Omit<Page, 'id' | 'showWhen'> & { showWhen?: string }; modules: SharedModule[] };

// Secret fields (tokens, passwords, private URLs) stay at home. Returns how many were removed.
function stripSecrets(fields: Field[], values: Values): number {
  let n = 0;
  for (const f of fields) {
    if (f.secret && values[f.key]) {
      delete values[f.key];
      n++;
    } else if (f.type === 'list' && f.fields && Array.isArray(values[f.key])) {
      for (const item of values[f.key]) n += stripSecrets(f.fields, item || {});
    }
  }
  return n;
}

function shareModule(m: Module, pageId?: string): { mod: SharedModule; secrets: number } {
  const c = clone(m);
  const secrets = stripSecrets(MODULE_TYPES[c.type]?.fields || [], c.settings || {});
  const pl = pageId ? c.placements?.[pageId] : undefined;
  const mod: SharedModule = {
    ref: c.id,
    type: c.type,
    enabled: c.enabled,
    title: c.title,
    region: pl?.region || c.region,
    order: pl?.order ?? c.order,
    height: c.height,
    width: c.width,
    onlyWithContent: c.onlyWithContent,
    schedule: c.schedule,
    insteadOf: c.insteadOf,
    settings: c.settings,
  };
  return { mod, secrets };
}

export function exportModule(m: Module) {
  const { mod, secrets } = shareModule(m);
  delete mod.insteadOf; // refers to a module the other mirror does not have
  const file: SharedFile = { app: 'magicmirror', kind: 'module', exportVersion: 1, exportedAt: new Date().toISOString(), module: mod };
  return { file, secrets };
}

// A page with the modules on it (not those shown on all pages).
export function exportPage(p: Page, cfg: Config) {
  const mods = cfg.modules.filter((m) => !m.pages.includes('*') && m.pages.includes(p.id));
  let secrets = 0;
  const shared = mods.map((m) => {
    const r = shareModule(m, p.id);
    secrets += r.secrets;
    return r.mod;
  });
  const refs = new Set(shared.map((m) => m.ref));
  for (const m of shared) if (m.insteadOf && !refs.has(m.insteadOf)) delete m.insteadOf;
  const { id: _id, ...page } = clone(p);
  if (page.showWhen && !refs.has(page.showWhen)) delete page.showWhen;
  const file: SharedFile = { app: 'magicmirror', kind: 'page', exportVersion: 1, exportedAt: new Date().toISOString(), page, modules: shared };
  return { file, secrets };
}

export function download(file: SharedFile, name: string) {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || file.kind;
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `magicmirror-${file.kind}-${slug}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isSharedFile(json: unknown): json is SharedFile {
  const j = json as SharedFile;
  return !!j && j.app === 'magicmirror' && (j.kind === 'module' || j.kind === 'page');
}

// Adds the shared module(s) to `cfg` (in place). A module alone lands in "available
// modules" (on no page); a page arrives with its modules on it.
export function importShared(file: SharedFile, cfg: Config, mt: (s: string, v?: Values) => string) {
  const known = (m: SharedModule) => !!MODULE_TYPES[m.type];
  const make = (m: SharedModule, pages: string[], ids: Map<string, string>): Module => {
    const { ref, insteadOf, ...rest } = clone(m);
    const id = ids.get(ref) || uid('m');
    return { ...rest, id, pages, insteadOf: insteadOf ? ids.get(insteadOf) : undefined, settings: rest.settings || {} } as Module;
  };
  if (file.kind === 'module') {
    if (!known(file.module)) throw new Error('Unknown module type');
    const m = make(file.module, [], new Map());
    cfg.modules.push(m);
    return { page: null as Page | null, modules: [m], skipped: 0 };
  }
  const page: Page = { ...clone(file.page), id: uid('p'), name: file.page.name || mt('Imported page') };
  const usable = file.modules.filter(known);
  const ids = new Map(usable.map((m) => [m.ref, uid('m')]));
  const mods = usable.map((m) => make(m, [page.id], ids));
  if (file.page.showWhen) page.showWhen = ids.get(file.page.showWhen);
  if (!page.showWhen) delete page.showWhen;
  // mirrors of the other installation do not exist here
  const displays = new Set(((cfg.general.displays || []) as { id: string }[]).map((d) => d.id));
  if (page.displays?.length) page.displays = page.displays.filter((d) => displays.has(d));
  cfg.pages.push(page);
  cfg.modules.push(...mods);
  return { page, modules: mods, skipped: file.modules.length - usable.length };
}
