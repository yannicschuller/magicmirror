import { useCallback, useEffect, useState } from 'react';
import { History, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DiffList } from '@/components/changes-dialog';
import { api, errorMessage } from '@/lib/api';
import { configDiff, type DiffEntry } from '@/lib/diff';
import type { Config } from '@/lib/shared';
import { useStore } from '@/lib/store';

type Entry = { id: string; savedAt: string | null; pages: number; modules: number };

/** The last saved states of the configuration – compare and restore. */
export function HistoryCard() {
  const { t, lang, saved, dirty, setConfig } = useStore();
  const [list, setList] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState<{ entry: Entry; cfg: Config; diff: DiffEntry[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api<Entry[]>('/history').then(setList).catch(() => setList([])), []);
  // reload whenever the saved state changes (every save adds an entry)
  useEffect(() => {
    load();
  }, [load, saved]);

  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) : '–');

  const inspect = async (entry: Entry) => {
    setBusy(entry.id);
    try {
      const cfg = await api<Config>(`/history/${entry.id}`);
      // what restoring would change: saved state → that version
      setOpen({ entry, cfg, diff: configDiff(saved, cfg, t) });
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!open) return;
    setBusy('restore');
    try {
      setConfig(await api<Config>(`/history/${open.entry.id}/restore`, { method: 'POST' }));
      toast.success(t('Restored – the mirror updates automatically.'));
      setOpen(null);
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <History className="size-4.5 text-primary" />
          {t('History')}
        </CardTitle>
        <CardDescription>{t('The last 20 saved states. Compare one with the current state and restore it if needed.')}</CardDescription>
        <CardAction />
      </CardHeader>
      <CardContent>
        {!list ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : !list.length ? (
          <p className="text-sm text-muted-foreground">{t('No earlier states yet – they appear after the next save.')}</p>
        ) : (
          <ul className="mm-scroll flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border">
            {list.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="tabular-nums">{date(e.savedAt)}</span>
                  <span className="text-xs text-muted-foreground"> · {t('{p} pages, {m} modules', { p: e.pages, m: e.modules })}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => inspect(e)} disabled={!!busy}>
                  {busy === e.id ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                  <span className="max-sm:sr-only">{t('Restore …')}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <AlertDialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <AlertDialogContent className="flex max-h-[85vh] flex-col gap-4 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Restore the state from {date}?', { date: date(open?.entry.savedAt ?? null) })}</AlertDialogTitle>
            <AlertDialogDescription>
              {open?.diff.length ? t('Restoring changes the following compared to the saved state:') : t('This state is identical to the saved state.')}
              {dirty && <> {t('Unsaved changes are discarded.')}</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mm-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">{open && <DiffList entries={open.diff} />}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <Button onClick={restore} disabled={busy === 'restore' || !open?.diff.length}>
              {busy === 'restore' ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {t('Restore')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
