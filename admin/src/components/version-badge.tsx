import { GitCommitHorizontal } from 'lucide-react';
import { cn } from 'cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Build } from '@/lib/shared';
import { useStore } from '@/lib/store';

const SOURCES: Record<Build['source'], string> = {
  release: 'Official image',
  local: 'Built on this device',
  dev: 'Development',
};

/** "v1.1.0 · 7ef27e2" – links to the commit on GitHub, details in a tooltip. */
export function VersionBadge({ build, className }: { build?: Build; className?: string }) {
  const { t, lang } = useStore();
  if (!build) return null;
  const label = (
    <>
      v{build.version}
      {build.shortCommit && (
        <>
          <GitCommitHorizontal className="size-3.5 opacity-70" />
          <span className="font-mono">{build.shortCommit}</span>
        </>
      )}
    </>
  );
  const cls = cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums', className);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {build.commitUrl ? (
          <a href={build.commitUrl} target="_blank" rel="noopener" className={cn(cls, 'hover:text-foreground')}>
            {label}
          </a>
        ) : (
          <span className={cls}>{label}</span>
        )}
      </TooltipTrigger>
      <TooltipContent className="flex flex-col gap-0.5 text-xs">
        <span>{t('Version {v}', { v: build.version })}</span>
        {build.commit && <span className="font-mono">{build.commit.slice(0, 12)}{build.branch ? ` (${build.branch})` : ''}</span>}
        {build.builtAt && <span>{t('Built {date}', { date: new Date(build.builtAt).toLocaleString(lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</span>}
        <span className="opacity-70">{t(SOURCES[build.source])}</span>
      </TooltipContent>
    </Tooltip>
  );
}
