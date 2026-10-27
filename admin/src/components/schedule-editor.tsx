import { Clock } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Schedule } from '@/lib/shared';
import { useStore } from '@/lib/store';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const PRESETS: { label: string; days: number[] }[] = [
  { label: 'Every day', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { label: 'Weekend', days: [6, 7] },
];

/** "Only show at certain times": weekdays + time window (may run past midnight). Used for modules and pages. */
export function ScheduleEditor({ m }: { m: { id: string; schedule?: Schedule } }) {
  const { t, touch } = useStore();
  const s: Schedule = (m.schedule ||= { enabled: false, days: [1, 2, 3, 4, 5, 6, 7], from: '06:00', to: '09:00' });
  const set = (patch: Partial<Schedule>) => {
    Object.assign(s, patch);
    touch();
  };
  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <Switch checked={s.enabled} onCheckedChange={(c) => set({ enabled: c })} />
        <Clock className="size-4 text-muted-foreground" />
        <span>{t('Only show at certain times')}</span>
      </label>
      {s.enabled && (
        <div className="flex flex-col gap-3 rounded-lg border bg-background/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="multiple"
              size="sm"
              spacing={0}
              value={s.days.map(String)}
              onValueChange={(v) => v.length && set({ days: v.map(Number).sort() })}
              className="rounded-lg border"
              aria-label={t('Weekdays')}
            >
              {DAY_LABELS.map((d, i) => (
                <ToggleGroupItem key={d} value={String(i + 1)} className="px-2.5 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  {t(d)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => set({ days: p.days })}
              >
                {t(p.label)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`sch-from-${m.id}`} className="text-xs text-muted-foreground">{t('From')}</Label>
              <Input id={`sch-from-${m.id}`} type="time" className="w-32" value={s.from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`sch-to-${m.id}`} className="text-xs text-muted-foreground">{t('Until')}</Label>
              <Input id={`sch-to-${m.id}`} type="time" className="w-32" value={s.to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
            </div>
            <p className="pb-2 text-xs text-muted-foreground">
              {s.from === s.to ? t('All day on the selected days.') : s.to < s.from ? t('Runs past midnight.') : ''}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
