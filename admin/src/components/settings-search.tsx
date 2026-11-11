import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { moduleName } from '@/lib/helpers';
import { GENERAL_FIELDS, GENERAL_GROUPS, MODULE_TYPES, type Field } from '@/lib/shared';
import { useStore, type View } from '@/lib/store';
import { TAB_EVENT, TAB_KEY } from '@/views/general-view';

type Hit = { key: string; title: string; path: string; text: string; go: () => void };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// Scrolls to a field once the view has rendered it and highlights it for a moment.
function focusField(key: string | null) {
  let tries = 0;
  const find = () => {
    const el = key ? document.querySelector<HTMLElement>(`main [data-field="${CSS.escape(key)}"]`) : null;
    if (!el) {
      if (key && tries++ < 15) setTimeout(find, 80);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary', 'ring-offset-4', 'ring-offset-background');
    el.querySelector<HTMLElement>('input, button, [role="switch"], [role="combobox"]')?.focus({ preventScroll: true });
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-4', 'ring-offset-background'), 2200);
  };
  setTimeout(find, 60);
}

/** Finds any setting (general, modules, pages) and jumps there. Ctrl/⌘ + K opens it. */
export function SettingsSearch() {
  const { cfg, t, setView, setModule, setPage } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
    }
  }, [open]);

  // Everything searchable, built when the dialog opens (labels in the admin's language).
  const index = useMemo<Hit[]>(() => {
    if (!open) return [];
    const go = (view: View, then: () => void, field: string | null) => () => {
      then();
      setView(view);
      setOpen(false);
      focusField(field);
    };
    const text = (f: Field) => `${t(f.label)} ${f.label} ${f.help ? t(f.help) : ''}`;
    const out: Hit[] = [];
    const groups = new Map(GENERAL_GROUPS.map((g) => [g.id, t(g.label)]));
    for (const f of GENERAL_FIELDS.flatMap((g) => [g, ...(g.fields || []).map((sub) => ({ ...sub, key: g.key, group: g.group, label: sub.label, help: sub.help }))])) {
      const group = f.group || 'basics';
      out.push({
        key: `g:${f.key}:${f.label}`,
        title: t(f.label),
        path: `${t('General')} › ${groups.get(group) || group}`,
        text: text(f),
        go: go('general', () => {
          try {
            localStorage.setItem(TAB_KEY, group);
          } catch {
            /* storage unavailable */
          }
          window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: group }));
        }, f.key),
      });
    }
    for (const m of cfg.modules) {
      const type = MODULE_TYPES[m.type];
      if (!type) continue;
      const name = moduleName(m, t);
      out.push({ key: `m:${m.id}`, title: name, path: `${t('Modules')} · ${t(type.label)}`, text: `${name} ${t(type.label)} ${m.type}`, go: go('modules', () => setModule(m.id), null) });
      for (const f of type.fields) {
        if (f.type === 'shortcutSetup' || f.type === 'spotifyConnect') continue;
        out.push({ key: `m:${m.id}:${f.key}`, title: t(f.label), path: `${t('Modules')} › ${name}`, text: `${text(f)} ${name}`, go: go('modules', () => setModule(m.id), f.key) });
        // fields inside lists (feeds, calendars, waste types …) lead to the list
        for (const sub of f.fields || []) {
          out.push({ key: `m:${m.id}:${f.key}:${sub.key}`, title: t(sub.label), path: `${t('Modules')} › ${name} › ${t(f.label)}`, text: `${text(sub)} ${name} ${t(f.label)}`, go: go('modules', () => setModule(m.id), f.key) });
        }
      }
    }
    for (const p of cfg.pages) {
      out.push({ key: `p:${p.id}`, title: p.name, path: t('Pages & layout'), text: `${p.name} ${t('Page')}`, go: go('layout', () => setPage(p.id), null) });
    }
    return out;
  }, [open, cfg, t, setView, setModule, setPage]);

  const hits = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return index
      .map((h) => {
        const title = norm(h.title);
        const all = norm(`${h.text} ${h.path}`);
        if (!words.every((w) => all.includes(w))) return null;
        // title matches first, then title starts, then the rest
        const score = words.reduce((s, w) => s + (title.startsWith(w) ? 3 : title.includes(w) ? 2 : 0), 0);
        return { h, score };
      })
      .filter((x): x is { h: Hit; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((x) => x.h);
  }, [q, index]);

  const choose = (h?: Hit) => h?.go();

  return (
    <>
      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setOpen(true)} title={`${t('Search settings')} (Ctrl+K)`}>
        <Search />
        <span className="sr-only">{t('Search settings')}</span>
      </Button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label={t('Search settings')} className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl">
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <input
                ref={input}
                autoFocus
                value={q}
                placeholder={t('Search settings, modules and pages …')}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                onChange={(e) => {
                  setQ(e.target.value);
                  setSel(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSel((s) => Math.min(hits.length - 1, s + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSel((s) => Math.max(0, s - 1));
                  } else if (e.key === 'Enter') choose(hits[sel]);
                }}
              />
              <kbd className="rounded border px-1.5 text-[10px] text-muted-foreground">Esc</kbd>
            </div>
            <div className="overflow-y-auto p-1.5">
              {q && !hits.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('Nothing found')}</p>}
              {hits.map((h, i) => (
                <button
                  key={h.key}
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => choose(h)}
                  className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left', i === sel && 'bg-accent')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{h.path}</span>
                  </span>
                  {i === sel && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
