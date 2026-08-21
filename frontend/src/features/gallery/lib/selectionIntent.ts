/** What a click on a card or row means, once its modifier keys are read. */
export type SelectionIntent = "open" | "toggle" | "range";

interface ClickModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * Ctrl/Cmd+click selects the item without opening it; Shift+click extends the
 * selection to it. Both work outside selection mode, which is how the gallery is
 * entered into it — the same gesture Explorer and Finder use.
 */
export function selectionIntentFor(event: ClickModifiers, selectionMode: boolean): SelectionIntent {
  // Shift wins, so Ctrl+Shift+click still extends rather than toggling one item.
  if (event.shiftKey) return "range";
  // `metaKey` carries this on macOS, where Ctrl+click is the context menu.
  if (event.ctrlKey || event.metaKey) return "toggle";
  return selectionMode ? "toggle" : "open";
}

/**
 * The run of `ordered` between the anchor and the clicked path, inclusive, in
 * whichever direction they sit.
 *
 * Falls back to the clicked path alone when there is no usable anchor: the first
 * Shift+click of a session, or an anchor the current filters have since hidden —
 * a selection is never cleared by narrowing the view, so the anchor can outlive
 * its own visibility.
 */
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
