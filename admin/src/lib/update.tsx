// Update state for the whole admin panel. The update itself runs in the updater container,
// so nothing here has to stay open: this only follows its progress (also for updates started
// by the schedule or the command line) and switches to the new version once it is running.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { Build } from '@/lib/shared';
import { useStore } from '@/lib/store';

export type UpdateChange = { sha: string; date: string; subject: string };
export type UpdateCheck = {
  ok: boolean;
  method?: 'git' | 'image';
  checkedAt: string;
  error?: string | null;
  available?: boolean;
  current?: { version: string; commit?: string };
  latest?: { version: string | null; commit?: string };
  changes?: UpdateChange[];
};
export type UpdateStatus = {
  available: boolean;
  version: string;
  build?: Build;
  state?: 'idle' | 'running' | 'done' | 'error';
  phase?: string;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  check?: UpdateCheck | null;
  log?: string[];
  mode?: 'pull' | 'build';
  schedule?: string;
};

export const UPDATE_PHASES = (mode?: string) => [
  { id: 'git', label: 'Fetching the latest version' },
  { id: mode === 'build' ? 'build' : 'pull', label: mode === 'build' ? 'Building images on this device' : 'Downloading new images' },
  { id: 'restart', label: 'Restarting the mirror' },
  { id: 'cleanup', label: 'Cleaning up' },
];

type UpdateCtx = {
  status: UpdateStatus | null;
  /** an update runs right now (here, by schedule or from the command line) */
  running: boolean;
  /** the server does not answer – it is being restarted */
  offline: boolean;
  /** the server runs a newer build than this page – reload to use it */
  newVersion: boolean;
  /** seconds since the current update started */
  elapsed: number;
  error: string | null;
  start: () => Promise<boolean>;
  load: () => Promise<void>;
  setCheck: (c: UpdateCheck) => void;
  /** the user dismissed the result of the last run */
  dismiss: () => void;
  /** result of the last run started or followed here, until dismissed */
  result: 'done' | 'error' | null;
};

const Ctx = createContext<UpdateCtx | null>(null);
export function useUpdate(): UpdateCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useUpdate outside provider');
  return c;
}

const buildKey = (s: UpdateStatus) => `${s.version}|${s.build?.commit ?? ''}|${s.build?.builtAt ?? ''}`;

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { t, dirty, saving } = useStore();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [offline, setOffline] = useState(false);
  const [newVersion, setNewVersion] = useState(false);
  const [result, setResult] = useState<'done' | 'error' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const baseline = useRef<string | null>(null); // build of the server this page was loaded from
  const prevRun = useRef<string | null | undefined>(undefined); // startedAt before "start" – ignore that run's result
  const startedAt = useRef<number>(0);
  const runningRef = useRef(false);
  runningRef.current = running;

  const apply = useCallback((s: UpdateStatus) => {
    setOffline(false);
    setError(null);
    if (baseline.current === null) baseline.current = buildKey(s);
    else if (buildKey(s) !== baseline.current) setNewVersion(true);
    // Until the updater reports the new run, the status still describes the previous one.
    const stale = prevRun.current !== undefined && s.state !== 'running' && (!s.startedAt || s.startedAt === prevRun.current);
    if (stale) {
      setStatus({ ...s, state: 'running', phase: 'start', error: null, log: [] });
      return;
    }
    setStatus(s);
    if (s.state === 'running') {
      if (!runningRef.current) startedAt.current = s.startedAt ? Date.parse(s.startedAt) : Date.now();
      setRunning(true);
      setResult(null);
    } else if (runningRef.current) {
      setRunning(false);
      prevRun.current = undefined;
      setResult(s.state === 'error' ? 'error' : 'done');
    }
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api<UpdateStatus>('/update'));
    } catch (err) {
      // While an update runs the server container is recreated – keep waiting.
      if (runningRef.current) setOffline(true);
      else setError(errorMessage(err));
    }
  }, [apply]);

  // Poll fast while an update runs, slowly otherwise (catches scheduled / command-line updates).
  useEffect(() => {
    load();
    const timer = setInterval(load, running ? 2000 : 60000);
    return () => clearInterval(timer);
  }, [load, running]);

  useEffect(() => {
    if (!running) return;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [running]);

  const start = useCallback(async () => {
    try {
      prevRun.current = status?.startedAt ?? null;
      startedAt.current = Date.now();
      await api('/update/run', { method: 'POST' });
      setRunning(true);
      setResult(null);
      setStatus((s) => (s ? { ...s, state: 'running', phase: 'start', error: null, log: [] } : s));
      return true;
    } catch (err) {
      prevRun.current = undefined;
      setError(errorMessage(err));
      return false;
    }
  }, [status]);

  // Switch to the new version by itself – but never throw away unsaved changes.
  useEffect(() => {
    if (!newVersion || running || offline || dirty || saving) return;
    toast.success(t('The new version is running – reloading …'));
    const timer = setTimeout(() => location.reload(), 2500);
    return () => clearTimeout(timer);
  }, [newVersion, running, offline, dirty, saving, t]);

  const value: UpdateCtx = {
    status,
    running,
    offline,
    newVersion,
    elapsed,
    error,
    start,
    load,
    setCheck: (c) => setStatus((s) => (s ? { ...s, check: c } : s)),
    dismiss: () => setResult(null),
    result,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
