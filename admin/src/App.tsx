import { ExternalLink, Loader2, LogOut, Save, Undo2, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/confirm';
import { LANGUAGES } from '@/lib/shared';
import { StoreProvider, useStore, useT, VIEWS, type View } from '@/lib/store';
import { BackupView } from '@/views/backup-view';
import { GeneralView } from '@/views/general-view';
import { LayoutView } from '@/views/layout-view';
import { ModulesView } from '@/views/modules-view';

const TAB_LABELS: Record<View, string> = {
  layout: 'Pages & layout',
  modules: 'Modules',
  general: 'General',
  backup: 'Import / Export',
};

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <StoreProvider fallback={(error) => <Loading error={error} />}>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </StoreProvider>
      <Toaster position="bottom-center" richColors={false} />
    </TooltipProvider>
  );
}

function Brand() {
  return (
    <div className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold">
      <img src="/brand/logo.svg" alt="" className="size-7 drop-shadow-[0_0_8px_rgb(167_139_250/0.35)]" />
      <span>Magic Mirror</span>
    </div>
  );
}

function LanguageSwitch() {
  const { t, lang, pickLang } = useT();
  return (
    <ToggleGroup
      type="single"
      size="sm"
      spacing={0}
      value={lang}
      aria-label={t('Language')}
      onValueChange={(v) => v && pickLang(v)}
      className="rounded-lg border"
    >
      {LANGUAGES.map((l) => (
        <ToggleGroupItem key={l.value} value={l.value} title={l.label} className="px-2 text-xs font-semibold data-[state=on]:bg-secondary data-[state=on]:text-foreground">
          {l.value.toUpperCase()}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function Shell() {
  const { t, view, setView, dirty, save, saving, discard, me } = useStore();
  return (
    <Tabs value={view} onValueChange={(v) => setView(v as View)} className="min-h-screen gap-0">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5 sm:px-5">
          <Brand />
          <div className="order-last -mx-3 w-[calc(100%+1.5rem)] overflow-x-auto px-3 [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto sm:px-0 [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-9">
              {VIEWS.map((v) => (
                <TabsTrigger key={v} value={v} className="px-3">
                  {t(TAB_LABELS[v])}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <>
                <Badge variant="outline" className="hidden border-warning/40 text-warning md:inline-flex">
                  {t('Unsaved changes')}
                </Badge>
                <Button variant="ghost" size="sm" onClick={discard}>
                  <Undo2 />
                  <span className="max-sm:sr-only">{t('Discard')}</span>
                </Button>
              </>
            )}
            <Button size="sm" onClick={save} disabled={!dirty || saving} title={dirty ? t('Unsaved changes') : undefined}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {t('Save')}
            </Button>
            <Button variant="outline" size="sm" asChild className="max-sm:hidden">
              <a href="/" target="_blank" rel="noopener">
                {t('Open mirror')}
                <ExternalLink />
              </a>
            </Button>
            <LanguageSwitch />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="max-w-40 text-muted-foreground">
                  <UserRound />
                  <span className="truncate max-md:sr-only">{me.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuLabel className="truncate">{me.name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="sm:hidden">
                  <a href="/" target="_blank" rel="noopener">
                    <ExternalLink />
                    {t('Open mirror')}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href="/auth/logout">
                    <LogOut />
                    {t('Sign out')}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1700px] p-3 sm:p-5">
        <TabsContent value="layout">
          <LayoutView />
        </TabsContent>
        <TabsContent value="modules">
          <ModulesView />
        </TabsContent>
        <TabsContent value="general">
          <GeneralView />
        </TabsContent>
        <TabsContent value="backup">
          <BackupView />
        </TabsContent>
      </main>
    </Tabs>
  );
}

function Loading({ error }: { error: string | null }) {
  const { t } = useT();
  return (
    <div className="min-h-screen">
      <header className="border-b px-5 py-3">
        <Brand />
      </header>
      <main className="mx-auto max-w-4xl p-5">
        {error ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">{t('Error')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-destructive">{t(error)}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('Loading …')}
          </div>
        )}
      </main>
    </div>
  );
}
