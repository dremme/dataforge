import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  CROP_HANDLES,
  CROP_NUDGE_FRACTION,
  CROP_NUDGE_MULTIPLIER,
  containedVideoBox,
  cropToPixels,
  isCornerHandle,
  moveCrop,
  resizeCrop,
  type CropHandle,
  type CropRect,
} from "@/features/gallery/lib/videoEdit";
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

const EMPTY_BOX = { left: 0, top: 0, width: 0, height: 0 };

interface VideoCropOverlayProps {
  /** The element the frame is painted into, so the overlay can find the picture in it. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  crop: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  /** Width over height for the locked shape, or null while the rect is free. */
  aspectRatio: number | null;
  disabled: boolean;
  onCropChange: (crop: CropRect) => void;
}

/**
 * The crop rectangle, drawn on the frame rather than beside it.
 *
 * Everything here works in fractions of the source and is positioned against the box the
 * video actually paints: `object-fit: contain` letterboxes the picture inside the
 * element, so a rect laid over the element would sit off by exactly the bars.
 */
export function VideoCropOverlay({
  videoRef,
  crop,
  sourceWidth,
  sourceHeight,
  aspectRatio,
  disabled,
  onCropChange,
}: VideoCropOverlayProps) {
  const [box, setBox] = useState(EMPTY_BOX);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // The painted box moves with the window, the panel and the video's own metadata, so it
  // is measured rather than derived once.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const measure = () => {
      // `containedVideoBox` answers in the video element's own coordinates, but this
      // overlay is absolutely positioned against the stage, which pads the video in and
      // centres it. Without the element's own offset inside that box the whole rectangle
      // lands up and to the left by exactly the padding.
      //
      // Layout offsets rather than `getBoundingClientRect`, for two reasons: `offsetLeft`
      // is already measured from `offsetParent`'s padding box, which is the very box an
      // absolutely positioned sibling is placed against, and offsets are untransformed.
      // A rect is not - it comes back scaled by any ancestor transform, and writing that
      // straight into `left`/`width` would scale it a second time. The modal panel really
      // does carry one while its entrance animation runs.
      if (!video.offsetParent) {
        setBox(EMPTY_BOX);
        return;
      }

      const painted = containedVideoBox(
        video.offsetWidth,
        video.offsetHeight,
        sourceWidth,
        sourceHeight,
      );

      setBox({
        left: video.offsetLeft + painted.left,
        top: video.offsetTop + painted.top,
        width: painted.width,
        height: painted.height,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    // The host too: a stage that grows taller re-centres a video already clamped by
    // `max-height`, moving it without ever resizing it.
    observer.observe(video.offsetParent ?? video);
    return () => observer.disconnect();
  }, [sourceHeight, sourceWidth, videoRef]);

  // Aspect is a ratio of real pixels; this rectangle is in fractions of the frame, so the
  // frame's own aspect divides out before the two can be compared.
  const rectRatio =
    aspectRatio !== null && sourceWidth > 0 && sourceHeight > 0
      ? aspectRatio / (sourceWidth / sourceHeight)
      : null;

  const fractionDelta = useCallback(
    (dx: number, dy: number) => ({
      dx: box.width > 0 ? dx / box.width : 0,
      dy: box.height > 0 ? dy / box.height : 0,
    }),
    [box.height, box.width],
  );

  const startDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (disabled) return;
      // `preventDefault` suppresses the click's own focus along with the drag-select it
      // is there to stop, so focus is taken by hand: a handle only answers the arrow
      // keys once it holds it, and unfocused arrows navigate the gallery instead.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY };
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
      dragRef.current = { x: event.clientX, y: event.clientY };
      onCropChange(resizeCrop(crop, handle, dx, dy, rectRatio));
    },
    [crop, disabled, fractionDelta, onCropChange, rectRatio],
  );

  const dragRect = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const origin = dragRef.current;
      if (disabled || !origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

      const { dx, dy } = fractionDelta(event.clientX - origin.x, event.clientY - origin.y);
      dragRef.current = { x: event.clientX, y: event.clientY };
      onCropChange(moveCrop(crop, dx, dy));
    },
    [crop, disabled, fractionDelta, onCropChange],
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
      onCropChange(resizeCrop(crop, handle, move[0], move[1], rectRatio));
    },
    [crop, disabled, onCropChange, rectRatio],
  );

  if (box.width <= 0 || box.height <= 0) return null;

  const pixels = cropToPixels(crop, { width: sourceWidth, height: sourceHeight });
  const style = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    "--crop-x": `${crop.x * 100}%`,
    "--crop-y": `${crop.y * 100}%`,
    "--crop-w": `${crop.width * 100}%`,
    "--crop-h": `${crop.height * 100}%`,
  } as CSSProperties;

  return (
    <div className="video-crop-overlay" style={style} role="group" aria-label="Crop region">
      <div className="video-crop-overlay__scrim video-crop-overlay__scrim--top" />
      <div className="video-crop-overlay__scrim video-crop-overlay__scrim--bottom" />
      <div className="video-crop-overlay__scrim video-crop-overlay__scrim--left" />
      <div className="video-crop-overlay__scrim video-crop-overlay__scrim--right" />

      <div
        className="video-crop-overlay__rect"
        onPointerDown={startDrag}
        onPointerMove={dragRect}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="video-crop-overlay__readout">
          {pixels.width} x {pixels.height}
        </span>
        {CROP_HANDLES.map((handle) => (
          <button
            key={handle}
            type="button"
            className={classNames(
              "video-crop-overlay__handle",
              `video-crop-overlay__handle--${handle}`,
            )}
            aria-label={HANDLE_LABELS[handle]}
            // An edge drag has no second axis to derive the locked dimension from, so
            // under a ratio only the corners can preserve it without guessing.
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
