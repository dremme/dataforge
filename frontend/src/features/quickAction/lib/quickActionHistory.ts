import { readStoredJson, writeStoredJson } from "@/shared/lib/storage";

const RECENT_ACTIONS_KEY = "quick-action-recent";

export const MAX_RECENT_ACTIONS = 8;

function dedupeActionIds(ids: string[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    deduped.push(trimmed);
  }

  return deduped;
}

export function readRecentActionIds(): string[] {
  const stored = readStoredJson<string[]>(
    RECENT_ACTIONS_KEY,
    (parsed) =>
      Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : null,
    [],
  );

  return dedupeActionIds(stored).slice(0, MAX_RECENT_ACTIONS);
}

export function touchRecentAction(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) return;

  const next = dedupeActionIds([trimmed, ...readRecentActionIds()]).slice(0, MAX_RECENT_ACTIONS);
  writeStoredJson(RECENT_ACTIONS_KEY, next);
}

export function clearRecentActionsForTests(): void {
  writeStoredJson(RECENT_ACTIONS_KEY, []);
}
