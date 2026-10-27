// Admin API helper: JSON in/out, 401 sends the browser back through the sign-in flow.
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: opts.method,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
  if (res.status === 401) {
    location.href = '/admin/';
    throw new Error('Not signed in');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// Stable React keys for plain objects that have no id (list items).
const keys = new WeakMap<object, string>();
let next = 0;
export function keyOf(o: object): string {
  let k = keys.get(o);
  if (!k) keys.set(o, (k = `k${++next}`));
  return k;
}
