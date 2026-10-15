import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Children the element wrapped below its first line, which a fixed one-line height hides. */
function countWrapped(element: HTMLElement): number {
  const children = Array.from(element.children) as HTMLElement[];
  const firstTop = children[0]?.offsetTop ?? 0;
  return children.filter((child) => child.offsetTop > firstTop).length;
}

/**
 * How many children of a single-line wrapping row are out of sight, kept current as it resizes.
 * `contents` is what the row renders, so a new list is counted afresh. A "+N more" beside the
 * row narrows it and can wrap one more child; the recount settles on the next notification
 * instead of resizing the row inside this one.
 */
export function useWrappedCount(ref: RefObject<HTMLElement | null>, contents: unknown): number {
  const [wrapped, setWrapped] = useState(0);
  // Only real changes reach state: even a same-value update queues a render, and every gallery
  // card mounts this, where one extra render each is the whole visible grid repainting.
  const lastRef = useRef(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const count = () => {
      const next = countWrapped(element);
      if (next === lastRef.current) return;
      lastRef.current = next;
      setWrapped(next);
    };
    count();
    const observer = new ResizeObserver(count);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, contents]);

  return wrapped;
}
