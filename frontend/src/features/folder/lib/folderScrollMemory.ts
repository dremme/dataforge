/**
 * Scroll offsets of the folders behind us, keyed by history entry.
 *
 * Keyed by entry rather than by folder path so that visiting the same folder
 * twice at different offsets restores each visit correctly — going Back from a
 * second look at Home should return to where that second look left off, not to
 * where the first one did.
 *
 * Module-level singleton, matching `folderCache`; cleared on page reload, which
 * is why a `popstate` after a reload deliberately falls back to the top.
 */
const MAX_REMEMBERED_ENTRIES = 30;

const positions = new Map<string, number>();

export function rememberFolderScroll(entryKey: string | undefined, scrollTop: number): void {
  if (!entryKey) return;

  positions.delete(entryKey);
  positions.set(entryKey, scrollTop);

  while (positions.size > MAX_REMEMBERED_ENTRIES) {
    const oldest = positions.keys().next();
    if (oldest.done) break;
    positions.delete(oldest.value);
  }
}

export function recallFolderScroll(entryKey: string | undefined): number | undefined {
  if (!entryKey) return undefined;

  const hit = positions.get(entryKey);
  if (hit === undefined) return undefined;

  // Refresh recency so the entries being stepped through survive eviction.
  positions.delete(entryKey);
  positions.set(entryKey, hit);
  return hit;
}

/** Forget an entry whose folder changed underneath it. */
export function forgetFolderScroll(entryKey: string | undefined): void {
  if (!entryKey) return;
  positions.delete(entryKey);
}

export function clearFolderScrollMemory(): void {
  positions.clear();
}
