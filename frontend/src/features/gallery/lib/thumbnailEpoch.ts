import { createStoredStore, useStoredStore } from "@/shared/lib/storedStore";

const epoch = createStoredStore("thumbnail-epoch", (raw) => {
  const stored = Number(raw);
  return Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
});

export const getThumbnailEpoch = epoch.get;

/** Thumbnails are cached as immutable, so only a changed URL makes the browser fetch one again. */
export function advanceThumbnailEpoch(): void {
  epoch.set(epoch.get() + 1);
}

export function useThumbnailEpoch(): number {
  return useStoredStore(epoch);
}
