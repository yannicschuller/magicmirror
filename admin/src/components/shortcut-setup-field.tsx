import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Values } from '@/lib/shared';
import { useStore } from '@/lib/store';

const DOCS = 'https://github.com/yannicschuller/magicmirror/blob/main/docs/';

// navigator.clipboard needs a secure context (https/localhost) – the admin often runs on plain http in the LAN.
function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

/** The two values the Shortcut needs (block 4 "Get Contents of URL"), ready to copy. */
export function ShortcutSetupField({ values }: { values: Values }) {
  const { t, lang } = useStore();
  const [copied, setCopied] = useState('');
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const items = [
    { id: 'url', label: t('URL'), value: `${location.origin}/api/push/tasks` },
    { id: 'header', label: t('Header "Authorization"'), value: `Bearer ${String(values.pushToken || '')}` },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it) => (
        <div key={it.id} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{it.label}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-2.5 py-1.5 font-mono text-xs select-all">{it.value}</code>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                copyText(it.value).then(() => {
                  setCopied(it.id);
                  setTimeout(() => setCopied(''), 2000);
                })
              }
            >
              {copied === it.id ? <Check /> : <Copy />}
              {copied === it.id ? t('Copied') : t('Copy')}
            </Button>
          </div>
        </div>
      ))}
      {local && <p className="text-xs text-warning">{t('You opened the admin panel via localhost – your phone needs the mirror\'s IP address or name instead.')}</p>}
      <p className="text-xs text-muted-foreground">
        {t('Enter both in the action "Get Contents of URL" (method POST). Which blocks you need is shown in the guide:')}{' '}
        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`${DOCS}${lang === 'de' ? 'apple-reminders.de.md' : 'apple-reminders.md'}`} target="_blank" rel="noopener">
          {t('Step-by-step guide')}
          <ExternalLink className="size-3" />
        </a>
      </p>
    </div>
  );
}
