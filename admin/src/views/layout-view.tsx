import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowDown, ArrowUp, CalendarRange, Clock, Copy, MonitorPlay, SlidersHorizontal, Star, MoveVertical, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useConfirm } from '@/components/confirm';
import { NumberInput, noPlus } from '@/components/fields';
import { IconButton } from '@/components/icon-button';
import { PageOptions } from '@/components/page-options';
import { api, clone, errorMessage } from '@/lib/api';
import { REGIONS, uid, type Module, type Page } from '@/lib/shared';
import { moduleName, onPage, pagesSummary, typeLabel } from '@/lib/helpers';
import { useStore } from '@/lib/store';

// Same arrangement as the mirror's screen grid.
const AREAS: Record<string, string> = {
  top_bar: 'tb', top_left: 'tl', top_center: 'tc', top_right: 'tr',
  middle_left: 'ml', middle_center: 'mc', middle_right: 'mr',
  bottom_left: 'bl', bottom_center: 'bc', bottom_right: 'br',
  bottom_bar: 'bb', fullscreen: 'fs',
};

export function LayoutView() {
  const { cfg, page: pageId } = useStore();
  const page = cfg.pages.find((p) => p.id === pageId) || cfg.pages[0];
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-5">
      <PagesPanel current={page} />
      <div className="flex min-w-0 flex-col gap-4 lg:gap-5">
        <LayoutPanel page={page} />
        <PreviewPanel page={page} />
      </div>
    </div>
  );
}

// ---- pages ----------------------------------------------------------------------------------

function PagesPanel({ current }: { current: Page }) {
  const { cfg, t, mt, touch, setPage } = useStore();
  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('Pages')}</CardTitle>
        <CardDescription className="text-xs">
          {t('Pages switch automatically after the configured duration. Clicking "Show" switches all mirrors immediately.')}
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = uid('p');
              cfg.pages.push({ id, name: mt('Page {n}', { n: cfg.pages.length + 1 }), duration: 30, enabled: true });
              setPage(id);
              touch();
            }}
          >
            <Plus />
            {noPlus(t('+ Page'))}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {cfg.pages.map((p, i) => (
          <PageRow key={p.id} p={p} i={i} active={p.id === current.id} />
        ))}
      </CardContent>
    </Card>
  );
}

function PageRow({ p, i, active }: { p: Page; i: number; active: boolean }) {
  const { cfg, t, mt, touch, page, setPage } = useStore();
  const confirm = useConfirm();
  const [options, setOptions] = useState(false);
  // Copies the page; its modules are shared (they simply appear on the copy too) –
  // no duplicated modules. Modules shown on all pages appear there anyway.
  const duplicate = () => {
    const copy: Page = { ...clone(p), id: uid('p'), name: mt('{name} (copy)', { name: p.name }) };
    cfg.pages.splice(cfg.pages.indexOf(p) + 1, 0, copy);
    const mods = cfg.modules.filter((m) => !m.pages.includes('*') && m.pages.includes(p.id));
    for (const m of mods) m.pages.push(copy.id);
    setPage(copy.id);
    touch();
    toast.success(t('Page duplicated – {n} module(s) shared', { n: mods.length }));
  };
  const swap = (j: number) => {
    if (j < 0 || j >= cfg.pages.length) return;
    [cfg.pages[i], cfg.pages[j]] = [cfg.pages[j], cfg.pages[i]];
    touch();
  };
  const show = async () => {
    try {
      const r = await api<{ clients: number }>('/command', { method: 'POST', body: { type: 'page', page: p.id } });
      toast.success(t('Page "{name}" shown on {n} mirror(s)', { name: p.name, n: r.clients }));
    } catch (err) {
      toast.error(t(errorMessage(err)));
    }
  };
  const remove = async () => {
    if (cfg.pages.length === 1) return void toast.error(t('The last page cannot be deleted.'));
    const ok = await confirm({ title: t('Delete page "{name}"? Modules are kept.', { name: p.name }), action: t('Delete'), destructive: true });
    if (!ok) return;
    const idx = cfg.pages.indexOf(p);
    if (idx < 0) return;
    cfg.pages.splice(idx, 1);
    for (const m of cfg.modules) {
      m.pages = m.pages.filter((id) => id !== p.id);
      if (!m.pages.length) {
        m.pages = [cfg.pages[0].id];
        m.enabled = false;
      }
    }
    if (page === p.id) setPage(cfg.pages[0].id);
    touch();
  };
  return (
    <div
      className={cn(
        'grid grid-cols-[32px_minmax(0,1fr)_84px_auto] items-center gap-2 rounded-xl border bg-background/70 p-2.5 transition-colors',
        active && 'border-primary/70 ring-1 ring-primary/20',
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setPage(p.id)}
            aria-label={t("Edit this page's layout")}
            className={cn(
              'size-8 rounded-lg bg-secondary text-sm font-semibold tabular-nums transition-colors hover:bg-accent',
              active && 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {i + 1}
          </button>
        </TooltipTrigger>
        <TooltipContent>{t("Edit this page's layout")}</TooltipContent>
      </Tooltip>
      <Input
        value={p.name}
        aria-label={t('Name')}
        className={cn(!p.enabled && 'opacity-55')}
        onChange={(e) => {
          p.name = e.target.value;
          touch();
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <NumberInput
              min={5}
              max={3600}
              value={p.duration}
              aria-label={t('Display duration in seconds')}
              className="px-2"
              onValue={(n) => {
                p.duration = Math.max(5, n || 30);
                touch();
              }}
            />
            s
          </label>
        </TooltipTrigger>
        <TooltipContent>{t('Display duration in seconds')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex">
            <Switch
              checked={p.enabled}
              aria-label={t('Page active')}
              onCheckedChange={(c) => {
                p.enabled = c;
                touch();
              }}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{t('Page active')}</TooltipContent>
      </Tooltip>
      <div className="col-span-full flex items-center justify-end gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="xs" variant="outline" className="mr-auto" onClick={show}>
              <MonitorPlay />
              {t('Show')}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('Show on the mirror now')}</TooltipContent>
        </Tooltip>
        <IconButton label={t('Move up')} disabled={i === 0} onClick={() => swap(i - 1)}>
          <ArrowUp />
        </IconButton>
        <IconButton label={t('Move down')} disabled={i === cfg.pages.length - 1} onClick={() => swap(i + 1)}>
          <ArrowDown />
        </IconButton>
        <span className="flex items-center gap-1 px-1 text-primary">
          {p.schedule?.enabled && (
            <span title={t('Only shown {from}–{to}', { from: p.schedule.from, to: p.schedule.to })}>
              <Clock className="size-3.5" />
            </span>
          )}
          {(p.dateFrom || p.dateTo) && (
            <span title={`${p.dateFrom || '…'} – ${p.dateTo || '…'}`}>
              <CalendarRange className="size-3.5" />
            </span>
          )}
          {p.exclusive && (
            <span title={t('Exclusive')}>
              <Star className="size-3.5" />
            </span>
          )}
        </span>
        <IconButton label={t('Page options')} className={cn(options && 'text-primary')} onClick={() => setOptions(!options)}>
          <SlidersHorizontal />
        </IconButton>
        <IconButton label={t('Duplicate page')} onClick={duplicate}>
          <Copy />
        </IconButton>
        <IconButton label={t('Delete page')} className="hover:text-destructive" onClick={remove}>
          <Trash2 />
        </IconButton>
      </div>
      {options && (
        <div className="col-span-full">
          <PageOptions p={p} />
        </div>
      )}
    </div>
  );
}

// ---- grid editor ----------------------------------------------------------------------------

function LayoutPanel({ page }: { page: Page }) {
  const { cfg, t } = useStore();
  const others = cfg.modules.filter((m) => !m.enabled || !onPage(m, page.id));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('Layout: {name}', { name: page.name })}</CardTitle>
        <CardDescription className="text-xs">{t('Drag & drop modules to move them · click to edit')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          className="mm-screen-grid grid w-full gap-2 rounded-xl border bg-black p-2 sm:p-3"
        >
          {REGIONS.map((r) => (
            <Zone key={r.id} region={r.id} label={t(r.label)} page={page} />
          ))}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t('Modules on other pages / disabled')}</h3>
          <div className="flex flex-wrap gap-2">
            {others.length ? (
              others.map((m) => <ModuleChip key={m.id} m={m} page={page} outside />)
            ) : (
              <span className="text-xs text-muted-foreground">{t('All modules are on this page.')}</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('Drag onto an area to show the module on this page.')}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Zone({ region, label, page }: { region: string; label: string; page: Page }) {
  const { cfg, touch } = useStore();
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mods = cfg.modules.filter((m) => m.region === region && m.enabled && onPage(m, page.id)).sort((a, b) => a.order - b.order);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const m = cfg.modules.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (!m || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>('[data-chip]')].filter((c) => c.dataset.chip !== m.id);
    const after = items.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    const order = items.map((c) => c.dataset.chip!);
    order.splice(after === -1 ? order.length : after, 0, m.id);
    m.region = region;
    m.enabled = true;
    if (!onPage(m, page.id)) m.pages.push(page.id);
    order.forEach((id, i) => {
      const x = cfg.modules.find((y) => y.id === id);
      if (x) x.order = i;
    });
    touch();
  };

  return (
    <div
      ref={ref}
      style={{ gridArea: AREAS[region] }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={onDrop}
      className={cn(
        'flex min-h-14 min-w-0 flex-col gap-1.5 rounded-lg border border-dashed border-[#2a3142] p-1.5 transition-colors',
        region === 'fullscreen' && 'border-dotted',
        over && 'border-primary bg-primary/8',
      )}
    >
      <div className="truncate text-[10px] font-medium tracking-wider text-[#5d6782] uppercase">{label}</div>
      {mods.map((m) => (
        <ModuleChip key={m.id} m={m} page={page} />
      ))}
    </div>
  );
}

function ModuleChip({ m, page, outside = false }: { m: Module; page: Page; outside?: boolean }) {
  const { cfg, t, touch, setModule, setView } = useStore();
  const [dragging, setDragging] = useState(false);
  const all = m.pages.includes('*');
  const meta = [typeLabel(m, t), all && t('all pages'), !m.enabled && t('off'), outside && pagesSummary(m, cfg, t)].filter(Boolean).join(' · ');
  return (
    <div
      data-chip={m.id}
      draggable
      role="button"
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', m.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={() => {
        setModule(m.id);
        setView('modules');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setModule(m.id);
          setView('modules');
        }
      }}
      className={cn(
        'group/chip relative flex min-w-0 cursor-grab flex-col rounded-lg border border-[#323a50] bg-secondary py-1.5 pr-7 pl-2.5 select-none transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none active:cursor-grabbing',
        outside && 'max-w-full pr-2.5',
        !m.enabled && 'border-dashed opacity-55',
        dragging && 'opacity-40',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate text-[13px] font-semibold">
        <span className="truncate">{moduleName(m, t)}</span>
        {m.schedule?.enabled && (
          <span title={t('Only shown {from}–{to}', { from: m.schedule.from, to: m.schedule.to })}>
            <Clock className="size-3 shrink-0 text-primary" />
          </span>
        )}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{meta}</span>
      {!outside && (
        <button
          type="button"
          title={m.height === 'fill' ? t('Uses as much space as possible – click for automatic height') : t('Use as much space as possible')}
          aria-label={t('Use as much space as possible')}
          aria-pressed={m.height === 'fill'}
          className={cn(
            'absolute right-1 bottom-1 rounded p-0.5 hover:bg-primary/15 hover:text-primary',
            m.height === 'fill' ? 'text-primary' : 'text-muted-foreground/60',
          )}
          onClick={(e) => {
            e.stopPropagation();
            m.height = m.height === 'fill' ? 'auto' : 'fill';
            touch();
          }}
        >
          <MoveVertical className="size-3" />
        </button>
      )}
      {!outside && (
        <button
          type="button"
          title={t('Remove from this page')}
          aria-label={t('Remove from this page')}
          className="absolute top-1 right-1 rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            if (m.pages.includes('*')) m.pages = cfg.pages.map((p) => p.id);
            m.pages = m.pages.filter((id) => id !== page.id);
            if (!m.pages.length) {
              m.pages = [page.id];
              m.enabled = false;
            }
            touch();
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// ---- preview --------------------------------------------------------------------------------

function PreviewPanel({ page }: { page: Page }) {
  const { t, saved } = useStore();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1920));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('Preview')}</CardTitle>
        <CardAction>
          <Badge variant="outline" className="text-muted-foreground">
            {t('saved state')}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-xl border bg-black">
          <iframe
            // reload whenever the saved state or the page changes
            key={`${page.id}:${saved.length}:${hash(saved)}`}
            src={`/?page=${encodeURIComponent(page.id)}`}
            title={t('Preview')}
            tabIndex={-1}
            className="pointer-events-none absolute top-0 left-0 h-[1080px] w-[1920px] origin-top-left border-0"
            style={{ transform: `scale(${scale})` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
