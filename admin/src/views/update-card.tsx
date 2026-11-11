import { useState } from 'react';
import { ArrowUpCircle, CircleAlert, CircleCheck, Download, History, Loader2, PauseCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/confirm';
import { UpdateProgress } from '@/components/update-progress';
import { api, errorMessage } from '@/lib/api';
import { VersionBadge } from '@/components/version-badge';
import { useStore } from '@/lib/store';
import { useUpdate, type UpdateCheck } from '@/lib/update';

/** Version info, manual update check and a one-click update via the updater container. */
export function UpdateCard() {
  const { t, lang } = useStore();
  const confirm = useConfirm();
  const { status, running, result, error: loadError, start: startUpdate, setCheck } = useUpdate();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setCheck(await api<UpdateCheck>('/update/check', { method: 'POST' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const start = async () => {
    const ok = await confirm({
      title: t('Install update now?'),
      description: t('The update runs in the background – you can keep working. The mirror restarts for a moment, then this page switches to the new version by itself.'),
      action: t('Update now'),
    });
    if (ok) await startUpdate();
  };

  const rb = status?.rollback;
  const rollback = async () => {
    const ok = await confirm({
      title: t('Go back to version {v}?', { v: rb?.version || '?' }),
      description: t('The mirror returns to the version that ran before the last update and restarts for a moment. Automatic updates pause until you update manually again, so the newer version does not come straight back. Your configuration stays as it is.'),
      action: t('Go back'),
      destructive: true,
    });
    if (ok) await startUpdate('rollback');
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
            <> · {status.schedule === 'off'
              ? status.onBoot ? t('automatic update after every start') : t('automatic updates off')
              : `${t('automatic update daily at {time}', { time: status.schedule })}${status.onBoot ? ` ${t('and after every start')}` : ''}`}</>
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
        {(error || loadError) && <p className="text-sm text-destructive">{t(error || loadError!)}</p>}
        {(running || result) && (
          <div className="rounded-lg border bg-background/60 p-3">
            <UpdateProgress />
          </div>
        )}
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
              {running && <Loader2 className="animate-spin" />}
              <Download /> {t('Update now')}
            </Button>
          </div>
        )}
        {status?.hold && (
          <p className="flex items-center gap-2 text-sm text-warning">
            <PauseCircle className="size-4" /> {t('Automatic updates are paused since the rollback ({date}). "Update now" resumes them.', { date: date(status.hold) })}
          </p>
        )}
        {status?.available && rb && !running && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
            <History className="size-4 text-muted-foreground" />
            <span className="flex-1 text-muted-foreground">{t('Previous version: {v} (until {date})', { v: rb.version || '?', date: date(rb.at) })}</span>
            <Button size="sm" variant="outline" onClick={rollback}>
              {t('Go back to it')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
