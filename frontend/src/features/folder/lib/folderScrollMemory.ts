// Keyed by history entry, not folder path, so two visits to the same folder restore independently.
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

  positions.delete(entryKey);
  positions.set(entryKey, hit);
  return hit;
}

export function forgetFolderScroll(entryKey: string | undefined): void {
  if (!entryKey) return;
  positions.delete(entryKey);
}

export function clearFolderScrollMemory(): void {
  positions.clear();
}
