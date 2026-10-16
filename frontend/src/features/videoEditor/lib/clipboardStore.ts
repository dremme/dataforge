import { useSyncExternalStore } from "react";
import type { ClipboardContent } from "./clipboard";

/**
 * Held for the whole session, outside any one editor, so clips copied in one project can be
 * pasted into another opened afterwards. Not the system clipboard: clips are not text.
 */
let held: ClipboardContent | null = null;
const listeners = new Set<() => void>();

export function setEditorClipboard(content: ClipboardContent | null): void {
  held = content;
  for (const listener of listeners) listener();
}

export function editorClipboard(): ClipboardContent | null {
  return held;
}

export function useEditorClipboard(): ClipboardContent | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => held,
  );
}
