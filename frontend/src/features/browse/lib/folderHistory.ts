const FOLDER_PARAM = "path";

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

export function syncFolderHistory(path: string | undefined, mode: HistoryMode): void {
  if (mode === "none") return;

  const url = path ? buildFolderUrl(path) : buildDefaultUrl();
  const state = { folderPath: path ?? null };

  if (mode === "replace") {
    history.replaceState(state, "", url);
  } else {
    history.pushState(state, "", url);
  }
}

export function getFolderFromHistoryEvent(event: PopStateEvent): string | undefined {
  const fromState = event.state?.folderPath;
  if (typeof fromState === "string") return fromState;
  if (fromState === null) return undefined;
  return getFolderFromUrl();
}
