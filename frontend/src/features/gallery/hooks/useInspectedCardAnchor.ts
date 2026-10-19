import { useLayoutEffect, useRef } from "react";

interface Anchor {
  path: string;
  top: number;
  layoutKey: string;
}

function scrollBy(element: HTMLElement, delta: number): void {
  element.scrollTop += delta;
}

/**
 * Keeps the inspected card where it sat on screen when the gallery reflows, such as the docked
 * inspector narrowing it, by scrolling as far as the card moved. Scrolling happens before paint.
 *
 * `topOf` returns a card's offset in the scroller's content, or null when there is none; it is
 * read after commit so a virtualizer can report its latest measurements. Only a `layoutKey`
 * change moves the scroll, so new items or paging to another card never do.
 */
export function useInspectedCardAnchor(
  scrollElement: HTMLElement | null,
  inspectedPath: string | null | undefined,
  layoutKey: string,
  topOf: (path: string) => number | null,
): void {
  const anchorRef = useRef<Anchor | null>(null);

  // Runs after every commit: the card's top can change without any argument changing.
  useLayoutEffect(() => {
    const previous = anchorRef.current;
    // Closing the inspector clears the path a commit before the gallery widens, so the last
    // inspected card stays the anchor through the next reflow.
    const path = inspectedPath || previous?.path;
    const top = path ? topOf(path) : null;
    const reflowed = previous !== null && previous.layoutKey !== layoutKey;
    anchorRef.current =
      path && top !== null && (inspectedPath || !reflowed) ? { path, top, layoutKey } : null;

    if (!scrollElement || !previous || !reflowed || top === null) return;
    if (previous.path !== path) return;
    if (top !== previous.top) scrollBy(scrollElement, top - previous.top);
  });
}
