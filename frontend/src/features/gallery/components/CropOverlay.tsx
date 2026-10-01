import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import { exactAspectRatioLabel } from "@/features/gallery/lib/aspectRatio";
import {
  CROP_HANDLE_NAMES,
  CROP_HANDLES,
  CROP_READOUT_LINGER_MS,
  UPRIGHT,
  isCornerHandle,
  moveCrop,
  readoutTransform,
  resizeCrop,
  type CropHandle,
  type CropRect,
  type Orientation,
} from "@/features/gallery/lib/crop";
import { usePaintedBox } from "@/features/gallery/hooks/usePaintedBox";
import { arrowDelta, useRectDrag } from "@/features/gallery/hooks/useRectDrag";
import { classNames } from "@/shared/lib/classNames";

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
  const drag = useRectDrag(box, orientation, disabled);
  const cropRef = useRef(crop);
  cropRef.current = crop;
  // The size readout only shows while a handle is resizing the rect.
  const [resizing, setResizing] = useState(false);
  const lingerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(lingerRef.current), []);

  const hideReadout = useCallback(() => {
    window.clearTimeout(lingerRef.current);
    setResizing(false);
  }, []);

  // Aspect is in source pixels; this rect is fractions, so divide by the frame's aspect first.
  const rectRatio =
    aspectRatio !== null && sourceWidth > 0 && sourceHeight > 0
      ? aspectRatio / (sourceWidth / sourceHeight)
      : null;

  const startDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => drag.begin(event, cropRef.current),
    [drag],
  );

  const startResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!drag.begin(event, cropRef.current)) return;
      window.clearTimeout(lingerRef.current);
      setResizing(true);
    },
    [drag],
  );

  const endResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      drag.end(event);
      hideReadout();
    },
    [drag, hideReadout],
  );

  const dragHandle = useCallback(
    (handle: CropHandle) => (event: PointerEvent<HTMLButtonElement>) => {
      const move = drag.delta(event);
      if (move) onCropChange(resizeCrop(move.rect, handle, move.dx, move.dy, rectRatio));
    },
    [drag, onCropChange, rectRatio],
  );

  const dragRect = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const move = drag.delta(event);
      if (move) onCropChange(moveCrop(move.rect, move.dx, move.dy));
    },
    [drag, onCropChange],
  );

  const nudge = useCallback(
    (handle: CropHandle) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;
      const delta = arrowDelta(event, orientation);
      if (!delta) return;

      event.preventDefault();
      onCropChange(resizeCrop(crop, handle, delta.dx, delta.dy, rectRatio));
      // A nudge has no release to hide on, so the readout lingers briefly instead.
      setResizing(true);
      window.clearTimeout(lingerRef.current);
      lingerRef.current = window.setTimeout(() => setResizing(false), CROP_READOUT_LINGER_MS);
    },
    [crop, disabled, onCropChange, orientation, rectRatio],
  );

  if (box.width <= 0 || box.height <= 0) return null;

  const sourcePixels = {
    width: round(sourceWidth * crop.width),
    height: round(sourceHeight * crop.height),
  };
  const pixels =
    orientation.rotate === 90 || orientation.rotate === 270
      ? { width: sourcePixels.height, height: sourcePixels.width }
      : sourcePixels;
  const ratioLabel =
    aspectRatio === null ? exactAspectRatioLabel(pixels.width, pixels.height) : null;
  const style = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    "--crop-x": `${crop.x * 100}%`,
    "--crop-y": `${crop.y * 100}%`,
    "--crop-w": `${crop.width * 100}%`,
    "--crop-h": `${crop.height * 100}%`,
    // Undoes the host turn and pins the readout to the middle of the rect's on-screen top edge.
    "--crop-readout-transform": readoutTransform(
      orientation,
      box.width * crop.width,
      box.height * crop.height,
      "top-center",
    ),
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
        onPointerUp={drag.end}
        onPointerCancel={drag.end}
      >
        <span
          className={classNames(
            "crop-overlay__readout",
            resizing && "crop-overlay__readout--visible",
          )}
        >
          <span className="crop-overlay__size">
            {pixels.width} × {pixels.height}
          </span>
          {ratioLabel && (
            <>
              <span className="crop-overlay__separator"> · </span>
              <span className="crop-overlay__ratio">{ratioLabel}</span>
            </>
          )}
        </span>
        {CROP_HANDLES.map((handle) => (
          <button
            key={handle}
            type="button"
            className={classNames("crop-overlay__handle", `crop-overlay__handle--${handle}`)}
            aria-label={`Crop ${CROP_HANDLE_NAMES[handle]}`}
            // Under a ratio only corners preserve it; an edge drag has no second axis.
            disabled={disabled || (aspectRatio !== null && !isCornerHandle(handle))}
            onPointerDown={startResize}
            onPointerMove={dragHandle(handle)}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={nudge(handle)}
            onBlur={hideReadout}
          />
        ))}
      </div>
    </div>
  );
}
