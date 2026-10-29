import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from './api';
import { LANGUAGES, langOf, translator, type Config, type Me, type Translate } from './shared';

export const VIEWS = ['layout', 'modules', 'general', 'backup'] as const;
export type View = (typeof VIEWS)[number];
const isView = (v: string): v is View => (VIEWS as readonly string[]).includes(v);

// ---- language ------------------------------------------------------------------------------
// Admin language: explicit override in localStorage, else the mirror locale, else the browser.
const LANG_KEY = 'mm-admin-lang';

function storedLang(): string | null {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return LANGUAGES.some((x) => x.value === l) ? l : null;
  } catch {
    return null;
  }
}
const autoLang = (cfg: Config | null) => langOf(cfg?.general?.locale || navigator.language);

type Store = {
  /** The working copy. Edited in place; call `touch()` after every mutation. */
  cfg: Config;
  me: Me;
  dirty: boolean;
  touch: () => void;
  /** Replace working copy and saved state (after load / save / import / reset). */
  setConfig: (cfg: Config) => void;
  save: () => Promise<void>;
  discard: () => void;
  saving: boolean;
  /** Serialized saved config – changes whenever the server state changes. */
  saved: string;
  view: View;
  setView: (v: View) => void;
  page: string;
  setPage: (id: string) => void;
  module: string | null;
  setModule: (id: string | null) => void;
  lang: string;
  pickLang: (l: string) => void;
  /** Translator for the admin UI. */
  t: Translate;
  /** Translator for content written into the config (mirror language). */
  mt: Translate;
};

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

/** Translator only – usable before the config has loaded. */
const LangCtx = createContext<{ t: Translate; lang: string; pickLang: (l: string) => void }>({
  t: translator('en'),
  lang: 'en',
  pickLang: () => {},
});
export const useT = () => useContext(LangCtx);

export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: (error: string | null) => ReactNode }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [saved, setSaved] = useState('');
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState(() => storedLang() || autoLang(null));
  const [view, setViewState] = useState<View>(() => (isView(location.hash.slice(1)) ? (location.hash.slice(1) as View) : 'layout'));
  const [page, setPage] = useState('');
  const [module, setModule] = useState<string | null>(null);

  const t = useMemo(() => translator(lang), [lang]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const touch = useCallback(() => setTick((x) => x + 1), []);
  const dirty = useMemo(() => !!cfg && JSON.stringify(cfg) !== saved, [cfg, saved, tick]);

  const setConfig = useCallback((next: Config) => {
    setCfg(next);
    setSaved(JSON.stringify(next));
    setPage((p) => (next.pages.some((x) => x.id === p) ? p : next.pages[0]?.id ?? ''));
    setModule((m) => (m && next.modules.some((x) => x.id === m) ? m : null));
    if (!storedLang()) setLang(autoLang(next));
  }, []);

  const pickLang = useCallback(
    (l: string) => {
      // picking the language the mirror locale implies drops the override, so the admin follows it again
      try {
        if (cfg && l === langOf(cfg.general.locale)) localStorage.removeItem(LANG_KEY);
        else localStorage.setItem(LANG_KEY, l);
      } catch {
        /* storage unavailable */
      }
      setLang(l);
    },
    [cfg],
  );

  // Saving: sends a snapshot of the working copy. Edits made while the request runs stay in the
  // working copy (still "unsaved"); a second save during a save waits for the first one; while
  // the server restarts (update) it retries until it is back.
  const savingRef = useRef<Promise<void> | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const save = useCallback(async () => {
    const previous = savingRef.current;
    if (previous) {
      await previous.catch(() => {});
      // another save queued behind the same one has started meanwhile – it sends the latest state
      if (savingRef.current !== null && savingRef.current !== previous) return;
    }
    const current = cfgRef.current;
    if (!current) return;
    const run = (async () => {
      setSaving(true);
      const snapshot = JSON.stringify(current);
      let waitToast: string | number | undefined;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const result = await api<Config>('/config', { method: 'PUT', body: snapshot });
            if (JSON.stringify(cfgRef.current) === snapshot) setConfig(result);
            else setSaved(snapshot); // edited meanwhile – keep the working copy, the rest stays unsaved
            if (waitToast !== undefined) toast.dismiss(waitToast);
            toast.success(t('Saved – the mirror updates automatically.'));
            return;
          } catch (err) {
            // server not reachable (restart during an update): wait up to ~3 minutes
            const unreachable = err instanceof TypeError || /^HTTP 50[234]$/.test(errorMessage(err));
            if (!unreachable || attempt >= 60) throw err;
            waitToast ??= toast.loading(t('The server is restarting – saving as soon as it is back …'));
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      } catch (err) {
        if (waitToast !== undefined) toast.dismiss(waitToast);
        toast.error(t(errorMessage(err)));
      } finally {
        setSaving(false);
      }
    })();
    savingRef.current = run;
    try {
      await run;
    } finally {
      if (savingRef.current === run) savingRef.current = null;
    }
  }, [setConfig, t]);

  const discard = useCallback(() => setConfig(JSON.parse(saved)), [saved, setConfig]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    history.replaceState(null, '', `#${v}`);
    window.scrollTo(0, 0);
  }, []);

  // initial load
  useEffect(() => {
    Promise.all([api<Me>('/me'), api<Config>('/config')])
      .then(([m, c]) => {
        setMe(m);
        setConfig(c);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [setConfig]);

  // hash routing (back/forward, manual edits)
  useEffect(() => {
    const onHash = () => {
      const v = location.hash.slice(1);
      if (isView(v)) setViewState(v);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Ctrl/Cmd+S and the unsaved-changes warning
  const latest = useRef({ dirty, save, saving });
  latest.current = { dirty, save, saving };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (latest.current.dirty && !latest.current.saving) latest.current.save();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty) e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  const langValue = useMemo(() => ({ t, lang, pickLang }), [t, lang, pickLang]);

  if (!cfg || !me) return <LangCtx.Provider value={langValue}>{fallback(error)}</LangCtx.Provider>;

  const store: Store = {
    cfg,
    me,
    dirty,
    touch,
    setConfig,
    save,
    discard,
    saving,
    saved,
    view,
    setView,
    page: cfg.pages.some((p) => p.id === page) ? page : cfg.pages[0].id,
    setPage,
    module,
    setModule,
    lang,
    pickLang,
    t,
    mt: translator(langOf(cfg.general.locale)),
  };
  return (
    <LangCtx.Provider value={langValue}>
      <Ctx.Provider value={store}>{children}</Ctx.Provider>
    </LangCtx.Provider>
  );
}
