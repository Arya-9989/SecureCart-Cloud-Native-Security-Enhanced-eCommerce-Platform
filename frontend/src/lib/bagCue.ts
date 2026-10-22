/*
 * A one-line event bus between "something was added to the bag" (useAddToCart) and the bag
 * icon in the global nav, which acknowledges it. Module-level, like the toast queue.
 */
const listeners = new Set<() => void>();

export function announceBagAdd(): void {
  listeners.forEach((listener) => {
    listener();
  });
}

export function onBagAdd(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
