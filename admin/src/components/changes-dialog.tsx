import { useMemo } from 'react';
import { Loader2, Minus, Plus, Save, Undo2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { configDiff, type DiffEntry } from '@/lib/diff';
import { useStore } from '@/lib/store';

const SECTIONS: { id: DiffEntry['section']; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'page', label: 'Pages' },
  { id: 'module', label: 'Modules' },
];

/** "Unsaved changes": what differs from the saved state, field by field (old → new). */
export function ChangesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { cfg, saved, t, save, discard, saving } = useStore();
  // recomputed whenever the dialog opens
  const entries = useMemo(() => (open ? configDiff(saved, cfg, t) : []), [open, saved, cfg, t]);
  const count = entries.reduce((n, e) => n + Math.max(1, e.changes.length), 0);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="flex max-h-[85vh] flex-col gap-4 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('Unsaved changes')}</AlertDialogTitle>
          <AlertDialogDescription>
            {entries.length ? (count === 1 ? t('1 change compared to the saved state.') : t('{n} changes compared to the saved state.', { n: count })) : t('No differences to the saved state.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mm-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <DiffList entries={entries} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Close')}</AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => {
              discard();
              onOpenChange(false);
            }}
          >
            <Undo2 />
            {t('Discard')}
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              await save();
              onOpenChange(false);
            }}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {t('Save')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The grouped list of differences (general / pages / modules), old → new per field. */
export function DiffList({ entries }: { entries: DiffEntry[] }) {
  const { t } = useStore();
  return (
          <div className="flex flex-col gap-5">
            {SECTIONS.map((s) => {
              const list = entries.filter((e) => e.section === s.id);
              if (!list.length) return null;
              return (
                <section key={s.id} className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(s.label)}</h3>
                  {list.map((e, i) => (
                    <div key={i} className="overflow-hidden rounded-lg border">
                      <div className="flex items-center gap-2 bg-muted/50 px-3 py-2 text-sm font-medium">
                        {e.kind === 'added' && <Plus className="size-4 text-success" />}
                        {e.kind === 'removed' && <Minus className="size-4 text-destructive" />}
                        <span className="min-w-0 truncate">{e.title}</span>
                        {e.kind !== 'changed' && (
                          <Badge variant="outline" className={e.kind === 'added' ? 'ml-auto border-success/40 text-success' : 'ml-auto border-destructive/40 text-destructive'}>
                            {t(e.kind === 'added' ? 'Added' : 'Removed')}
                          </Badge>
                        )}
                      </div>
                      {e.changes.length > 0 && (
                        <div className="divide-y font-mono text-xs">
                          {e.changes.map((c, j) => (
                            <div key={j} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-3">
                              <div className="font-sans text-muted-foreground">{c.label}</div>
                              <div className="flex min-w-0 flex-col gap-0.5">
                                {c.from && (
                                  <span className="break-words rounded bg-destructive/10 px-1.5 py-0.5 text-destructive line-through decoration-destructive/50">− {c.from}</span>
                                )}
                                <span className="break-words rounded bg-success/10 px-1.5 py-0.5 text-success">+ {c.to}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
  );
}
