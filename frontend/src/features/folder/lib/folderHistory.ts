import type { HistoryLocation, RegisteredRouter } from "@tanstack/react-router";
import { editorFolder, editorRequestAt } from "@/features/videoEditor/lib/editorLocation";

/**
 * The folder view's side of the router: which folder a history entry shows, and the key its
 * scroll offset is remembered under. Entries the folder view did not push, like the video
 * editor's, show the folder of what they open and carry the key of the entry they cover.
 */

// Random prefix plus a counter: `crypto.randomUUID` is absent over plain HTTP on a LAN address.
const ENTRY_KEY_PREFIX = `fs-${Math.random().toString(36).slice(2, 8)}`;
let entryKeyCounter = 0;

function mintEntryKey(): string {
  entryKeyCounter += 1;
  return `${ENTRY_KEY_PREFIX}-${entryKeyCounter}`;
}

export function folderOfLocation(
  router: RegisteredRouter,
  location: HistoryLocation = router.history.location,
): string | undefined {
  const search = router.options.parseSearch(location.search);
  const editor = editorRequestAt(location.pathname, search);
  if (editor) return editorFolder(editor);
  return typeof search.path === "string" && search.path ? search.path : undefined;
}

export function entryKeyOf(location: HistoryLocation): string | undefined {
  const key: unknown = location.state.entryKey;
  return typeof key === "string" ? key : undefined;
}

export type HistoryMode = "push" | "replace" | "swap" | "none";

/**
 * Records ``path`` as the folder shown and returns the entry's key. A replace keeps the entry's
 * key and, over the editor, its address: the editor's file names the folder there. A swap turns
 * the current entry, the editor's included, into a new folder entry with a key of its own.
 */
export function syncFolderHistory(
  router: RegisteredRouter,
  path: string | undefined,
  mode: HistoryMode,
): string | undefined {
  if (mode === "none") return undefined;
  const location = router.history.location;
  const search = path ? { path } : {};

  if (mode === "swap") {
    const entryKey = mintEntryKey();
    void router.navigate({
      to: "/",
      search,
      replace: true,
      ignoreBlocker: true,
      state: { entryKey },
    });
    return entryKey;
  }

  if (mode === "replace") {
    const entryKey = entryKeyOf(location) ?? mintEntryKey();
    if (!editorRequestAt(location.pathname, router.options.parseSearch(location.search))) {
      void router.navigate({ to: "/", search, replace: true, state: (s) => ({ ...s, entryKey }) });
    } else {
      router.history.replace(location.href, { ...location.state, entryKey });
    }
    return entryKey;
  }

  const entryKey = mintEntryKey();
  void router.navigate({ to: "/", search, state: { entryKey } });
  return entryKey;
}
