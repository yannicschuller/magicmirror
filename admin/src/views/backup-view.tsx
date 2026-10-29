import { useEffect, useState, type FormEvent } from 'react';
import { Download, FileJson, KeyRound, Loader2, RefreshCw, RotateCcw, Upload, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useConfirm } from '@/components/confirm';
import { api, errorMessage } from '@/lib/api';
import { moduleName } from '@/lib/helpers';
import type { Config, Module, Page } from '@/lib/shared';
import { useStore } from '@/lib/store';
import { UpdateCard } from './update-card';
import { HistoryCard } from './history-card';

/** Renders the only markup our messages use (<b>…</b>) without innerHTML. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/<b>(.*?)<\/b>/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-foreground">{p}</b> : p))}</>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{children}</h3>;
}

export function BackupView() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <BackupCard />
      <HistoryCard />
      <UpdateCard />
      <AccountCard />
    </div>
  );
}

type Pending = { name: string; json: unknown; cfg: { pages: Page[]; modules: Module[] }; exportedAt?: string };

function BackupCard() {
  const { t, lang, setConfig } = useStore();
  const confirm = useConfirm();
  const [pending, setPending] = useState<Pending | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<{ clients: number; go2rtc: { ok: boolean; error?: string } } | null>(null);

  useEffect(() => {
    api('/status').then(setStatus).catch(() => {});
  }, []);

  const onFile = async (file: File | undefined) => {
    setPending(null);
    setImportError(null);
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const cfg = json.app === 'magicmirror' && json.config ? json.config : json;
      if (!Array.isArray(cfg.modules) || !Array.isArray(cfg.pages)) throw new Error('Not a valid Magic Mirror configuration');
      setPending({ name: file.name, json, cfg, exportedAt: json.exportedAt });
    } catch (err) {
      setImportError(t(errorMessage(err)));
    }
  };

  const doImport = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      setConfig(await api<Config>('/import', { method: 'POST', body: pending.json }));
      toast.success(t('Configuration imported'));
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setImporting(false);
    }
  };

  const reload = async () => {
    try {
      const r = await api<{ clients: number }>('/command', { method: 'POST', body: { type: 'reload' } });
      toast.success(t('{n} mirror(s) reloaded', { n: r.clients }));
    } catch (err) {
      toast.error(t(errorMessage(err)));
    }
  };

  const reset = async () => {
    const ok = await confirm({
      title: t('Reset to defaults'),
      description: t('Really reset everything to the default configuration? Best export a backup first.'),
      action: t('Reset to defaults'),
      destructive: true,
    });
    if (!ok) return;
    try {
      setConfig(await api<Config>('/reset', { method: 'POST', body: {} }));
      toast.success(t('Default configuration restored'));
    } catch (err) {
      toast.error(t(errorMessage(err)));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">{t('Import / Export')}</CardTitle>
        <CardDescription>
          <Rich
            text={t(
              'The backup contains the <b>complete</b> configuration: all pages, modules, positions and settings – including calendar, camera and waste URLs. Treat the file as confidential.',
            )}
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <Button asChild>
            <a href="/api/admin/export" download>
              <Download />
              {t('Export configuration')}
            </a>
          </Button>
        </div>
        <Separator />
        <div className="flex flex-col gap-2">
          <SectionTitle>{t('Import')}</SectionTitle>
          <p className="text-xs text-muted-foreground">{t('Completely replaces the current configuration. The mirrors reload automatically afterwards.')}</p>
          <Input
            type="file"
            accept="application/json,.json"
            aria-label={t('Import')}
            className="h-auto max-w-md py-1.5 file:mr-3 file:rounded-md file:bg-secondary file:px-2.5 file:py-1"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {importError && <p className="text-sm text-destructive">{importError}</p>}
          {pending && (
            <div className="mt-1 flex flex-col gap-2 rounded-xl border bg-background/70 p-3.5 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <FileJson className="size-4 text-primary" />
                <b className="font-semibold">{pending.name}</b>
                {pending.exportedAt && (
                  <span className="text-muted-foreground">· {t('exported {date}', { date: new Date(pending.exportedAt).toLocaleString(lang) })}</span>
                )}
              </p>
              <p>
                <span className="text-muted-foreground">{t('{n} page(s)', { n: pending.cfg.pages.length })}:</span>{' '}
                {pending.cfg.pages.map((p) => p.name).join(', ')}
              </p>
              <p>
                <span className="text-muted-foreground">{t('{n} module(s)', { n: pending.cfg.modules.length })}:</span>{' '}
                {pending.cfg.modules.map((m) => moduleName(m, t)).join(', ')}
              </p>
              <div>
                <Button onClick={doImport} disabled={importing}>
                  {importing ? <Loader2 className="animate-spin" /> : <Upload />}
                  {t('Import now')}
                </Button>
              </div>
            </div>
          )}
        </div>
        <Separator />
        <div className="flex flex-col gap-3">
          <SectionTitle>{t('Control mirrors')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reload}>
              <RefreshCw />
              {t('Reload all mirrors')}
            </Button>
            <Button variant="destructive" onClick={reset}>
              <RotateCcw />
              {t('Reset to defaults')}
            </Button>
          </div>
          {status && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{t('Connected mirrors: {n}', { n: status.clients })}</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5">
                go2rtc:
                <Badge variant={status.go2rtc.ok ? 'secondary' : 'destructive'}>
                  {status.go2rtc.ok ? t('ok') : t('not reachable ({error})', { error: t(status.go2rtc.error || '') })}
                </Badge>
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { me, t } = useStore();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = Object.fromEntries(new FormData(formEl)) as Record<string, string>;
    if (form.password !== form.repeat) return void toast.error(t('Passwords do not match'));
    setBusy(true);
    try {
      await api('/password', { method: 'POST', body: { current: form.current, password: form.password } });
      formEl.reset();
      toast.success(t('Password changed.'));
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <UserRound className="size-4.5 text-brand-violet" />
          {t('Account')}
        </CardTitle>
        <CardDescription>
          {t('Signed in as {name} ({method})', { name: me.name, method: me.method === 'local' ? t('local account') : 'OIDC' })} ·{' '}
          {t('Version {v}', { v: me.version })}
        </CardDescription>
      </CardHeader>
      {me.method === 'local' && (
        <CardContent className="flex flex-col gap-3">
          <SectionTitle>{t('Change password')}</SectionTitle>
          <form onSubmit={submit} className="grid max-w-sm gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pw-current" className="text-xs text-muted-foreground">
                {t('Current password')}
              </Label>
              <Input id="pw-current" type="password" name="current" autoComplete="current-password" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-new" className="text-xs text-muted-foreground">
                {t('New password')}
              </Label>
              <Input id="pw-new" type="password" name="password" autoComplete="new-password" minLength={8} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-repeat" className="text-xs text-muted-foreground">
                {t('Repeat new password')}
              </Label>
              <Input id="pw-repeat" type="password" name="repeat" autoComplete="new-password" minLength={8} required />
            </div>
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {t('Change password')}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
