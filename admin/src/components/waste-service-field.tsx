import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FlaskConical, Loader2, Recycle, Search, X } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import type { Values } from '@/lib/shared';
import { useStore } from '@/lib/store';

// Waste collection by town/address via the optional "wastecollect" sidecar (compose profile "waste").
// Value stored in the module settings: null | { source, title, args, labels }.

export type WasteService = { source: string; title: string; args: Record<string, string>; labels?: Record<string, string> };

type SearchResult = { id: string; title: string; service: string; source: string; country: string; args_template: Record<string, unknown> };
type Lookup = { kind: 'search' | 'list' | 'suggest'; ids?: boolean; multi?: boolean; depends?: string[]; placeholder?: string };
type Param = { name: string; label: string; help?: string; required: boolean; default: unknown; type: string; options?: string[]; lookup?: Lookup };
type ParamsInfo = { source: string; title: string; url: string; howto?: string; docs?: string; params: Param[] };
type Opt = { value: string; label: string; set?: Record<string, string> };
type FetchResult = { entries: { date: string; type: string }[]; types?: string[] };
type ApiErr = { message: string; argument?: string; suggestions?: string[] };

/** Fetch helper that keeps the JSON error body (argument + suggestions from the library). */
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) return api<T>(path); // let the shared helper handle the sign-in redirect
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { argument: data.argument, suggestions: data.suggestions });
  return data as T;
}
const toErr = (err: unknown): ApiErr => ({
  message: errorMessage(err),
  argument: (err as { argument?: string })?.argument,
  suggestions: (err as { suggestions?: string[] })?.suggestions,
});

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Same keyword matching as the server (src/providers/waste.js). */
function classify(types: Values[] | undefined, title: string) {
  const t = title.toLowerCase();
  return (types || []).find((type) =>
    String(type.keywords || '')
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
      .some((k) => t.includes(k)),
  );
}

export function WasteServiceField({ value, values, onValue }: { value: WasteService | null; values: Values; onValue: (v: WasteService | null) => void }) {
  const { t } = useStore();
  const [searching, setSearching] = useState(!value);
  useEffect(() => {
    if (!value) setSearching(true);
  }, [value]);

  return (
    <div className="flex flex-col gap-3">
      {value && (
        <div className="flex items-center gap-2.5 rounded-lg bg-secondary px-3 py-2 text-sm">
          <Recycle className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1 truncate">
            <b className="font-semibold">{value.title}</b> <span className="text-xs text-muted-foreground">{summary(value)}</span>
          </div>
          {!searching && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSearching(true)}>
              {t('Change')}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('Remove')} title={t('Remove')} className="hover:text-destructive" onClick={() => onValue(null)}>
            <X />
          </Button>
        </div>
      )}
      {searching && (
        <ServiceSearch
          onPick={(r) => {
            const args: Record<string, string> = {};
            for (const [k, v] of Object.entries(r.args_template || {})) args[k] = Array.isArray(v) ? v.join(',') : String(v);
            onValue({ source: r.source, title: r.title, args, labels: {} });
            setSearching(false);
          }}
          onCancel={value ? () => setSearching(false) : undefined}
        />
      )}
      {value && !searching && <ServiceParams key={value.source + value.title} value={value} types={values.types as Values[]} onValue={onValue} />}
    </div>
  );
}

function summary(v: WasteService) {
  // picked labels and short plain values – no ids or service keys
  const parts = Object.entries(v.args || {})
    .filter(([k, val]) => !k.startsWith('_') && val !== '' && val !== undefined)
    .map(([k, val]) => v.labels?.[k] || (/^[0-9a-f]{12,}$|^\d{6,}$/i.test(String(val)) ? '' : val))
    .filter(Boolean);
  return parts.filter((p) => String(p).length < 80).slice(-3).join(' · ');
}

// ---- step 1: find the town / service ----------------------------------------------------------

function ServiceSearch({ onPick, onCancel }: { onPick: (r: SearchResult) => void; onCancel?: () => void }) {
  const { t } = useStore();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 350);
  const [state, setState] = useState<{ loading: boolean; results: SearchResult[] | null; error?: string }>({ loading: false, results: null });
  useEffect(() => {
    if (dq.length < 2) return setState({ loading: false, results: null });
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    call<SearchResult[]>(`/waste/search?${new URLSearchParams({ q: dq, country: 'de' })}`)
      .then((results) => !stale && setState({ loading: false, results }))
      .catch((err) => !stale && setState({ loading: false, results: null, error: errorMessage(err) }));
    return () => {
      stale = true;
    };
  }, [dq]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" autoFocus={!!onCancel} value={q} placeholder={t('Search your town or waste company, e.g. Leipzig')} className="pl-8" onChange={(e) => setQ(e.target.value)} />
          {state.loading && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        )}
      </div>
      {state.error && <p className="text-xs text-destructive">{t(state.error)}</p>}
      {state.results &&
        (state.results.length ? (
          <ScrollArea className="rounded-lg border bg-background [&>[data-slot=scroll-area-viewport]]:max-h-72">
            <div className="flex flex-col">
              {state.results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex items-baseline gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => onPick(r)}
                >
                  <b className="font-semibold">{r.title}</b>
                  {r.service && <span className="truncate text-xs text-muted-foreground">{r.service}</span>}
                  {r.country !== 'de' && (
                    <Badge variant="outline" className="ml-auto uppercase">
                      {r.country}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-xs text-muted-foreground">{t('Nothing found – try the county (Landkreis) or the name of your waste company')}</p>
        ))}
    </div>
  );
}

// ---- step 2: address parameters + test ------------------------------------------------------

function ServiceParams({ value, types, onValue }: { value: WasteService; types: Values[]; onValue: (v: WasteService) => void }) {
  const { t, lang } = useStore();
  const [info, setInfo] = useState<{ data?: ParamsInfo; error?: string }>({});
  const [test, setTest] = useState<{ loading?: boolean; result?: FetchResult; error?: ApiErr }>({});
  // presets from the search entry (e.g. the service key) stay hidden
  const presets = useRef(new Set(Object.keys(value.args || {}).filter((k) => value.args[k] !== '')));
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    let stale = false;
    call<ParamsInfo>(`/waste/params?${new URLSearchParams({ source: value.source, lang })}`)
      .then((data) => !stale && setInfo({ data }))
      .catch((err) => !stale && setInfo({ error: errorMessage(err) }));
    return () => {
      stale = true;
    };
  }, [value.source, lang]);

  const params = info.data?.params || [];
  const visible = params.filter((p) => !presets.current.has(p.name) || showPresets);
  const hiddenCount = params.length - visible.length;

  /** Set one argument; clears parameters that depend on it (cascading lookups). */
  const setArg = (name: string, val: string, label?: string, extra?: Record<string, string>) => {
    const args = { ...value.args, [name]: val };
    const labels = { ...(value.labels || {}) };
    if (label !== undefined && label !== val) labels[name] = label;
    else delete labels[name];
    const clear = (n: string) => {
      for (const p of params) {
        if (p.lookup?.depends?.includes(n) && args[p.name] !== undefined && args[p.name] !== '') {
          args[p.name] = '';
          delete labels[p.name];
          clear(p.name);
        }
      }
    };
    clear(name);
    if (extra) Object.assign(args, extra);
    for (const k of Object.keys(args)) if (args[k] === '') delete args[k];
    onValue({ ...value, args, labels });
    setTest({});
  };

  const runTest = async () => {
    setTest({ loading: true });
    try {
      setTest({ result: await call<FetchResult>('/waste/fetch', { source: value.source, args: value.args }) });
    } catch (err) {
      setTest({ error: toErr(err) });
    }
  };

  if (info.error) return <p className="text-xs text-destructive">{t(info.error)}</p>;
  if (!info.data)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {t('Loading …')}
      </p>
    );

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background/60 p-3">
      {info.data.howto && <p className="text-xs whitespace-pre-line text-muted-foreground">{info.data.howto}</p>}
      {visible.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-3">
          {visible.map((p) => (
            <ParamInput key={p.name} param={p} value={value} onSet={setArg} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('No address needed – just test it.')}</p>
      )}
      {hiddenCount > 0 && (
        <button type="button" className="self-start text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowPresets(true)}>
          {t('Show preset parameters ({n})', { n: hiddenCount })}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={runTest} disabled={test.loading}>
          {test.loading ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          {t('Test')}
        </Button>
        {info.data.docs && (
          <a href={info.data.docs} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {t('Documentation of this source')}
          </a>
        )}
      </div>
      {test.error && (
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="text-destructive">
            {test.error.argument && <b>{params.find((p) => p.name === test.error!.argument)?.label || test.error.argument}: </b>}
            {t(test.error.message)}
          </p>
          {test.error.argument && test.error.suggestions?.length ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">{t('Did you mean:')}</span>
              {test.error.suggestions.slice(0, 30).map((s) => (
                <Button key={s} type="button" variant="outline" size="xs" onClick={() => setArg(test.error!.argument!, s)}>
                  {s}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {test.result && <TestResult result={test.result} types={types} />}
    </div>
  );
}

function TestResult({ result, types }: { result: FetchResult; types: Values[] }) {
  const { t, lang } = useStore();
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short' }), [lang]);
  if (!result.entries.length) return <p className="text-xs text-muted-foreground">{t('No collection dates found for these settings')}</p>;
  const typeNames = result.types?.length ? result.types : [...new Set(result.entries.map((e) => e.type))];
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">{t('Next collections')}</Label>
      <ul className="flex flex-col gap-1 text-sm">
        {result.entries.slice(0, 8).map((e, i) => {
          const type = classify(types, e.type);
          return (
            <li key={i} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-muted-foreground tabular-nums">{fmt.format(new Date(`${e.date}T12:00:00`))}</span>
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: String(type?.color || '#9ca3af') }} />
              <span className="truncate">{e.type}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-1">
        {typeNames.map((name) => {
          const type = classify(types, name);
          return (
            <Badge key={name} variant="outline" className="gap-1.5" title={type ? `→ ${type.name}` : t('Matches no waste type – add a keyword below')}>
              <span className="size-2 rounded-full" style={{ background: String(type?.color || '#9ca3af') }} />
              {name}
              <span className="text-muted-foreground">→ {type ? String(type.name) : t('not assigned')}</span>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

// ---- one parameter --------------------------------------------------------------------------

function ParamInput({ param, value, onSet }: { param: Param; value: WasteService; onSet: (name: string, val: string, label?: string, extra?: Record<string, string>) => void }) {
  const { t } = useStore();
  const id = `ws-${param.name}`;
  const cur = value.args?.[param.name] ?? '';
  const label = (
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
      {param.label}
      {!param.required && !param.name.startsWith('_') && !/optional/i.test(param.label) && <span className="font-normal opacity-70"> ({t('optional')})</span>}
    </Label>
  );
  let input;
  if (param.lookup) input = <LookupInput id={id} param={param} value={value} onSet={onSet} />;
  else if (param.type === 'bool')
    input = <Switch id={id} checked={cur === 'true' || cur === (true as unknown)} onCheckedChange={(c) => onSet(param.name, c ? 'true' : 'false')} />;
  else if (param.type === 'select' && param.options?.length)
    input = (
      <select
        id={id}
        value={cur}
        onChange={(e) => onSet(param.name, e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
      >
        <option value="">–</option>
        {param.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  else
    input = (
      <Input
        id={id}
        value={cur}
        inputMode={param.type === 'number' ? 'numeric' : undefined}
        placeholder={param.default !== null && param.default !== undefined ? String(param.default) : undefined}
        onChange={(e) => onSet(param.name, e.target.value)}
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label}
      {input}
      {param.help && <p className="text-xs text-muted-foreground">{param.help}</p>}
    </div>
  );
}

/** Text input with a suggestion list (address lookups of the source). */
function LookupInput({ id, param, value, onSet }: { id: string; param: Param; value: WasteService; onSet: (name: string, val: string, label?: string, extra?: Record<string, string>) => void }) {
  const { t } = useStore();
  const lk = param.lookup!;
  const cur = value.args?.[param.name] ?? '';
  const shown = value.labels?.[param.name] ?? cur;
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ loading?: boolean; options?: Opt[]; error?: string }>({});
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setText(shown), [shown]);
  // close the list when clicking elsewhere
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const argsKey = JSON.stringify(value.args || {});
  const load = async (q: string) => {
    setOpen(true);
    setState({ loading: true });
    try {
      const qs = new URLSearchParams({ source: value.source, param: param.name, q, args: argsKey });
      const res = await call<{ options: Opt[]; message?: string }>(`/waste/options?${qs}`);
      setState({ options: res.options, error: res.options.length ? undefined : res.message });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  };
  // "search" lookups query the server while typing; lists are loaded once and filtered locally
  const dtext = useDebounced(text, 500);
  const typed = useRef(false);
  useEffect(() => {
    // long lists are cut off by the server, so typing narrows them there too
    if (typed.current && (lk.kind === 'list' || dtext.trim().length >= 2)) load(dtext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtext]);
  // a parent value changed → the loaded list is outdated
  useEffect(() => setState({}), [argsKey]);

  const multiSel = lk.multi ? cur.split(',').filter(Boolean) : [];
  const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const filtered =
    lk.kind === 'list' && !lk.multi && text && text !== shown ? (state.options || []).filter((o) => norm(o.label).includes(norm(text))) : state.options || [];

  const pick = (o: Opt) => {
    if (lk.multi) {
      const sel = new Set(multiSel);
      if (sel.has(o.value)) sel.delete(o.value);
      else sel.add(o.value);
      const vals = [...sel];
      const names = vals.map((v) => state.options?.find((x) => x.value === v)?.label || v);
      onSet(param.name, vals.join(','), names.join(', '));
      return;
    }
    typed.current = false; // no new search for the picked label
    onSet(param.name, o.value, o.label, o.set);
    setText(o.label);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className="flex gap-1.5">
        <Input
          id={id}
          value={text}
          placeholder={lk.placeholder ? t(lk.placeholder) : lk.kind === 'list' ? t('Choose …') : undefined}
          autoComplete="off"
          onFocus={() => lk.kind === 'list' && !state.options && !state.loading && load('')}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            // free-text values (street names) are stored as typed; ids only when picked
            if (!lk.ids && !lk.multi) onSet(param.name, e.target.value);
            if (lk.kind === 'list') setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              load(text);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('Suggestions')}
          title={t('Suggestions')}
          onClick={() => (open && state.options ? setOpen(false) : load(text === shown && lk.ids ? '' : text))}
        >
          {state.loading ? <Loader2 className="animate-spin" /> : lk.kind === 'list' ? <ChevronDown /> : <Search />}
        </Button>
      </div>
      {open && (state.loading || state.error || state.options) && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md">
          {state.loading && <p className="px-3 py-2 text-xs text-muted-foreground">{t('Loading …')}</p>}
          {state.error && <p className="px-3 py-2 text-xs text-destructive">{t(state.error)}</p>}
          {state.options && !state.loading && (
            filtered.length ? (
              <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-64">
                <div className="flex flex-col">
                  {filtered.slice(0, 300).map((o) => (
                    <button
                      key={o.value + o.label}
                      type="button"
                      className={cn('flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', o.value === cur && 'font-semibold')}
                      onClick={() => pick(o)}
                    >
                      {lk.multi && <Check className={cn('size-3.5', multiSel.includes(o.value) ? 'opacity-100' : 'opacity-0')} />}
                      {o.label}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              !state.error && <p className="px-3 py-2 text-xs text-muted-foreground">{t('No suggestions')}</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
