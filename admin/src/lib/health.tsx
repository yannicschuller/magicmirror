// Modules whose data fetches keep failing (or partly fail) – reported by the server.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

export type HealthIssue = { id: string; type: string; title: string; kind: 'error' | 'partial'; since: string; error: string; lastOk: string | null };

const Ctx = createContext<HealthIssue[]>([]);
export const useHealth = () => useContext(Ctx);

export function HealthProvider({ children }: { children: ReactNode }) {
  const [issues, setIssues] = useState<HealthIssue[]>([]);
  const load = useCallback(() => api<HealthIssue[]>('/health').then(setIssues).catch(() => {}), []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);
  return <Ctx.Provider value={issues}>{children}</Ctx.Provider>;
}
