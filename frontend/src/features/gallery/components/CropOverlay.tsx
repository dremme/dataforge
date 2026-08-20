import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  CROP_HANDLES,
  CROP_NUDGE_FRACTION,
  CROP_NUDGE_MULTIPLIER,
  UPRIGHT,
  containedBox,
  isCornerHandle,
  moveCrop,
  resizeCrop,
  screenDeltaToSource,
  type CropHandle,
  type CropRect,
  type Orientation,
} from "@/features/gallery/lib/crop";
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

interface CropOverlayProps {
  /** The element the frame is painted into, so the overlay can find the picture in it. */
  mediaRef: RefObject<HTMLElement | null>;
  crop: CropRect;
  sourceWidth: number;
  sourceHeight: number;
  /** Width over height for the locked shape, or null while the rect is free. */
  aspectRatio: number | null;
  disabled: boolean;
  /**
   * How the preview is turned, when the host renders this inside the same transform the
   * picture carries. Video never sets it; the image editor rotates and mirrors in place.
   */
  orientation?: Orientation;
  /**
   * How the readout turns fractions into pixels. The default rounds, which is what Pillow
   * is asked for; the video editor passes `evenTrunc`, because `yuv420p` cannot express an
   * odd dimension and a readout that disagreed with the render would quietly lie.
   */
  round?: (value: number) => number;
  onCropChange: (crop: CropRect) => void;
}

/**
 * The crop rectangle, drawn on the frame rather than beside it.
 *
 * Everything here works in fractions of the source and is positioned against the box the
 * media actually paints: `object-fit: contain` letterboxes the picture inside the
 * element, so a rect laid over the element would sit off by exactly the bars.
 *
 * When the host has turned the preview, this rides inside that transform - so the browser
 * puts the rectangle on the pixels the user sees for free, and the only thing left to
 * undo is the direction a drag reads in. That is `screenDeltaToSource`. The handles keep
 * their source-relative names, which is why the top-left one appears elsewhere under a
 * quarter turn: naming them by where they land would make the labels disagree with the
 * numbers they change.
 */
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
  const [box, setBox] = useState(EMPTY_BOX);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // The painted box moves with the window, the panel and the media's own metadata, so it
  // is measured rather than derived once.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;

    const measure = () => {
      // `containedBox` answers in the media element's own coordinates, but this overlay
      // is absolutely positioned against its host, which pads the media in and centres
      // it. Without the element's own offset inside that box the whole rectangle lands
      // up and to the left by exactly the padding.
      //
      // Layout offsets rather than `getBoundingClientRect`, for two reasons: `offsetLeft`
      // is already measured from `offsetParent`'s padding box, which is the very box an
      // absolutely positioned sibling is placed against, and offsets are untransformed.
      // A rect is not - it comes back scaled and turned by any ancestor transform, and
      // writing that straight into `left`/`width` would apply it a second time. The modal
      // panel really does carry one while its entrance animation runs, and the image
      // editor's stage carries one for as long as the preview is rotated.
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
    // The host too: a stage that grows taller re-centres media already clamped by
    // `max-height`, moving it without ever resizing it.
    observer.observe(media.offsetParent ?? media);
    return () => observer.disconnect();
  }, [sourceHeight, sourceWidth, mediaRef]);

  // Aspect is a ratio of real pixels; this rectangle is in fractions of the frame, so the
  // frame's own aspect divides out before the two can be compared.
  const rectRatio =
    aspectRatio !== null && sourceWidth > 0 && sourceHeight > 0
      ? aspectRatio / (sourceWidth / sourceHeight)
      : null;

  // Un-turned in pixels, before the division: `box` is the untransformed layout box, so
  // its width already corresponds to the source's width whichever way the preview faces.
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
      // Through the same mapping as a drag: the arrow keys point at the screen, and under
      // a quarter turn the screen's right is not the frame's.
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
    // The readout rides the host's transform with everything else, so it carries the
    // inverse and stays upright. Each mirror is its own inverse, hence the same signs.
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
          {pixels.width} x {pixels.height}
        </span>
        {CROP_HANDLES.map((handle) => (
          <button
            key={handle}
            type="button"
            className={classNames("crop-overlay__handle", `crop-overlay__handle--${handle}`)}
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
