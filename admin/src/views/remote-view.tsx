import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Lightbulb, Loader2, Moon, MonitorOff, Pause, Play, RefreshCw, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OptionSelect } from '@/components/fields';
import { api, errorMessage } from '@/lib/api';
import { useStore } from '@/lib/store';

type Display = { mode: 'day' | 'dim' | 'clock' | 'off'; brightness: number; override: { mode: string; until: string | null } | null };

const DURATIONS = [
  { value: '0', label: 'Until changed' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '480', label: '8 hours' },
];

/** Phone-friendly remote control: switch pages, hold rotation, screen on/off/night. */
export function RemoteView() {
  const { cfg, t, lang } = useStore();
  const [display, setDisplay] = useState<Display | null>(null);
  const [duration, setDuration] = useState('60');
  const [busy, setBusy] = useState<string | null>(null);
  const [held, setHeld] = useState(false);

  const loadDisplay = useCallback(() => api<Display>('/display').then(setDisplay).catch(() => {}), []);
  useEffect(() => {
    loadDisplay();
    const timer = setInterval(loadDisplay, 15000);
    return () => clearInterval(timer);
  }, [loadDisplay]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setBusy(null);
    }
  };
  const command = (type: string, extra: Record<string, unknown> = {}) =>
    run(type + (extra.page ?? ''), async () => {
      const r = await api<{ clients: number }>('/command', { method: 'POST', body: { type, ...extra } });
      if (!r.clients) toast.warning(t('No mirror is connected right now.'));
    });
  const setScreen = (mode: string | null) =>
    run(`screen-${mode}`, async () => setDisplay(await api<Display>('/display', { method: 'POST', body: { mode, minutes: Number(duration) } })));

  const big = 'h-16 flex-1 flex-col gap-1 text-xs [&_svg]:size-5';
  const active = display?.override?.mode ?? null;
  const until = display?.override?.until ? new Date(display.override.until).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : null;
  const stateLabel = { day: 'On', dim: 'Dimmed', clock: 'Clock only', off: 'Off' }[display?.mode ?? 'day'];

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('Pages')}</CardTitle>
          <CardDescription>{t('Switches all connected mirrors at once.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button variant="outline" className={big} onClick={() => command('prev')}>
              <ChevronLeft /> {t('Back')}
            </Button>
            <Button
              variant={held ? 'default' : 'outline'}
              className={big}
              onClick={() => {
                command(held ? 'resume' : 'hold', { minutes: 60 });
                setHeld(!held);
              }}
            >
              {held ? <Play /> : <Pause />} {held ? t('Resume rotation') : t('Hold page (1 h)')}
            </Button>
            <Button variant="outline" className={big} onClick={() => command('next')}>
              <ChevronRight /> {t('Next')}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {cfg.pages.map((p) => (
              <Button key={p.id} variant="secondary" className={cn('h-11 justify-start truncate', !p.enabled && 'opacity-60')} onClick={() => command('page', { page: p.id })}>
                {busy === `page${p.id}` ? <Loader2 className="animate-spin" /> : null}
                <span className="truncate">{p.name}</span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{t('Screen')}</CardTitle>
          <CardDescription>
            {t('Now')}: <b className="font-medium text-foreground">{t(stateLabel)}</b>
            {active && <> · {until ? t('manual until {time}', { time: until }) : t('manual')}</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant={active === 'on' ? 'default' : 'outline'} className={big} onClick={() => setScreen('on')}>
              <Sun /> {t('On')}
            </Button>
            <Button variant={active === 'night' ? 'default' : 'outline'} className={big} onClick={() => setScreen('night')}>
              <Moon /> {t('Night mode')}
            </Button>
            <Button variant={active === 'off' ? 'default' : 'outline'} className={big} onClick={() => setScreen('off')}>
              <MonitorOff /> {t('Off')}
            </Button>
            <Button variant={!active ? 'default' : 'outline'} className={big} onClick={() => setScreen(null)}>
              <Lightbulb /> {t('Automatic')}
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('For')}</span>
            <OptionSelect className="flex-1" value={duration} options={DURATIONS} onValue={setDuration} />
          </div>
          <p className="text-xs text-muted-foreground">{t('"Automatic" follows the night mode from the general settings again.')}</p>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => command('reload')} disabled={busy === 'reload'}>
        {busy === 'reload' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {t('Reload all mirrors')}
      </Button>
    </div>
  );
}
