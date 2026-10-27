import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { OptionSelect } from '@/components/fields';
import { ScheduleEditor } from '@/components/schedule-editor';
import type { Page } from '@/lib/shared';
import { useStore } from '@/lib/store';

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
  const { t, touch } = useStore();
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
          <span className="block text-xs text-muted-foreground">{t('Skipped while all modules placed only on this page are hidden by their schedules.')}</span>
        </span>
      </label>
    </div>
  );
}
