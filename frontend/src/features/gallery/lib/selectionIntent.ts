export type SelectionIntent = "open" | "toggle" | "range";

interface ClickModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function selectionIntentFor(event: ClickModifiers, selectionMode: boolean): SelectionIntent {
  // Shift wins, so Ctrl+Shift+click still extends rather than toggling one item.
  if (event.shiftKey) return "range";
  // metaKey on macOS, where Ctrl+click is the context menu.
  if (event.ctrlKey || event.metaKey) return "toggle";
  return selectionMode ? "toggle" : "open";
}

/** Falls back to the clicked path when the anchor is gone: narrowing never clears one. */
export function pathRangeBetween(
  ordered: readonly string[],
  anchor: string | null,
  target: string,
): string[] {
  const targetIndex = ordered.indexOf(target);
  if (targetIndex === -1) return [target];

  const anchorIndex = anchor === null ? -1 : ordered.indexOf(anchor);
  if (anchorIndex === -1) return [target];

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ordered.slice(start, end + 1);
}
