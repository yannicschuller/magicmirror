import { useState } from 'react';
import { Clock, Monitor, Moon, Palette, Settings2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FieldsForm } from '@/components/fields';
import { GENERAL_FIELDS, GENERAL_GROUPS } from '@/lib/shared';
import { useStore } from '@/lib/store';
import { SystemCard } from './system-card';
import { useActiveTabVisible } from '@/lib/use-active-tab-visible';

const ICONS: Record<string, typeof Clock> = { basics: Settings2, look: Palette, pages: Clock, night: Moon, system: Monitor };
const DESCRIPTIONS: Record<string, string> = {
  basics: 'Name, location, time zone and language of the mirror.',
  look: 'Font, colours, margins and orientation.',
  pages: 'How and when pages switch.',
  night: 'Dim the mirror at night, show only the clock or switch the screen off.',
  system: 'Housekeeping and the state of the device.',
};
const TAB_KEY = 'mm.general.tab';

/** General settings, split into tabs by the fields' `group`. */
export function GeneralView() {
  const { cfg, t, touch } = useStore();
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem(TAB_KEY) || 'basics';
    } catch {
      return 'basics';
    }
  });
  const pick = (v: string) => {
    setTab(v);
    try {
      localStorage.setItem(TAB_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  const bar = useActiveTabVisible<HTMLDivElement>(tab);
  return (
    <Tabs value={tab} onValueChange={pick} className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div ref={bar} className="-mx-3 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain px-3 py-px [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <TabsList className="h-9">
          {GENERAL_GROUPS.map((g) => {
            const Icon = ICONS[g.id] || Settings2;
            return (
              <TabsTrigger key={g.id} value={g.id} className="gap-1.5 px-3">
                <Icon className="size-3.5" />
                {t(g.label)}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </div>
      {GENERAL_GROUPS.map((g) => (
        <TabsContent key={g.id} value={g.id} className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">{t(g.label)}</CardTitle>
              <CardDescription>{t(DESCRIPTIONS[g.id] || '')}</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldsForm fields={GENERAL_FIELDS.filter((f) => (f.group || 'basics') === g.id)} values={cfg.general} onChange={touch} />
            </CardContent>
          </Card>
          {g.id === 'system' && <SystemCard />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
