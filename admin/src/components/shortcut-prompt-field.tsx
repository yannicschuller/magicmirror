import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Values } from '@/lib/shared';
import { useStore } from '@/lib/store';

const DOCS = 'https://github.com/yannicschuller/magicmirror/blob/main/docs/';

// Same wording as docs/apple-reminders*.md – short sentences, the Shortcuts AI rejects long ones.
const PROMPTS = {
  de: {
    simple: (list: string, url: string, token: string) =>
      `Finde alle nicht erledigten Erinnerungen in der Liste ${list}, kombiniere ihre Titel mit Zeilenumbrüchen und sende den Text per POST an ${url} mit dem Header Authorization: Bearer ${token}.`,
    due: (list: string, url: string, token: string) =>
      `Finde alle nicht erledigten Erinnerungen in der Liste ${list}. Erstelle für jede eine Zeile mit Titel | Fälligkeitsdatum im ISO-8601-Format. Kombiniere die Zeilen mit Zeilenumbrüchen und sende den Text per POST an ${url} mit dem Header Authorization: Bearer ${token}.`,
  },
  en: {
    simple: (list: string, url: string, token: string) =>
      `Find all incomplete reminders in the list ${list}, combine their titles with new lines and send the text via POST to ${url} with the header Authorization: Bearer ${token}.`,
    due: (list: string, url: string, token: string) =>
      `Find all incomplete reminders in the list ${list}. For each, make a line with Title | due date in ISO 8601 format. Combine the lines with new lines and send the text via POST to ${url} with the header Authorization: Bearer ${token}.`,
  },
};

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

/** Ready-to-paste prompt for the Shortcuts app with this mirror's URL and token filled in. */
export function ShortcutPromptField({ values }: { values: Values }) {
  const { t, lang } = useStore();
  const [copied, setCopied] = useState('');
  const l = lang === 'de' ? 'de' : 'en';
  const url = `${location.origin}/api/push/tasks`;
  const token = String(values.pushToken || '');
  const list = String(values.shortcutList || '').trim() || (l === 'de' ? 'Erinnerungen' : 'Reminders');
  const items = [
    { id: 'simple', label: t('Simple (titles only)'), text: PROMPTS[l].simple(list, url, token) },
    { id: 'due', label: t('With due dates'), text: PROMPTS[l].due(list, url, token) },
  ];
  return (
    <div className="flex flex-col gap-3">
      {items.map((p) => (
        <div key={p.id} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">{p.label}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                copyText(p.text).then(() => {
                  setCopied(p.id);
                  setTimeout(() => setCopied(''), 2000);
                })
              }
            >
              {copied === p.id ? <Check /> : <Copy />}
              {copied === p.id ? t('Copied') : t('Copy')}
            </Button>
          </div>
          <pre className="rounded-lg border bg-background/60 p-3 text-xs leading-relaxed whitespace-pre-wrap select-all">{p.text}</pre>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {t('Paste it into the Shortcuts app ("New shortcut" → describe it). The automation (run when the Reminders app is closed) has to be set up by hand.')}{' '}
        <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`${DOCS}${l === 'de' ? 'apple-reminders.de.md' : 'apple-reminders.md'}`} target="_blank" rel="noopener">
          {t('Step-by-step guide')}
          <ExternalLink className="size-3" />
        </a>
      </p>
    </div>
  );
}
