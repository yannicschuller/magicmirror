import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BedDouble, Check, ChefHat, DoorOpen, LayoutGrid, Loader2, Minimize2, Sparkles } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { FieldsForm } from '@/components/fields';
import { api } from '@/lib/api';
import { GENERAL_FIELDS, defaultModule, type Module } from '@/lib/shared';
import { useStore } from '@/lib/store';

const DISMISSED = 'mm.setup.dismissed';
export const OPEN_SETUP = 'mm-open-setup';

type Slot = [type: string, region: string, extra?: Partial<Module>];
const TEMPLATES: { id: string; label: string; text: string; icon: typeof DoorOpen; modules: Slot[] }[] = [
  { id: 'hall', label: 'Hallway', text: 'Leaving the house: clock, weather with umbrella hint, appointments, departures and waste collection.', icon: DoorOpen,
    modules: [['clock', 'top_left'], ['weather', 'top_right'], ['weather_hints', 'top_center'], ['calendar', 'middle_left'], ['transit', 'middle_right'], ['waste', 'bottom_right'], ['greeting', 'bottom_center']] },
  { id: 'kitchen', label: 'Kitchen', text: 'Clock, weather, shopping list, electricity prices and news.', icon: ChefHat,
    modules: [['clock', 'top_left'], ['weather', 'top_right'], ['tasks', 'middle_left'], ['energy', 'middle_right'], ['countdown', 'bottom_left'], ['news', 'bottom_bar']] },
  { id: 'bedroom', label: 'Bedroom', text: 'A large clock, the weather and today\'s appointments – at night only the clock.', icon: BedDouble,
    modules: [['clock', 'middle_center'], ['weather', 'top_right'], ['calendar', 'top_left']] },
  { id: 'minimal', label: 'Minimal', text: 'Just clock and weather, nothing else.', icon: Minimize2,
    modules: [['clock', 'middle_center'], ['weather', 'bottom_center']] },
  { id: 'keep', label: 'Keep the current layout', text: 'Only set the basics; modules and pages stay as they are.', icon: LayoutGrid, modules: [] },
];
const NIGHT = [
  { id: 'none', label: 'Off', text: 'Always the same brightness.' },
  { id: 'dim', label: 'Dim', text: 'Darker from sunset to sunrise.' },
  { id: 'clock', label: 'Clock only', text: 'Only the clock at night.' },
  { id: 'off', label: 'Screen off', text: 'Screen off at night (standby).' },
];

/** First start: name, place and language, a layout template and the night mode – in three steps. */
export function SetupWizard() {
  const { cfg, t, mt, touch, save, setView } = useStore();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [template, setTemplate] = useState('hall');
  const [night, setNight] = useState('dim');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === '1';
    } catch {
      /* storage unavailable */
    }
    if (!dismissed) api<{ fresh: boolean }>('/setup').then((r) => r.fresh && setOpen(true)).catch(() => {});
    const again = () => {
      setStep(0);
      setTemplate('keep');
      setOpen(true);
    };
    window.addEventListener(OPEN_SETUP, again);
    return () => window.removeEventListener(OPEN_SETUP, again);
  }, []);

  const close = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      /* storage unavailable */
    }
    setOpen(false);
  };

  const finish = async () => {
    setBusy(true);
    const g = cfg.general;
    if (!g.timezone) g.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
    const tpl = TEMPLATES.find((x) => x.id === template);
    if (tpl && tpl.modules.length) {
      const page = { id: 'home', name: mt('Home'), duration: 45, enabled: true };
      cfg.pages = [page];
      cfg.modules = tpl.modules.map(([type, region, extra], i) => ({ ...defaultModule(type, { region, pages: ['home'], order: i, ...extra }, g.locale), id: `m_${type}` }));
    }
    if (night === 'none') g.dimEnabled = false;
    else Object.assign(g, { dimEnabled: true, nightTrigger: 'sun', nightMode: night });
    touch();
    await save();
    setBusy(false);
    close();
    setView(tpl?.modules.length ? 'layout' : 'general');
  };

  if (!open) return null;
  const basics = GENERAL_FIELDS.filter((f) => ['name', 'location', 'locale'].includes(f.key));
  const card = (active: boolean) => cn('flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60', active && 'border-primary bg-primary/10 hover:bg-primary/10');

  // portal: the header's backdrop blur would otherwise be the frame of "fixed"
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-3 py-[6vh] backdrop-blur-sm">
      <div role="dialog" aria-label={t('Set up the mirror')} className="flex w-full max-w-2xl flex-col gap-5 rounded-xl border bg-popover p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-1 size-5 text-primary" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">{t('Set up the mirror')}</h2>
            <p className="text-sm text-muted-foreground">{t('Step {n} of 3', { n: step + 1 })} · {[t('Basics'), t('Template'), t('Night mode')][step]}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={close}>{t('Skip')}</Button>
        </div>

        {step === 0 && <FieldsForm fields={basics} values={cfg.general} onChange={touch} />}

        {step === 1 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATES.map((x) => (
              <button key={x.id} type="button" className={card(template === x.id)} onClick={() => setTemplate(x.id)}>
                <x.icon className="mt-0.5 size-5 shrink-0 text-primary" />
                <span>
                  <span className="block text-sm font-medium">{t(x.label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(x.text)}</span>
                </span>
              </button>
            ))}
            {template !== 'keep' && <p className="text-xs text-warning sm:col-span-2">{t('This replaces the current pages and modules. Everything can be changed afterwards.')}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {NIGHT.map((x) => (
              <button key={x.id} type="button" className={card(night === x.id)} onClick={() => setNight(x.id)}>
                <span>
                  <span className="block text-sm font-medium">{t(x.label)}</span>
                  <span className="block text-xs text-muted-foreground">{t(x.text)}</span>
                </span>
              </button>
            ))}
            <p className="text-xs text-muted-foreground sm:col-span-2">{t('Next: add your calendar, stop or waste calendar in the modules – the search (Ctrl+K) finds every setting.')}</p>
          </div>
        )}

        <div className="flex justify-between gap-2">
          <Button variant="outline" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>{t('Back')}</Button>
          {step < 2 ? (
            <Button onClick={() => setStep(step + 1)}>{t('Next')}</Button>
          ) : (
            <Button onClick={finish} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t('Finish and save')}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
