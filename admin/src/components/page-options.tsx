import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { CheckChip, OptionSelect } from '@/components/fields';
import { ScheduleEditor } from '@/components/schedule-editor';
import type { Page } from '@/lib/shared';
import { useStore } from '@/lib/store';
import { MODULE_TYPES } from '@/lib/shared';
import { CONDITIONS as CONDITIONS_JS } from '../../../public/shared/conditions.js';

const CONDITIONS = CONDITIONS_JS as Record<string, { label: string } | undefined>;

const AMBIENT_PREVIEWS = [
  { id: 'rain', label: 'Rain' },
  { id: 'snow', label: 'Snow' },
  { id: 'thunder', label: 'Thunderstorm' },
  { id: 'fog', label: 'Fog' },
  { id: 'cloudy', label: 'Clouds' },
  { id: 'clear', label: 'Sun' },
  { id: 'night', label: 'Starry sky' },
];

/** Extra page settings: time window, date range, exclusive and skip-empty. */
export function PageOptions({ p }: { p: Page }) {
  const { t, touch, cfg } = useStore();
  // modules with a condition (tasks, flights, F1 …) can decide whether this page rotates
  const candidates = cfg.modules.filter((m) => CONDITIONS[m.type]);
  const cond = cfg.modules.find((m) => m.id === p.showWhen);
  const set = (patch: Partial<Page>) => {
    Object.assign(p, patch);
    touch();
  };
  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-background/60 p-3">
      <ScheduleEditor m={p} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm">{t('Only in this period')}</span>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pd-from-${p.id}`} className="text-xs text-muted-foreground">{t('From')}</Label>
            <Input id={`pd-from-${p.id}`} type="date" className="w-40" value={p.dateFrom || ''} onChange={(e) => set({ dateFrom: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`pd-to-${p.id}`} className="text-xs text-muted-foreground">{t('Until')}</Label>
            <Input id={`pd-to-${p.id}`} type="date" className="w-40" value={p.dateTo || ''} onChange={(e) => set({ dateTo: e.target.value })} />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">{t('e.g. a Christmas or holiday page – leave empty for always.')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`amb-${p.id}`} className="text-sm">{t('Weather animation in the background')}</Label>
        <OptionSelect
          id={`amb-${p.id}`}
          className="max-w-72"
          value={p.ambient || 'off'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'subtle', label: 'Subtle' },
            { value: 'full', label: 'Strong' },
          ]}
          onValue={(v) => set({ ambient: v as Page['ambient'] })}
        />
        <p className="text-xs text-muted-foreground">{t('Rain, snow, thunderstorm, fog, drifting clouds, sunshine or stars – matching the current weather at your location.')}</p>
        {p.ambient && p.ambient !== 'off' && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {t('Preview')}:
            {AMBIENT_PREVIEWS.map((k) => (
              <a key={k.id} href={`/?page=${encodeURIComponent(p.id)}&ambient=${k.id}`} target="_blank" rel="noopener" className="rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
                {t(k.label)}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sw-${p.id}`} className="text-sm">{t('Only show when a module has something to show')}</Label>
        <OptionSelect
          id={`sw-${p.id}`}
          className="max-w-96"
          translate={false}
          value={p.showWhen || ''}
          options={[
            { value: '', label: t('Always') },
            ...candidates.map((m) => ({ value: m.id, label: `${m.title || t(MODULE_TYPES[m.type]?.label || m.type)}${m.enabled ? '' : ` (${t('disabled')})`}` })),
          ]}
          onValue={(v) => set({ showWhen: v })}
        />
        <p className="text-xs text-muted-foreground">
          {cond ? t(CONDITIONS[cond.type]!.label) : t('e.g. an F1 page only on race weekends, a flights page only while an aircraft is nearby, a to-do page only with open tasks. The module does not have to be on this page.')}
        </p>
      </div>
      {(cfg.general.displays as { id: string; name: string }[] | undefined)?.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm">{t('Show on these mirrors')}</span>
          <div className="flex flex-wrap gap-1.5">
            <CheckChip checked={!p.displays?.length} onChange={(c) => c && set({ displays: [] })}>
              {t('All mirrors')}
            </CheckChip>
            {(cfg.general.displays as { id: string; name: string }[]).map((d) => (
              <CheckChip
                key={d.id}
                checked={!!p.displays?.includes(d.id)}
                onChange={(c) => set({ displays: c ? [...(p.displays || []), d.id] : (p.displays || []).filter((x) => x !== d.id) })}
              >
                {d.name || d.id}
              </CheckChip>
            ))}
          </div>
        </div>
      ) : null}
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <Switch className="mt-0.5" checked={!!p.exclusive} onCheckedChange={(c) => set({ exclusive: c })} />
        <span>
          {t('Exclusive')}
          <span className="block text-xs text-muted-foreground">{t('While this page is active, only it (and other exclusive pages) is shown – e.g. a morning page from 6 to 8.')}</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <Switch className="mt-0.5" checked={p.skipEmpty !== false} onCheckedChange={(c) => set({ skipEmpty: c })} />
        <span>
          {t('Skip when empty')}
          <span className="block text-xs text-muted-foreground">{t('Skipped while all modules placed only on this page are hidden – by their schedules or their "only show when …" option (e.g. an F1 page only on race weekends).')}</span>
        </span>
      </label>
    </div>
  );
}
