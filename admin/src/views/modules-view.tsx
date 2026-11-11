import { useRef, useState } from 'react';
import { Check, CircleAlert, Copy, Download, FlaskConical, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { download, exportModule, importShared, isSharedFile } from '@/lib/share';
import { toast } from 'sonner';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfirm } from '@/components/confirm';
import { ScheduleEditor } from '@/components/schedule-editor';
import { CONDITIONS as CONDITIONS_JS } from '../../../public/shared/conditions.js';

const CONDITIONS = CONDITIONS_JS as Record<string, { label: string } | undefined>;
import { CheckChip, FieldsForm, NumberInput, OptionSelect, noPlus } from '@/components/fields';
import { clone, errorMessage } from '@/lib/api';
import { duplicateGroups, mergeDuplicates, moduleName, pagesSummary, regionLabel, typeLabel } from '@/lib/helpers';
import { MODULE_TYPES, REGIONS, defaultModule, uid, type Module, type Values } from '@/lib/shared';
import { useStore } from '@/lib/store';
import { useHealth } from '@/lib/health';

export function ModulesView() {
  const { cfg, module, t } = useStore();
  const selected = cfg.modules.find((x) => x.id === module) || cfg.modules[0];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-5">
      <ModuleList selected={selected?.id} />
      {selected ? (
        <ModuleEditor key={selected.id} m={selected} />
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('Select a module or add a new one.')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ModuleList({ selected }: { selected?: string }) {
  const { cfg, t, touch, setModule } = useStore();
  const issues = useHealth();
  const confirm = useConfirm();
  // Deactivated modules can be deleted right from the list.
  const remove = async (m: Module) => {
    const ok = await confirm({ title: t('Delete module "{name}"?', { name: moduleName(m, t) }), action: t('Delete'), destructive: true });
    if (!ok) return;
    const idx = cfg.modules.indexOf(m);
    if (idx >= 0) cfg.modules.splice(idx, 1);
    if (selected === m.id) setModule(null);
    touch();
  };
  const types = Object.entries(MODULE_TYPES).map(([value, type]) => ({ value, label: type.label }));
  const [addType, setAddType] = useState(types[0].value);
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <Card className="gap-3 overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('Modules')}</CardTitle>
        <CardAction>
          <ImportShared />
        </CardAction>
      </CardHeader>
      {(() => {
        const dupes = duplicateGroups(cfg.modules).reduce((n, g) => n + g.length - 1, 0);
        return dupes > 0 ? (
          <div className="mx-2 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <span className="flex-1">{t('{n} duplicate module(s) found (same settings, only on different pages).', { n: dupes })}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                mergeDuplicates(cfg.modules);
                if (selected && !cfg.modules.some((m) => m.id === selected)) setModule(null);
                touch();
                toast.success(t('Duplicates merged – modules are now shared between the pages.'));
              }}
            >
              {t('Merge')}
            </Button>
          </div>
        ) : null;
      })()}
      <div ref={listRef} className="mm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
        <div className="flex flex-col gap-0.5">
          {cfg.modules.map((m) => (
            <div
              key={m.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:bg-accent/60',
                m.id === selected && 'border-primary/70 bg-background hover:bg-background',
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex">
                    <Switch
                      checked={m.enabled}
                      aria-label={t('On/off')}
                      onCheckedChange={(c) => {
                        m.enabled = c;
                        touch();
                      }}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('On/off')}</TooltipContent>
              </Tooltip>
              <button
                type="button"
                className={cn('flex min-w-0 flex-1 flex-col items-start text-left', !m.enabled && 'opacity-50')}
                onClick={() => {
                  setModule(m.id);
                  // stacked layout (phones/tablets): jump to the editor below the list
                  if (window.matchMedia('(max-width: 1023px)').matches)
                    setTimeout(() => document.getElementById('module-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
                }}
              >
                <span className="flex w-full items-center gap-1.5 truncate text-sm font-semibold">
                  {issues.some((x) => x.id === m.id) && (
                    <span className={cn('size-2 shrink-0 rounded-full', issues.find((x) => x.id === m.id)!.kind === 'error' ? 'bg-destructive' : 'bg-warning')} title={t('Problem')} />
                  )}
                  <span className="truncate">{moduleName(m, t)}</span>
                </span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {typeLabel(m, t)} · {regionLabel(m.region, t)} · {pagesSummary(m, cfg, t)}
                </span>
              </button>
              {!m.enabled && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('Delete module')}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      onClick={() => remove(m)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{t('Delete module')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      </div>
      <CardContent className="relative z-10 flex shrink-0 gap-2 border-t bg-card pt-3">
        <OptionSelect value={addType} options={types} onValue={setAddType} className="min-w-0 flex-1" />
        <Button
          onClick={() => {
            const m = defaultModule(addType, { pages: [] }, cfg.general.locale); // placed on a page later
            m.order = cfg.modules.filter((x) => x.region === m.region).length;
            cfg.modules.push(m);
            setModule(m.id);
            touch();
            // show the new module at the end of the list
            setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 0);
          }}
        >
          <Plus />
          {noPlus(t('+ Add'))}
        </Button>
      </CardContent>
    </Card>
  );
}

function ModuleEditor({ m }: { m: Module }) {
  const { cfg, t, mt, touch, setModule, lang } = useStore();
  const issue = useHealth().find((x) => x.id === m.id);
  const confirm = useConfirm();
  const type = MODULE_TYPES[m.type];
  const all = m.pages.includes('*');

  const togglePage = (id: string, checked: boolean) => {
    if (id === '*') m.pages = checked ? ['*'] : [];
    else {
      const sel = new Set(m.pages.filter((p) => p !== '*'));
      if (checked) sel.add(id);
      else sel.delete(id);
      m.pages = cfg.pages.map((p) => p.id).filter((p) => sel.has(p));
    }
    touch();
  };

  const duplicate = () => {
    const copy = { ...clone(m), id: uid('m'), title: mt('{name} (copy)', { name: m.title || mt(type.label) }) };
    cfg.modules.splice(cfg.modules.indexOf(m) + 1, 0, copy);
    setModule(copy.id);
    touch();
  };
  const remove = async () => {
    const ok = await confirm({ title: t('Delete module "{name}"?', { name: moduleName(m, t) }), action: t('Delete'), destructive: true });
    if (!ok) return;
    const idx = cfg.modules.indexOf(m);
    if (idx >= 0) cfg.modules.splice(idx, 1);
    setModule(null);
    touch();
  };

  return (
    <Card id="module-editor" className="scroll-mt-32">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{moduleName(m, t)}</CardTitle>
        <CardDescription className="text-xs">{t(type.description)}</CardDescription>
        <CardAction className="flex gap-2">
          <Button size="sm" variant="outline" onClick={duplicate}>
            <Copy />
            <span className="max-sm:sr-only">{t('Duplicate')}</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            title={t('Export this module as a file – for another mirror (without tokens and passwords)')}
            onClick={() => {
              const { file, secrets } = exportModule(m);
              download(file, moduleName(m, t));
              if (secrets) toast.info(t('Exported without {n} token(s)/password(s) – enter them again after importing.', { n: secrets }));
            }}
          >
            <Download />
            <span className="max-sm:sr-only">{t('Export')}</span>
          </Button>
          <Button size="sm" variant="destructive" onClick={remove}>
            <Trash2 />
            <span className="max-sm:sr-only">{t('Delete')}</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {issue && (
          <div className={cn('flex gap-2.5 rounded-lg border p-3 text-sm', issue.kind === 'error' ? 'border-destructive/40 bg-destructive/10' : 'border-warning/40 bg-warning/10')}>
            <CircleAlert className={cn('mt-0.5 size-4 shrink-0', issue.kind === 'error' ? 'text-destructive' : 'text-warning')} />
            <div className="min-w-0">
              <p className="font-medium">
                {issue.kind === 'error'
                  ? t('Loading the data fails since {time}.', { time: new Date(issue.since).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }) })
                  : t('Part of the data cannot be loaded.')}
              </p>
              <p className="break-words text-muted-foreground">{t(issue.error)}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-5 gap-y-4">
          <label className="flex cursor-pointer items-center gap-3 py-1.5 text-sm">
            <Switch
              checked={m.enabled}
              onCheckedChange={(c) => {
                m.enabled = c;
                touch();
              }}
            />
            <span>{t('Module active')}</span>
          </label>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-title" className="text-xs font-medium text-muted-foreground">
              {t('Heading (empty = none)')}
            </Label>
            <Input
              id="m-title"
              value={m.title}
              onChange={(e) => {
                m.title = e.target.value;
                touch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-region" className="text-xs font-medium text-muted-foreground">
              {t('Position')}
            </Label>
            <OptionSelect
              id="m-region"
              value={m.region}
              options={REGIONS.map((r) => ({ value: r.id, label: r.label }))}
              onValue={(v) => {
                m.region = v;
                touch();
              }}
            />
            {Object.keys(m.placements || {}).length > 0 && (
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>{t('Own position on:')}</span>
                {Object.entries(m.placements!).map(([pid, pl]) => (
                  <span key={pid} className="flex items-center gap-1.5">
                    <b className="font-medium text-foreground">{cfg.pages.find((p) => p.id === pid)?.name || pid}</b> → {regionLabel(pl.region, t)}
                    <button
                      type="button"
                      className="rounded px-1 hover:bg-accent hover:text-foreground"
                      title={t('Use the default position on this page')}
                      onClick={() => {
                        delete m.placements![pid];
                        touch();
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <span>{t('Other pages use the position above. Drag the module in "Pages & layout" to move it on one page only.')}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-order" className="text-xs font-medium text-muted-foreground">
              {t('Order within the area')}
            </Label>
            <NumberInput
              id="m-order"
              step={1}
              value={m.order}
              onValue={(n) => {
                m.order = n || 0;
                touch();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-height" className="text-xs font-medium text-muted-foreground">
              {t('Height')}
            </Label>
            <OptionSelect
              id="m-height"
              value={m.height || 'auto'}
              options={[
                { value: 'auto', label: 'Automatic (as much as the content needs)' },
                { value: 'fill', label: 'Use as much space as possible' },
              ]}
              onValue={(v) => {
                m.height = v as Module['height'];
                touch();
              }}
            />
            <p className="text-xs text-muted-foreground">{t('"As much space as possible" also extends into empty areas above and below.')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="m-width" className="text-xs font-medium text-muted-foreground">
              {t('Width')}
            </Label>
            <OptionSelect
              id="m-width"
              value={m.width || 'full'}
              options={[
                { value: 'full', label: 'Full width of the area' },
                { value: 'half', label: 'Half width (two side by side)' },
              ]}
              onValue={(v) => {
                m.width = v as Module['width'];
                touch();
              }}
            />
            <p className="text-xs text-muted-foreground">{t('Two half-width modules next to each other in the same area share a row; a half-width module on its own uses the full width.')}</p>
          </div>
          <div className="col-span-full flex flex-col gap-3">
            <ScheduleEditor m={m} />
            {CONDITIONS[m.type] && (
              <label className="flex cursor-pointer items-center gap-3 text-sm">
                <Switch
                  checked={!!m.onlyWithContent}
                  onCheckedChange={(c) => {
                    m.onlyWithContent = c;
                    touch();
                  }}
                />
                <span>{t(CONDITIONS[m.type]!.label)}</span>
              </label>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`instead-${m.id}`} className="text-sm font-normal">{t('Show instead of another module')}</Label>
              <OptionSelect
                id={`instead-${m.id}`}
                className="max-w-96"
                translate={false}
                value={m.insteadOf || ''}
                options={[
                  { value: '', label: t('No – always show') },
                  ...cfg.modules.filter((x) => x.id !== m.id).map((x) => ({ value: x.id, label: `${moduleName(x, t)}${x.enabled ? '' : ` (${t('disabled')})`}` })),
                ]}
                onValue={(v) => {
                  m.insteadOf = v;
                  touch();
                }}
              />
              <p className="text-xs text-muted-foreground">{t('Only shown while the chosen module is hidden – by its pages, its time window or "only show when …" (e.g. a clock while no aircraft is nearby). Put both in the same area so this one takes its place.')}</p>
            </div>
          </div>
          <div className="col-span-full flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-muted-foreground">{t('Pages')}</Label>
            <div className="flex flex-wrap gap-1.5">
              <CheckChip checked={all} onChange={(c) => togglePage('*', c)}>
                {t('All pages')}
              </CheckChip>
              {cfg.pages.map((p) => (
                <CheckChip key={p.id} checked={all || m.pages.includes(p.id)} disabled={all} onChange={(c) => togglePage(p.id, c)}>
                  {p.name}
                </CheckChip>
              ))}
            </div>
            {!m.pages.length && (
              <p className="text-xs text-warning">{t('Not on any page yet – drag it onto an area in "Pages & layout" or pick pages above.')}</p>
            )}
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('Settings')}</h3>
          <FieldsForm fields={type.fields} values={m.settings} onChange={touch} />
        </div>
        <TestData m={m} />
      </CardContent>
    </Card>
  );
}

type TestResult = { ok: boolean; ms: number; error?: string; warnings: string[]; counts: [string, number][]; raw: string };

// What a test returned, in words: the lists in the data with their length, and partial errors.
function summarize(json: { ok?: boolean; error?: string; data?: Values }, ms: number): TestResult {
  const d = json.data || {};
  const warnings = [d.errors, d.error ? [d.error] : null].flat().filter(Boolean).map((e) => (typeof e === 'string' ? e : (e as Values).message || JSON.stringify(e))).slice(0, 5);
  const counts = Object.entries(d).filter(([k, v]) => Array.isArray(v) && k !== 'errors').map(([k, v]) => [k, (v as unknown[]).length] as [string, number]);
  return { ok: !!json.ok, ms, error: json.error, warnings, counts, raw: JSON.stringify(json, null, 2).slice(0, 8000) };
}

/** Fetches the module's data right now with the settings as they are in the editor (also unsaved). */
function TestData({ m }: { m: Module }) {
  const { t } = useStore();
  const [res, setRes] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true);
    const start = performance.now();
    try {
      const r = await fetch('/api/admin/preview-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: m }) });
      setRes(summarize(await r.json(), Math.round(performance.now() - start)));
    } catch (err) {
      setRes({ ok: false, ms: 0, error: errorMessage(err), warnings: [], counts: [], raw: '' });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={run} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          {t('Test now')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('fetches the data with the settings above – also before saving')}</span>
      </div>
      {res && (
        <div className={cn('flex flex-col gap-1.5 rounded-lg border p-3 text-sm', res.ok && !res.warnings.length ? 'border-success/40 bg-success/10' : res.ok ? 'border-warning/40 bg-warning/10' : 'border-destructive/40 bg-destructive/10')}>
          <div className="flex items-center gap-2 font-medium">
            {res.ok ? <Check className="size-4 text-success" /> : <CircleAlert className="size-4 text-destructive" />}
            {res.ok ? t('Works ({ms} ms)', { ms: res.ms }) : t('Failed')}
          </div>
          {res.error && <p className="text-destructive">{t(res.error)}</p>}
          {res.warnings.map((w) => (
            <p key={w} className="text-xs text-warning">{t(w)}</p>
          ))}
          {res.ok && res.counts.length > 0 && <p className="text-xs text-muted-foreground">{res.counts.map(([k, n]) => `${k}: ${n}`).join(' · ')}</p>}
          {res.raw && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">{t('Raw data')}</summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-background p-2 font-mono leading-relaxed">{res.raw}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** Imports a module or page exported from another mirror (Export button). */
export function ImportShared() {
  const { cfg, t, mt, touch, setModule, setPage } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const onFile = async (file?: File) => {
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (!isSharedFile(json)) throw new Error(t('This is not an exported module or page. Whole configurations are imported under Import / Export.'));
      const r = importShared(json, cfg, mt);
      touch();
      if (r.page) {
        setPage(r.page.id);
        toast.success(t('Page "{name}" imported with {n} module(s) – save to apply.', { name: r.page.name, n: r.modules.length }));
      } else {
        setModule(r.modules[0].id);
        toast.success(t('Module imported – it is under "Available modules" in the layout until you place it.'));
      }
      if (r.skipped) toast.warning(t('{n} module(s) of an unknown type were skipped.', { n: r.skipped }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      if (input.current) input.current.value = '';
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <Button size="xs" variant="outline" onClick={() => input.current?.click()} title={t('Import a module or page from another mirror')}>
        <Upload />
        {t('Import')}
      </Button>
    </>
  );
}
