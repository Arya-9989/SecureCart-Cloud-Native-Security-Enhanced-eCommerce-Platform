import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * False while React hydrates prerendered HTML (and on the server), true afterwards. Lets a
 * component render exactly what the server rendered first, then switch to browser-only state
 * (saved theme, viewport) in the same commit, without a hydration mismatch.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
