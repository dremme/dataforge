import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  CROP_NUDGE_FRACTION,
  CROP_NUDGE_MULTIPLIER,
  screenDeltaToSource,
  type CropRect,
  type Orientation,
} from "@/features/gallery/lib/crop";
import type { PaintedBox } from "@/features/gallery/hooks/usePaintedBox";

const ARROW_MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Arrow keys point at the screen; under a quarter-turn the screen's right is not the frame's. */
export function arrowDelta(
  event: KeyboardEvent<HTMLElement>,
  orientation: Orientation,
): { dx: number; dy: number } | null {
  const move = ARROW_MOVES[event.key];
  if (!move) return null;

  const step = CROP_NUDGE_FRACTION * (event.shiftKey ? CROP_NUDGE_MULTIPLIER : 1);
  return screenDeltaToSource(move[0] * step, move[1] * step, orientation);
}

/** Pointer drags over a rect drawn in fractions of the painted `box`. */
export function useRectDrag(box: PaintedBox, orientation: Orientation, disabled: boolean) {
  // Anchored to where the drag began: pointer moves outrun rendering, so a delta applied to the
  // last rendered rect loses every move that landed inside the same frame.
  const dragRef = useRef<{ x: number; y: number; rect: CropRect } | null>(null);

  /** Returns false when disabled, so the caller can skip its own side effects. */
  const begin = useCallback(
    (event: PointerEvent<HTMLElement>, rect: CropRect) => {
      if (disabled) return false;
      // preventDefault drops the click's focus; take it or unfocused arrows navigate the gallery.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, rect };
      return true;
    },
    [disabled],
  );

  const end = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }, []);

  /** The rect the drag began on and the move since, in fractions; null outside a live drag. */
  const delta = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const origin = dragRef.current;
      if (disabled || !origin || !event.currentTarget.hasPointerCapture(event.pointerId)) {
        return null;
      }
      const { dx, dy } = screenDeltaToSource(
        event.clientX - origin.x,
        event.clientY - origin.y,
        orientation,
      );
      return {
        rect: origin.rect,
        dx: box.width > 0 ? dx / box.width : 0,
        dy: box.height > 0 ? dy / box.height : 0,
      };
    },
    [box.height, box.width, disabled, orientation],
  );

  return useMemo(() => ({ begin, end, delta }), [begin, end, delta]);
}
