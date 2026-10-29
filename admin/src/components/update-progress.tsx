import { useState } from 'react';
import { ArrowUpCircle, Check, ChevronDown, CircleAlert, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { cn } from 'cn';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { useStore } from '@/lib/store';
import { UPDATE_PHASES, useUpdate } from '@/lib/update';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Phases, progress bar and log of the current (or last) update. */
export function UpdateProgress({ className }: { className?: string }) {
  const { t } = useStore();
  const { status: s, running, offline, result, elapsed } = useUpdate();
  if (!s) return null;
  const done = !running && result === 'done';
  const failed = !running && (result === 'error' || s.state === 'error');
  const phases = UPDATE_PHASES(s.mode);
  const current = offline ? phases.findIndex((p) => p.id === 'restart') : phases.findIndex((p) => p.id === s.phase);
  const progress = done ? 100 : Math.max(5, Math.round(((Math.max(current, 0) + 0.5) / phases.length) * 100));

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {running && (
        <p className="text-sm text-muted-foreground">
          {t('Runs in the background – you can keep working or close this page. Elapsed: {time}', { time: mmss(elapsed) })}
        </p>
      )}
      {failed && <p className="flex items-center gap-2 text-sm text-destructive"><CircleAlert className="size-4" /> {t(s.error || 'unknown error')}</p>}
      <Progress value={progress} className={cn('h-1.5 w-full', failed && '[&>[data-slot=progress-indicator]]:bg-destructive')} />
      <ol className="flex w-full flex-col gap-2 text-left text-sm">
        {phases.map((p, i) => {
          const state = done || i < current ? 'done' : i === current && !failed ? 'active' : 'todo';
          return (
            <li key={p.id} className={cn('flex items-center gap-2.5', state === 'todo' && 'text-muted-foreground')}>
              <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', state === 'done' && 'border-success bg-success/15 text-success', state === 'active' && 'border-primary text-primary')}>
                {state === 'done' ? <Check className="size-3" /> : state === 'active' ? <Loader2 className="size-3 animate-spin" /> : null}
              </span>
              {t(p.label)}
              {state === 'active' && offline && p.id === 'restart' && <span className="text-xs text-muted-foreground">· {t('server is restarting')}</span>}
            </li>
          );
        })}
      </ol>
      {s.log && s.log.length > 0 && (
        <Collapsible className="w-full text-left" defaultOpen={failed}>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Terminal className="size-3.5" /> {t('Details')}
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed whitespace-pre-wrap">{s.log.slice(-15).join('\n')}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/** Small status button in the header: update running / failed / new version ready. */
export function UpdateIndicator() {
  const { t, dirty, save, saving } = useStore();
  const { status, running, offline, newVersion, result, dismiss } = useUpdate();
  const [open, setOpen] = useState(false);
  const failed = !running && result === 'error';
  if (!running && !failed && !newVersion) return null;

  const phase = offline ? 'restart' : status?.phase;
  const label = newVersion && !running
    ? t('New version ready')
    : failed
      ? t('Update failed')
      : t(UPDATE_PHASES(status?.mode).find((p) => p.id === phase)?.label || 'Updating …');

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={cn('max-w-64', failed ? 'border-destructive/40 text-destructive hover:text-destructive' : 'border-primary/40 text-primary hover:text-primary')}
        title={t('Update')}
      >
        {running ? <Loader2 className="animate-spin" /> : failed ? <CircleAlert /> : <ArrowUpCircle />}
        <span className="truncate max-2xl:sr-only">{label}</span>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{running ? t('Updating Magic Mirror …') : failed ? t('Update failed') : t('New version ready')}</AlertDialogTitle>
            <AlertDialogDescription>
              {newVersion && !running
                ? dirty
                  ? t('The new version is installed. Save your changes – the page then switches to it by itself.')
                  : t('The new version is installed. The page switches to it in a moment.')
                : running
                  ? t('The mirror is unavailable for a moment while it restarts.')
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {(running || failed) && <UpdateProgress />}
          <AlertDialogFooter>
            {failed && (
              <Button variant="outline" onClick={() => { dismiss(); setOpen(false); }}>
                {t('Dismiss')}
              </Button>
            )}
            {newVersion && !running && dirty && (
              <Button variant="outline" disabled={saving} onClick={() => save()}>
                {saving && <Loader2 className="animate-spin" />}
                {t('Save')}
              </Button>
            )}
            {newVersion && !running && (
              <Button variant={dirty ? 'outline' : 'default'} onClick={() => location.reload()}>
                <RefreshCw />
                {dirty ? t('Reload without saving') : t('Reload now')}
              </Button>
            )}
            <Button variant={newVersion && !running ? 'ghost' : 'default'} onClick={() => setOpen(false)}>
              {running ? t('Continue in the background') : t('Close')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
