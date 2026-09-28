import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "./storage";

export interface StoredStore<T> {
  get: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

/** A value mirrored to localStorage; other tabs follow it through the `storage` event. */
export function createStoredStore<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string = String,
): StoredStore<T> {
  let value = parse(readStored(key));
  const listeners = new Set<() => void>();

  const adopt = (next: T) => {
    if (Object.is(next, value)) return false;
    value = next;
    for (const listener of listeners) listener();
    return true;
  };

  window.addEventListener("storage", (event) => {
    if (event.key === key) adopt(parse(event.newValue));
  });

  return {
    get: () => value,
    set: (next) => {
      if (adopt(next)) writeStored(key, serialize(next));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStoredStore<T>(store: StoredStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
