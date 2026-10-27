import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Cpu, Info, Loader2, RefreshCw } from 'lucide-react';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { api, errorMessage } from '@/lib/api';
import { useStore } from '@/lib/store';

type Hint = { level: 'ok' | 'info' | 'warn'; id: string; params?: Record<string, string | number> };
type SystemInfo = {
  model: string;
  arch: string;
  kernel: string;
  container: string;
  cpus: number;
  load: number[];
  uptime: number;
  temperature: number | null;
  memory: { total: number; available: number; swapTotal: number; swapFree: number; server: number };
  disk: { total: number; free: number } | null;
  tier: 'low' | 'medium' | 'high';
  hints: Hint[];
};

const TIERS: Record<SystemInfo['tier'], string> = {
  low: 'Raspberry Pi 3 class',
  medium: 'Mid-range device',
  high: 'Powerful device',
};

function bytes(n: number, lang: string) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString(lang, { maximumFractionDigits: n < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

function duration(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d && `${d} d`, (d || h) && `${h} h`, `${m} min`].filter(Boolean).join(' ');
}

function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 rounded-lg border bg-background/60 px-3 py-2.5', className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-sm font-medium tabular-nums">{children}</div>
    </div>
  );
}

const HINT_STYLE = {
  ok: { icon: CircleCheck, className: 'text-success' },
  info: { icon: Info, className: 'text-primary' },
  warn: { icon: CircleAlert, className: 'text-warning' },
} as const;

/** Device info and resource recommendations from GET /api/admin/system (refreshes every 10 s). */
export function SystemCard() {
  const { t, lang } = useStore();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await api<SystemInfo>('/system'));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  const mem = info?.memory;
  const used = mem ? mem.total - mem.available : 0;
  const memPct = mem && mem.total ? Math.round((used / mem.total) * 100) : 0;
  const diskPct = info?.disk && info.disk.total ? Math.round(((info.disk.total - info.disk.free) / info.disk.total) * 100) : 0;
  const fmtLoad = (n: number) => n.toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <Cpu className="size-4.5 text-primary" />
          {t('System')}
        </CardTitle>
        <CardDescription>{t('These are recommendations only – all settings stay under your control. Try what works best on your device.')}</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            <span className="max-sm:sr-only">{t('Refresh')}</span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-destructive">{t(error)}</p>}
        {!info && !error && <p className="text-sm text-muted-foreground">{t('Loading …')}</p>}
        {info && mem && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <span className="font-semibold">{info.model === 'unknown' ? t('Unknown device') : info.model}</span>
              <Badge variant={info.tier === 'low' ? 'destructive' : 'secondary'}>{t(TIERS[info.tier] || info.tier)}</Badge>
              <span className="text-xs text-muted-foreground">
                {info.arch} · {t('{n} CPU core(s)', { n: info.cpus })} · {info.container} · Linux {info.kernel}
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Stat label={t('Memory')} className="sm:col-span-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>
                    {t('{used} of {total} used', { used: bytes(used, lang), total: bytes(mem.total, lang) })} ({memPct} %)
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">{t('{size} available', { size: bytes(mem.available, lang) })}</span>
                </div>
                <Progress value={memPct} className={cn('mt-2 h-1.5', memPct > 85 && '[&>[data-slot=progress-indicator]]:bg-warning')} />
              </Stat>
              <Stat label={t('Swap')}>
                {mem.swapTotal
                  ? t('{used} of {total} used', { used: bytes(mem.swapTotal - mem.swapFree, lang), total: bytes(mem.swapTotal, lang) })
                  : t('none')}
              </Stat>
              <Stat label={t('CPU load (1 / 5 / 15 min)')}>{info.load.map(fmtLoad).join(' / ')}</Stat>
              {info.temperature !== null && <Stat label={t('Temperature')}>{info.temperature.toLocaleString(lang, { maximumFractionDigits: 1 })} °C</Stat>}
              {info.disk && (
                <Stat label={t('Disk')}>
                  {t('{free} free of {total}', { free: bytes(info.disk.free, lang), total: bytes(info.disk.total, lang) })}
                  <Progress value={diskPct} className="mt-2 h-1.5" />
                </Stat>
              )}
              <Stat label={t('Uptime')}>{duration(info.uptime)}</Stat>
              <Stat label={t('Server memory')}>{bytes(mem.server, lang)}</Stat>
            </div>
            {info.hints.length > 0 && (
              <>
                <Separator />
                <ul className="flex flex-col gap-2">
                  {info.hints.map((h, i) => {
                    const s = HINT_STYLE[h.level] || HINT_STYLE.info;
                    const Icon = s.icon;
                    return (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <Icon className={cn('mt-0.5 size-4 shrink-0', s.className)} />
                        <span>{t(h.id, h.params)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
