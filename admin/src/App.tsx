import { useState } from 'react';
import { ExternalLink, Loader2, LogOut, Save, Undo2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmProvider } from '@/components/confirm';
import { LANGUAGES, type Build } from '@/lib/shared';
import { StoreProvider, useStore, useT, VIEWS, type View } from '@/lib/store';
import { VersionBadge } from '@/components/version-badge';
import { ChangesDialog } from '@/components/changes-dialog';
import { UpdateIndicator } from '@/components/update-progress';
import { useActiveTabVisible } from '@/lib/use-active-tab-visible';
import { UpdateProvider } from '@/lib/update';
import { HealthProvider } from '@/lib/health';
import { HealthBanner } from '@/components/health-banner';
import { BackupView } from '@/views/backup-view';
import { GeneralView } from '@/views/general-view';
import { LayoutView } from '@/views/layout-view';
import { ModulesView } from '@/views/modules-view';
import { RemoteView } from '@/views/remote-view';

const TAB_LABELS: Record<View, string> = {
  layout: 'Pages & layout',
  modules: 'Modules',
  general: 'General',
  remote: 'Remote',
  backup: 'Import / Export',
};

export default function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <StoreProvider fallback={(error) => <Loading error={error} />}>
        <UpdateProvider>
          <HealthProvider>
            <ConfirmProvider>
              <Shell />
            </ConfirmProvider>
          </HealthProvider>
        </UpdateProvider>
      </StoreProvider>
      <Toaster position="bottom-center" richColors={false} />
    </TooltipProvider>
  );
}

// Also rendered by the loading screen (outside the store), so the build info is a prop.
function Brand({ build }: { build?: Build }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold">
      <img src="/brand/logo.svg" alt="" className="size-7 drop-shadow-[0_0_8px_rgb(167_139_250/0.35)]" />
      <span>Magic Mirror</span>
      {build && <VersionBadge build={build} className="max-xl:hidden" />}
    </div>
  );
}


function UserMenu() {
  const { t, me } = useStore();
  const { lang, pickLang } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground" title={me.name}>
          <UserRound />
          <span className="sr-only">{me.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="truncate">{me.name}</DropdownMenuLabel>
        {me.build && (
          <DropdownMenuLabel className="py-0 text-xs font-normal text-muted-foreground">
            v{me.build.version}
            {me.build.shortCommit && ` · ${me.build.shortCommit}`}
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('Language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={lang} onValueChange={pickLang}>
          {LANGUAGES.map((l) => (
            <DropdownMenuRadioItem key={l.value} value={l.value}>
              {l.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
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
  );
}

function Shell() {
  const { t, view, setView, dirty, save, saving, discard, me } = useStore();
  const [showChanges, setShowChanges] = useState(false);
  const tabBar = useActiveTabVisible<HTMLDivElement>(view);
  return (
    <Tabs value={view} onValueChange={(v) => setView(v as View)} className="min-h-screen gap-0">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1700px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5 md:flex-nowrap">
          <Brand build={me.build} />
          {/* on phones the tabs get their own row (scrollable); from md on everything fits in one */}
          <div ref={tabBar} className="order-last -mx-3 w-[calc(100%+1.5rem)] min-w-0 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain px-3 py-px [scrollbar-width:none] sm:-mx-5 sm:w-[calc(100%+2.5rem)] sm:px-5 md:order-none md:mx-0 md:w-auto md:flex-1 md:px-0 [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-9">
              {VIEWS.map((v) => (
                <TabsTrigger key={v} value={v} className="px-3">
                  {t(TAB_LABELS[v])}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <UpdateIndicator />
            {dirty && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-warning hover:text-warning"
                  onClick={() => setShowChanges(true)}
                  title={t('Show changes')}
                >
                  <span className="size-2 rounded-full bg-warning" />
                  <span className="max-xl:sr-only">{t('Unsaved changes')}</span>
                </Button>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={discard} title={t('Discard')}>
                  <Undo2 />
                  <span className="sr-only">{t('Discard')}</span>
                </Button>
              </>
            )}
            <ChangesDialog open={showChanges && dirty} onOpenChange={setShowChanges} />
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              <span className="max-sm:sr-only">{t('Save')}</span>
            </Button>
            <Button variant="ghost" size="icon" asChild className="size-8 text-muted-foreground max-sm:hidden" title={t('Open mirror')}>
              <a href="/" target="_blank" rel="noopener">
                <ExternalLink />
                <span className="sr-only">{t('Open mirror')}</span>
              </a>
            </Button>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1700px] p-3 sm:p-5">
        <HealthBanner />
        <TabsContent value="layout">
          <LayoutView />
        </TabsContent>
        <TabsContent value="modules">
          <ModulesView />
        </TabsContent>
        <TabsContent value="general">
          <GeneralView />
        </TabsContent>
        <TabsContent value="remote">
          <RemoteView />
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
