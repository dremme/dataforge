import { useEffect, useState, type RefObject } from "react";
import { containedBox } from "@/features/gallery/lib/crop";

export interface PaintedBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EMPTY_BOX: PaintedBox = { left: 0, top: 0, width: 0, height: 0 };

/** Where the frame paints inside an `object-fit: contain` element, in offset-parent coords. */
export function usePaintedBox<T extends HTMLElement>(
  mediaRef: RefObject<T | null>,
  sourceWidth: number,
  sourceHeight: number,
): PaintedBox {
  const [box, setBox] = useState(EMPTY_BOX);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const measure = () => {
      // containedBox is in media coords; add offsetLeft/Top so padding does not shift the rect.
      // Layout offsets, not getBoundingClientRect: a rect is transformed and would apply it twice.
      if (!media.offsetParent) {
        setBox(EMPTY_BOX);
        return;
      }

      const painted = containedBox(
        media.offsetWidth,
        media.offsetHeight,
        sourceWidth,
        sourceHeight,
      );

      setBox({
        left: media.offsetLeft + painted.left,
        top: media.offsetTop + painted.top,
        width: painted.width,
        height: painted.height,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(media);
    // Host too: a taller stage re-centres max-height-clamped media without resizing it.
    observer.observe(media.offsetParent ?? media);
    return () => observer.disconnect();
  }, [sourceHeight, sourceWidth, mediaRef]);

  return box;
}
