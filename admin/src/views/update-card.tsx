import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Check, ChevronDown, CircleAlert, CircleCheck, Download, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { useConfirm } from '@/components/confirm';
import { api, errorMessage } from '@/lib/api';
import { VersionBadge } from '@/components/version-badge';
import type { Build } from '@/lib/shared';
import { useStore } from '@/lib/store';

type Change = { sha: string; date: string; subject: string };
type Check = {
  ok: boolean;
  method?: 'git' | 'image';
  checkedAt: string;
  error?: string | null;
  available?: boolean;
  current?: { version: string; commit?: string };
  latest?: { version: string | null; commit?: string };
  changes?: Change[];
};
type UpdateStatus = {
  available: boolean;
  version: string;
  build?: Build;
  state?: 'idle' | 'running' | 'done' | 'error';
  phase?: string;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  check?: Check | null;
  log?: string[];
  mode?: 'pull' | 'build';
  schedule?: string;
};

const PHASES = (mode?: string) => [
  { id: 'git', label: 'Fetching the latest version' },
  { id: mode === 'build' ? 'build' : 'pull', label: mode === 'build' ? 'Building images on this device' : 'Downloading new images' },
  { id: 'restart', label: 'Restarting the mirror' },
  { id: 'cleanup', label: 'Cleaning up' },
];

/** Version info, manual update check and a one-click update via the updater container. */
export function UpdateCard() {
  const { t, lang } = useStore();
  const confirm = useConfirm();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // startedAt of the previous run – its "done" must not be mistaken for the new run's result
  const [prevRun, setPrevRun] = useState<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const s = await api<UpdateStatus>('/update');
      setStatus(s);
      if (s.state === 'running') setRunning(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const result = await api<Check>('/update/check', { method: 'POST' });
      setStatus((s) => (s ? { ...s, check: result } : s));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const start = async () => {
    const ok = await confirm({
      title: t('Install update now?'),
      description: t('The mirror restarts during the update and is unavailable for a moment. This can take a few minutes on a Raspberry Pi.'),
      action: t('Update now'),
    });
    if (!ok) return;
    try {
      setPrevRun(status?.startedAt ?? null);
      await api('/update/run', { method: 'POST' });
      setRunning(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const c = status?.check;
  const date = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <ArrowUpCircle className="size-4.5 text-primary" />
          {t('Updates')}
        </CardTitle>
        <CardDescription>
          {t('Installed version')}: {status?.build ? <VersionBadge build={status.build} className="align-middle" /> : <span className="font-medium text-foreground tabular-nums">{status?.version ?? '…'}</span>}
          {status?.build?.builtAt && <> · {t('built {date}', { date: date(status.build.builtAt) })}</>}
          {status?.available && status.schedule && (
            <> · {status.schedule === 'off' ? t('automatic updates off') : t('automatic update daily at {time}', { time: status.schedule })}</>
          )}
        </CardDescription>
        {status?.available && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={check} disabled={checking || running}>
              {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              <span className="max-sm:sr-only">{t('Check for updates')}</span>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <p className="text-sm text-destructive">{t(error)}</p>}
        {status && !status.available && (
          <div className="rounded-lg border bg-background/60 p-3 text-sm">
            <p>{t('The updater is not enabled. Add "autoupdate" to COMPOSE_PROFILES in .env (UPDATE_TIME=off for manual updates only), then run:')}</p>
            <code className="mt-2 block rounded bg-muted px-2 py-1.5 text-xs">docker compose up -d</code>
          </div>
        )}
        {status?.available && !c && <p className="text-sm text-muted-foreground">{t('Not checked yet.')}</p>}
        {c && !c.ok && (
          <p className="flex items-center gap-2 text-sm text-warning">
            <CircleAlert className="size-4" /> {t('Check failed: {error}', { error: t(c.error || 'unknown error') })}
          </p>
        )}
        {c?.ok && !c.available && (
          <p className="flex items-center gap-2 text-sm">
            <CircleCheck className="size-4 text-success" /> {t('Magic Mirror is up to date.')}
            <span className="text-xs text-muted-foreground">{t('checked {date}', { date: date(c.checkedAt) })}</span>
          </p>
        )}
        {c?.ok && c.available && (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>{t('Update available')}</Badge>
              {c.latest?.version && c.latest.version !== c.current?.version && (
                <span className="tabular-nums">
                  {c.current?.version} → <b>{c.latest.version}</b>
                </span>
              )}
              {c.changes && c.changes.length > 0 && <span className="text-muted-foreground">{t('{n} change(s)', { n: c.changes.length })}</span>}
            </div>
            {c.changes && c.changes.length > 0 && (
              <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto text-sm">
                {c.changes.map((ch) => (
                  <li key={ch.sha} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0">
                      {ch.subject} <span className="text-xs text-muted-foreground">· {date(ch.date)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button className="self-start" onClick={start} disabled={running}>
              <Download /> {t('Update now')}
            </Button>
          </div>
        )}
      </CardContent>
      {running && status && <UpdateOverlay initial={status} prevRun={prevRun} onClose={() => { setRunning(false); setPrevRun(undefined); load(); }} />}
    </Card>
  );
}

/** Full-screen progress while the updater runs; survives the server restart by polling. */
function UpdateOverlay({ initial, prevRun, onClose }: { initial: UpdateStatus; prevRun?: string | null; onClose: () => void }) {
  const { t } = useStore();
  // Until the updater reports the new run, the status still describes the previous one.
  const fresh = (x: UpdateStatus) => prevRun === undefined || (x.state === 'running' || (!!x.startedAt && x.startedAt !== prevRun));
  const pending = (x: UpdateStatus): UpdateStatus => ({ ...x, state: 'running', phase: 'start', error: null, log: [] });
  const [s, setS] = useState<UpdateStatus>(() => (fresh(initial) ? initial : pending(initial)));
  const [offline, setOffline] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedVersion = useRef(initial.version);
  const started = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const next = await api<UpdateStatus>('/update');
        if (!alive) return;
        setOffline(false);
        setS(fresh(next) ? next : pending(next));
      } catch {
        // The server container is being recreated – keep waiting.
        if (alive) setOffline(true);
      }
    };
    poll();
    const timer = setInterval(poll, 1500);
    const clock = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, []);

  const done = s.state === 'done';
  const failed = s.state === 'error';
  const phases = PHASES(s.mode);
  const current = offline ? phases.findIndex((p) => p.id === 'restart') : phases.findIndex((p) => p.id === s.phase);
  const progress = done ? 100 : Math.max(5, Math.round(((Math.max(current, 0) + 0.5) / phases.length) * 100));
  const changedVersion = done && s.version !== startedVersion.current;

  // Reload into the new admin panel shortly after success.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => location.reload(), 4000);
    return () => clearTimeout(timer);
  }, [done]);

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-live="polite">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border bg-card p-8 text-center shadow-2xl">
        <div className="relative grid size-24 place-items-center">
          {!done && !failed && (
            <>
              <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary [animation-duration:1.4s]" />
              <span className="absolute inset-2 animate-spin rounded-full border-2 border-transparent border-b-brand-violet [animation-direction:reverse] [animation-duration:2.2s]" />
            </>
          )}
          {done && <span className="absolute inset-0 rounded-full bg-success/15" />}
          {failed && <span className="absolute inset-0 rounded-full bg-destructive/15" />}
          <img src="/brand/logo.svg" alt="" className={cn('size-12 transition-transform', !done && !failed && 'animate-pulse')} />
        </div>

        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            {done ? t('Update installed') : failed ? t('Update failed') : t('Updating Magic Mirror …')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {done
              ? changedVersion
                ? t('Now running version {v}. The page reloads in a moment.', { v: s.version })
                : t('Everything is up to date. The page reloads in a moment.')
              : failed
                ? t(s.error || 'unknown error')
                : t('Please keep this page open. Elapsed: {time}', { time: mmss })}
          </p>
        </div>

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

        {(done || failed) && (
          <Button variant={done ? 'default' : 'outline'} onClick={done ? () => location.reload() : onClose}>
            {done ? t('Reload now') : t('Close')}
          </Button>
        )}
      </div>
    </div>
  );
}
