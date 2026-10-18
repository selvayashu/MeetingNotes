import { useSyncExternalStore } from 'react';

// In-memory progress (0..1) of long-running steps per meeting; not persisted.
const progress = new Map<string, number>();
const listeners = new Set<() => void>();

export function setProgress(id: string, value: number | undefined): void {
  if (value === undefined) progress.delete(id);
  else progress.set(id, value);
  listeners.forEach((l) => l());
}

export function useProgress(id: string | undefined): number | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (id ? progress.get(id) : undefined),
  );
}
