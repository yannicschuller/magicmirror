import { useCallback, useEffect, useState } from 'react';
import { Archive, CircleAlert, CircleCheck, Download, Loader2, Play, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/confirm';
import { api, errorMessage } from '@/lib/api';
import type { Config } from '@/lib/shared';
import { useStore } from '@/lib/store';

type Backup = { name: string; size: number; createdAt: string };
type Status = { at: string; ok: boolean; name?: string; error?: string; targets: Record<string, { ok: boolean; error?: string }> };

const TARGETS: Record<string, string> = { local: 'On the Pi', usb: 'USB stick', smb: 'Network share', webdav: 'WebDAV' };
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Automatic backups: last result, archives on the Pi, back up now, download, restore. */
export function BackupsCard() {
  const { t, lang, cfg, dirty, setConfig } = useStore();
  const confirm = useConfirm();
  const [data, setData] = useState<{ list: Backup[]; status: Status | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => api('/backups').then(setData).catch(() => setData({ list: [], status: null })), []);
  useEffect(() => {
    load();
  }, [load]);

  const date = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' });
  const g = cfg.general;

  const runNow = async () => {
    setBusy('run');
    try {
      const r = await api<Status>('/backups/run', { method: 'POST' });
      if (r.ok) toast.success(t('Backup created'));
      else toast.error(t('Backup finished with errors'));
      await load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (b: Backup) => {
    const ok = await confirm({
      title: t('Restore this backup?'),
      description: t('The configuration from {date} replaces the current one. The current state stays in the history.', { date: date(b.createdAt) }) + (dirty ? ` ${t('Unsaved changes are lost.')}` : ''),
      action: t('Restore'),
    });
    if (!ok) return;
    setBusy(b.name);
    try {
      setConfig(await api<Config>(`/backups/${encodeURIComponent(b.name)}/restore`, { method: 'POST' }));
      toast.success(t('Configuration restored'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const st = data?.status;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <Archive className="size-4.5 text-primary" />
          {t('Backups')}
        </CardTitle>
        <CardDescription>
          {g?.backupEnabled ? t('Automatic backup every night at {time}', { time: g.backupTime || '03:30' }) : t('Automatic backup is off – switch it on under General → Backup.')}
        </CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={runNow} disabled={!!busy}>
            {busy === 'run' ? <Loader2 className="animate-spin" /> : <Play />}
            <span className="max-sm:sr-only">{t('Back up now')}</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {st && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('Last backup: {date}', { date: date(st.at) })}</span>
            {st.error && <span className="flex items-center gap-1.5 text-destructive"><CircleAlert className="size-4" /> {t(st.error)}</span>}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {Object.entries(st.targets || {}).map(([k, v]) => (
                <span key={k} className={v.ok ? 'flex items-center gap-1.5 text-success' : 'flex items-center gap-1.5 text-destructive'} title={v.error}>
                  {v.ok ? <CircleCheck className="size-4" /> : <CircleAlert className="size-4" />}
                  {t(TARGETS[k] || k)}
                  {!v.ok && v.error && <span className="text-xs">· {t(v.error)}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
        {data && data.list.length === 0 && <p className="text-sm text-muted-foreground">{t('No backups yet.')}</p>}
        {data && data.list.length > 0 && (
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.list.map((b) => (
              <li key={b.name} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 truncate">{date(b.createdAt)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{size(b.size)}</span>
                <Button asChild size="icon-sm" variant="ghost" title={t('Download')}>
                  <a href={`/api/admin/backups/${encodeURIComponent(b.name)}`} download>
                    <Download />
                  </a>
                </Button>
                <Button size="icon-sm" variant="ghost" title={t('Restore configuration')} onClick={() => restore(b)} disabled={!!busy}>
                  {busy === b.name ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
