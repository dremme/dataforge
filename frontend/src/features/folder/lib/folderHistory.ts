const FOLDER_PARAM = "path";

/**
 * Identity for a single history entry, so scroll positions can be remembered per
 * visit rather than per folder — the same folder reached twice at different
 * offsets gets two entries, and Back returns to the right one.
 *
 * Random prefix plus a counter rather than `crypto.randomUUID`, which is absent
 * over plain HTTP on a LAN address.
 */
const ENTRY_KEY_PREFIX = `fs-${Math.random().toString(36).slice(2, 8)}`;
let entryKeyCounter = 0;

function mintEntryKey(): string {
  entryKeyCounter += 1;
  return `${ENTRY_KEY_PREFIX}-${entryKeyCounter}`;
}

interface FolderHistoryState {
  folderPath: string | null;
  entryKey: string;
}

function readEntryKey(state: unknown): string | undefined {
  const key = (state as FolderHistoryState | null)?.entryKey;
  return typeof key === "string" ? key : undefined;
}

export function getFolderFromUrl(): string | undefined {
  const value = new URL(window.location.href).searchParams.get(FOLDER_PARAM);
  return value ?? undefined;
}

function buildFolderUrl(path: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(FOLDER_PARAM, path);
  return url.pathname + url.search + url.hash;
}

function buildDefaultUrl(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(FOLDER_PARAM);
  return url.pathname + url.search + url.hash;
}

export type HistoryMode = "push" | "replace" | "none";

/** Returns the entry key now current, or undefined for mode "none". */
export function syncFolderHistory(path: string | undefined, mode: HistoryMode): string | undefined {
  if (mode === "none") return undefined;

  const url = path ? buildFolderUrl(path) : buildDefaultUrl();

  if (mode === "replace") {
    // A replace stays on the same entry, so it keeps that entry's key — only a
    // first write, where nothing has been stamped yet, needs a fresh one.
    const entryKey = readEntryKey(history.state) ?? mintEntryKey();
    history.replaceState({ folderPath: path ?? null, entryKey }, "", url);
    return entryKey;
  }

  const entryKey = mintEntryKey();
  history.pushState({ folderPath: path ?? null, entryKey }, "", url);
  return entryKey;
}

export function getCurrentEntryKey(): string | undefined {
  return readEntryKey(history.state);
}

export function getEntryKeyFromHistoryEvent(event: PopStateEvent): string | undefined {
  return readEntryKey(event.state);
}

export function getFolderFromHistoryEvent(event: PopStateEvent): string | undefined {
  const fromState = event.state?.folderPath;
  if (typeof fromState === "string") return fromState;
  if (fromState === null) return undefined;
  return getFolderFromUrl();
}
