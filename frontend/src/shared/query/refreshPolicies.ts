/** Preferences are re-read on a stale mount, rather than on every reader or window focus. */
const PREFERENCE_STALE_MS = 60_000;

/**
 * Options for a preference mirrored in local storage. The mirror seeds the cache, so the last
 * known value paints at once and survives an unreachable backend; the seed counts as stale, so
 * the server's copy is read right after and then shared between readers for a minute.
 */
export function mirroredPreference<T>(readMirror: () => T) {
  return {
    initialData: readMirror,
    initialDataUpdatedAt: 0,
    staleTime: PREFERENCE_STALE_MS,
    refetchOnWindowFocus: false,
  } as const;
}
