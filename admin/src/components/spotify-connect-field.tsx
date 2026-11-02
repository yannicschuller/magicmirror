import { useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api';
import type { Values } from '@/lib/shared';
import { useStore } from '@/lib/store';

/**
 * Spotify sign-in without a public address: Spotify only redirects to https or 127.0.0.1,
 * so after signing in the browser shows an error page on 127.0.0.1 – its address holds the
 * code. The user pastes it here, the server exchanges it for a refresh token.
 */
export function SpotifyConnectField({ values, onSet }: { values: Values; onSet: (key: string, v: string) => void }) {
  const { t } = useStore();
  const [step, setStep] = useState<'idle' | 'paste'>('idle');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = !!values.spotifyRefreshToken;

  const start = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/spotify/start', { method: 'POST', body: { clientId: values.spotifyClientId } });
      window.open(url, '_blank', 'noopener');
      setStep('paste');
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setBusy(true);
    try {
      const { refreshToken } = await api<{ refreshToken: string }>('/spotify/finish', { method: 'POST', body: { url: pasted } });
      onSet('spotifyRefreshToken', refreshToken);
      setStep('idle');
      setPasted('');
      toast.success(t('Spotify connected – save to apply.'));
    } catch (err) {
      toast.error(t(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={start} disabled={busy || !values.spotifyClientId}>
          {busy && step === 'idle' ? <Loader2 className="animate-spin" /> : <ExternalLink />}
          {connected ? t('Connect again') : t('Connect with Spotify')}
        </Button>
        {connected && step === 'idle' && (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="size-4" /> {t('Connected')}
          </span>
        )}
      </div>
      {step === 'paste' && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            {t('After signing in, the browser shows an error page at 127.0.0.1 – that is expected. Copy the whole address from the address bar and paste it here:')}
          </p>
          <div className="flex gap-2">
            <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://127.0.0.1:8888/callback?code=…" className="font-mono text-[13px]" />
            <Button type="button" size="sm" onClick={finish} disabled={busy || !pasted.includes('code=')}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t('Done')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
