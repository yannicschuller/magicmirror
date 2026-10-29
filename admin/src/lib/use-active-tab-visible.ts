import { useEffect, useRef } from 'react';

/** Keeps the active tab of a horizontally scrolling tab bar in view (phones). */
export function useActiveTabVisible<T extends HTMLElement>(active: string) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-state="active"]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return ref;
}
