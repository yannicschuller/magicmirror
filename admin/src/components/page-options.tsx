import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScheduleEditor } from '@/components/schedule-editor';
import type { Page } from '@/lib/shared';
import { useStore } from '@/lib/store';

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
