import { useState } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { moduleName } from '@/lib/helpers';
import { useHealth } from '@/lib/health';
import { useStore } from '@/lib/store';

/** "2 modules have problems" – above every view, until dismissed for this set of problems. */
export function HealthBanner() {
  const { t, cfg, setView, setModule } = useStore();
  const issues = useHealth();
  const [dismissed, setDismissed] = useState('');
  const key = issues.map((i) => `${i.id}:${i.kind}`).join();
  if (!issues.length || key === dismissed) return null;
  const errors = issues.filter((i) => i.kind === 'error').length;
  const open = (id: string) => {
    setView('modules');
    setModule(id);
  };
  return (
    <div className="mx-auto mb-4 flex w-full max-w-4xl items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">
          {errors ? t('{n} module(s) cannot load their data.', { n: errors }) : t('{n} module(s) load only part of their data.', { n: issues.length })}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {issues.map((i) => {
            const m = cfg.modules.find((x) => x.id === i.id);
            return (
              <button key={i.id} type="button" onClick={() => open(i.id)} className="max-w-full truncate text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                <b className="font-medium text-foreground">{m ? moduleName(m, t) : i.title || i.type}</b>: {t(i.error)}
              </button>
            );
          })}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-7" onClick={() => setDismissed(key)} title={t('Dismiss')}>
        <X />
      </Button>
    </div>
  );
}
