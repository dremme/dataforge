type StorageKind = "local" | "session";

function storageFor(kind: StorageKind): Storage | null {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

export function readStored(key: string, kind: StorageKind = "local"): string | null {
  try {
    return storageFor(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string, kind: StorageKind = "local"): void {
  try {
    storageFor(kind)?.setItem(key, value);
  } catch {
    // Storage is unavailable or full; the value is a cache, so dropping it is safe.
  }
}

export function readStoredJson<T>(
  key: string,
  parse: (value: unknown) => T | null,
  fallback: T,
  kind: StorageKind = "local",
): T {
  const raw = readStored(key, kind);
  if (raw === null) return fallback;

  try {
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredJson(key: string, value: unknown, kind: StorageKind = "local"): void {
  writeStored(key, JSON.stringify(value), kind);
}
