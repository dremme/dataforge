import { useCallback, useRef, type CSSProperties, type PointerEvent, type RefObject } from "react";
import {
  CROP_HANDLES,
  CROP_NUDGE_FRACTION,
  CROP_NUDGE_MULTIPLIER,
  UPRIGHT,
  isCornerHandle,
  moveCrop,
  resizeCrop,
  screenDeltaToSource,
  type CropHandle,
  type CropRect,
  type Orientation,
} from "@/features/gallery/lib/crop";
import { usePaintedBox } from "@/features/gallery/hooks/usePaintedBox";
import { classNames } from "@/shared/lib/classNames";

const HANDLE_LABELS: Record<CropHandle, string> = {
  nw: "Crop top-left corner",
  n: "Crop top edge",
  ne: "Crop top-right corner",
  e: "Crop right edge",
  se: "Crop bottom-right corner",
  s: "Crop bottom edge",
  sw: "Crop bottom-left corner",
  w: "Crop left edge",
};

interface CropOverlayProps {
  mediaRef: RefObject<HTMLElement | null>;
  crop: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  /** Width over height for the locked shape, or null while the rect is free. */
  aspectRatio: number | null;
  disabled: boolean;
  /** Preview turn when the host shares the picture's transform. Video never sets it. */
  orientation?: Orientation;
  /** Fraction-to-pixel rounding. Default matches Pillow; video needs `evenTrunc` for yuv420p. */
  round?: (value: number) => number;
  onCropChange: (crop: CropRect) => void;
}

export function CropOverlay({
  mediaRef,
  crop,
  sourceWidth,
  sourceHeight,
  aspectRatio,
  disabled,
  orientation = UPRIGHT,
  round = Math.round,
  onCropChange,
}: CropOverlayProps) {
  const box = usePaintedBox(mediaRef, sourceWidth, sourceHeight);
  // Anchored to where the drag began: pointer moves outrun rendering, so a delta applied to the
  // last rendered rect loses every move that landed inside the same frame.
  const dragRef = useRef<{ x: number; y: number; rect: CropRect } | null>(null);
  const cropRef = useRef(crop);
  cropRef.current = crop;

  // Aspect is in source pixels; this rect is fractions, so divide by the frame's aspect first.
  const rectRatio =
    aspectRatio !== null && sourceWidth > 0 && sourceHeight > 0
      ? aspectRatio / (sourceWidth / sourceHeight)
      : null;

  const fractionDelta = useCallback(
    (screenDx: number, screenDy: number) => {
      const { dx, dy } = screenDeltaToSource(screenDx, screenDy, orientation);
      return {
        dx: box.width > 0 ? dx / box.width : 0,
        dy: box.height > 0 ? dy / box.height : 0,
      };
    },
    [box.height, box.width, orientation],
  );

  const startDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (disabled) return;
      // preventDefault drops the click's focus; take it or unfocused arrows navigate the gallery.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, rect: cropRef.current };
    },
    [disabled],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }, []);

  const dragHandle = useCallback(
    (handle: CropHandle) => (event: PointerEvent<HTMLButtonElement>) => {
      const origin = dragRef.current;
      if (disabled || !origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

      const { dx, dy } = fractionDelta(event.clientX - origin.x, event.clientY - origin.y);
      onCropChange(resizeCrop(origin.rect, handle, dx, dy, rectRatio));
    },
    [disabled, fractionDelta, onCropChange, rectRatio],
  );

  const dragRect = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const origin = dragRef.current;
      if (disabled || !origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

      const { dx, dy } = fractionDelta(event.clientX - origin.x, event.clientY - origin.y);
      onCropChange(moveCrop(origin.rect, dx, dy));
    },
    [disabled, fractionDelta, onCropChange],
  );

  const nudge = useCallback(
    (handle: CropHandle) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const step = CROP_NUDGE_FRACTION * (event.shiftKey ? CROP_NUDGE_MULTIPLIER : 1);
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (!move) return;

      event.preventDefault();
      // Arrow keys point at the screen; under a quarter-turn the screen's right is not the frame's.
      const { dx, dy } = screenDeltaToSource(move[0], move[1], orientation);
      onCropChange(resizeCrop(crop, handle, dx, dy, rectRatio));
    },
    [crop, disabled, onCropChange, orientation, rectRatio],
  );

  if (box.width <= 0 || box.height <= 0) return null;

  const pixels = {
    width: round(sourceWidth * crop.width),
    height: round(sourceHeight * crop.height),
  };
  const style = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    "--crop-x": `${crop.x * 100}%`,
    "--crop-y": `${crop.y * 100}%`,
    "--crop-w": `${crop.width * 100}%`,
    "--crop-h": `${crop.height * 100}%`,
    // Inverse of the host transform so the readout stays upright.
    "--crop-readout-transform":
      `rotate(${-orientation.rotate}deg)` +
      ` scaleX(${orientation.mirrorH ? -1 : 1}) scaleY(${orientation.mirrorV ? -1 : 1})`,
  } as CSSProperties;

  return (
    <div className="crop-overlay" style={style} role="group" aria-label="Crop region">
      <div className="crop-overlay__scrim crop-overlay__scrim--top" />
      <div className="crop-overlay__scrim crop-overlay__scrim--bottom" />
      <div className="crop-overlay__scrim crop-overlay__scrim--left" />
      <div className="crop-overlay__scrim crop-overlay__scrim--right" />

      <div
        className="crop-overlay__rect"
        onPointerDown={startDrag}
        onPointerMove={dragRect}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="crop-overlay__readout">
          {pixels.width} × {pixels.height}
        </span>
        {CROP_HANDLES.map((handle) => (
          <button
            key={handle}
            type="button"
            className={classNames("crop-overlay__handle", `crop-overlay__handle--${handle}`)}
            aria-label={HANDLE_LABELS[handle]}
            // Under a ratio only corners preserve it; an edge drag has no second axis.
            disabled={disabled || (aspectRatio !== null && !isCornerHandle(handle))}
            onPointerDown={startDrag}
            onPointerMove={dragHandle(handle)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={nudge(handle)}
          />
        ))}
      </div>
    </div>
  );
}
