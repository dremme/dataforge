import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  CROP_HANDLES,
  CROP_NUDGE_FRACTION,
  CROP_NUDGE_MULTIPLIER,
  MIN_MASK_FRACTION,
  UPRIGHT,
  moveCrop,
  resizeCrop,
  screenDeltaToSource,
  type CropHandle,
  type CropRect,
  type Orientation,
  type Size,
} from "@/features/gallery/lib/crop";
import { blurRadiusPx, modeLabel, pixelBlockPx, type MaskDraft } from "@/features/gallery/lib/mask";
import { usePaintedBox, type PaintedBox } from "@/features/gallery/hooks/usePaintedBox";
import { iconX } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

const HANDLE_LABELS: Record<CropHandle, string> = {
  nw: "top-left corner",
  n: "top edge",
  ne: "top-right corner",
  e: "right edge",
  se: "bottom-right corner",
  s: "bottom edge",
  sw: "bottom-left corner",
  w: "left edge",
};

const ARROW_MOVES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Arrow keys point at the screen; under a quarter-turn the screen's right is not the frame's. */
function arrowDelta(
  event: KeyboardEvent<HTMLElement>,
  orientation: Orientation,
): { dx: number; dy: number } | null {
  const move = ARROW_MOVES[event.key];
  if (!move) return null;

  const step = CROP_NUDGE_FRACTION * (event.shiftKey ? CROP_NUDGE_MULTIPLIER : 1);
  return screenDeltaToSource(move[0] * step, move[1] * step, orientation);
}

type MaskMedia = HTMLImageElement | HTMLVideoElement;

type Painter = () => void;

function mediaReady(media: MaskMedia): boolean {
  return media instanceof HTMLVideoElement
    ? media.readyState >= media.HAVE_CURRENT_DATA && media.videoWidth > 0
    : media.complete && media.naturalWidth > 0;
}

interface MaskOverlayProps {
  mediaRef: RefObject<MaskMedia | null>;
  /** A redraw trigger only: the pixels come from the element the stage already loaded. */
  src: string;
  masks: readonly MaskDraft[];
  selectedId: string | null;
  sourceWidth: number;
  sourceHeight: number;
  orientation?: Orientation;
  disabled: boolean;
  /** Off while another tool holds the stage, leaving the picture as Apply would write it. */
  interactive: boolean;
  onSelect: (maskId: string | null) => void;
  onChange: (maskId: string, rect: CropRect) => void;
  onRemove: (maskId: string) => void;
}

export function MaskOverlay({
  mediaRef,
  src,
  masks,
  selectedId,
  sourceWidth,
  sourceHeight,
  orientation = UPRIGHT,
  disabled,
  interactive,
  onSelect,
  onChange,
  onRemove,
}: MaskOverlayProps) {
  const box = usePaintedBox(mediaRef, sourceWidth, sourceHeight);
  // Anchored to where the drag began: pointer moves outrun rendering, so a delta applied to the
  // last rendered rect loses every move that landed inside the same frame.
  const dragRef = useRef<{ x: number; y: number; rect: CropRect } | null>(null);
  const paintersRef = useRef(new Set<Painter>());

  const registerPainter = useCallback((paint: Painter) => {
    paintersRef.current.add(paint);
    return () => {
      paintersRef.current.delete(paint);
    };
  }, []);

  // A video moves under the regions, so each presented frame is repainted rather than each change.
  useEffect(() => {
    const media = mediaRef.current;
    if (!(media instanceof HTMLVideoElement)) return;

    const paintAll = () => paintersRef.current.forEach((paint) => paint());
    let frame = 0;
    let stopped = false;

    // A frame callback, not readiness: `readyState` says the data arrived, not that the picture
    // can be drawn yet, and a paused video fires nothing else once it has loaded.
    if (typeof media.requestVideoFrameCallback === "function") {
      const onFrame = () => {
        paintAll();
        if (!stopped) frame = media.requestVideoFrameCallback(onFrame);
      };
      frame = media.requestVideoFrameCallback(onFrame);

      return () => {
        stopped = true;
        media.cancelVideoFrameCallback(frame);
      };
    }

    const tick = () => {
      paintAll();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      paintAll();
    };

    media.addEventListener("play", start);
    media.addEventListener("playing", start);
    media.addEventListener("pause", stop);
    media.addEventListener("seeked", stop);
    media.addEventListener("loadeddata", stop);
    media.addEventListener("canplay", stop);
    if (!media.paused) start();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      media.removeEventListener("play", start);
      media.removeEventListener("playing", start);
      media.removeEventListener("pause", stop);
      media.removeEventListener("seeked", stop);
      media.removeEventListener("loadeddata", stop);
      media.removeEventListener("canplay", stop);
    };
  }, [mediaRef]);

  const source = useMemo(
    () => ({ width: sourceWidth, height: sourceHeight }),
    [sourceHeight, sourceWidth],
  );

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
    (mask: MaskDraft) => (event: PointerEvent<HTMLElement>) => {
      if (disabled) return;
      // preventDefault drops the click's focus; take it or unfocused arrows navigate the gallery.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { x: event.clientX, y: event.clientY, rect: mask.rect };
      onSelect(mask.id);
    },
    [disabled, onSelect],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }, []);

  const dragSurface = useCallback(
    (mask: MaskDraft) => (event: PointerEvent<HTMLButtonElement>) => {
      const origin = dragRef.current;
      if (disabled || !origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

      const { dx, dy } = fractionDelta(event.clientX - origin.x, event.clientY - origin.y);
      onChange(mask.id, moveCrop(origin.rect, dx, dy, MIN_MASK_FRACTION));
    },
    [disabled, fractionDelta, onChange],
  );

  const dragHandle = useCallback(
    (mask: MaskDraft, handle: CropHandle) => (event: PointerEvent<HTMLButtonElement>) => {
      const origin = dragRef.current;
      if (disabled || !origin || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

      const { dx, dy } = fractionDelta(event.clientX - origin.x, event.clientY - origin.y);
      onChange(mask.id, resizeCrop(origin.rect, handle, dx, dy, null, MIN_MASK_FRACTION));
    },
    [disabled, fractionDelta, onChange],
  );

  const surfaceKeys = useCallback(
    (mask: MaskDraft) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onRemove(mask.id);
        return;
      }

      const delta = arrowDelta(event, orientation);
      if (!delta) return;

      event.preventDefault();
      onChange(mask.id, moveCrop(mask.rect, delta.dx, delta.dy, MIN_MASK_FRACTION));
    },
    [disabled, onChange, onRemove, orientation],
  );

  const handleKeys = useCallback(
    (mask: MaskDraft, handle: CropHandle) => (event: KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      const delta = arrowDelta(event, orientation);
      if (!delta) return;

      event.preventDefault();
      onChange(mask.id, resizeCrop(mask.rect, handle, delta.dx, delta.dy, null, MIN_MASK_FRACTION));
    },
    [disabled, onChange, orientation],
  );

  if (box.width <= 0 || box.height <= 0 || masks.length === 0) return null;

  const style = {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    // Inverse of the host transform so the readout stays upright.
    "--mask-readout-transform":
      `rotate(${-orientation.rotate}deg)` +
      ` scaleX(${orientation.mirrorH ? -1 : 1}) scaleY(${orientation.mirrorV ? -1 : 1})`,
  } as CSSProperties;

  return (
    <div
      className={classNames("mask-overlay", interactive && "mask-overlay--interactive")}
      style={style}
      role="group"
      aria-label="Blur regions"
      // Only a press on the bare picture: a region's own press is the target, and deselecting
      // under the remove button would unmount it before its click landed.
      onPointerDown={(event) => {
        if (interactive && event.target === event.currentTarget) onSelect(null);
      }}
    >
      {masks.map((mask, index) => {
        const selected = interactive && mask.id === selectedId;
        const name = `${modeLabel(mask.mode)} region ${index + 1}`;
        const regionStyle = {
          "--mask-x": `${mask.rect.x * 100}%`,
          "--mask-y": `${mask.rect.y * 100}%`,
          "--mask-w": `${mask.rect.width * 100}%`,
          "--mask-h": `${mask.rect.height * 100}%`,
        } as CSSProperties;

        return (
          <div
            key={mask.id}
            className={classNames(
              "mask-overlay__region",
              selected && "mask-overlay__region--selected",
            )}
            style={regionStyle}
          >
            <MaskFill
              mediaRef={mediaRef}
              src={src}
              mask={mask}
              box={box}
              source={source}
              registerPainter={registerPainter}
            />

            {interactive && (
              <button
                type="button"
                className="mask-overlay__surface"
                aria-label={name}
                aria-pressed={selected}
                disabled={disabled}
                // Off the tab ring: pointerdown focuses it, so the arrow keys still reach it.
                tabIndex={-1}
                onFocus={() => onSelect(mask.id)}
                onPointerDown={startDrag(mask)}
                onPointerMove={dragSurface(mask)}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={surfaceKeys(mask)}
              />
            )}

            {selected && (
              <>
                <span className="mask-overlay__readout">
                  {Math.round(mask.rect.width * sourceWidth)} ×{" "}
                  {Math.round(mask.rect.height * sourceHeight)}
                </span>
                <button
                  type="button"
                  className="mask-overlay__remove"
                  aria-label={`Remove ${name.toLowerCase()}`}
                  disabled={disabled}
                  tabIndex={-1}
                  onClick={() => onRemove(mask.id)}
                >
                  <Icon icon={iconX} />
                </button>
                {CROP_HANDLES.map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className={classNames(
                      "mask-overlay__handle",
                      `mask-overlay__handle--${handle}`,
                    )}
                    aria-label={`${name} ${HANDLE_LABELS[handle]}`}
                    disabled={disabled}
                    tabIndex={-1}
                    onPointerDown={startDrag(mask)}
                    onPointerMove={dragHandle(mask, handle)}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={handleKeys(mask, handle)}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface MaskFillProps {
  mediaRef: RefObject<MaskMedia | null>;
  src: string;
  mask: MaskDraft;
  box: PaintedBox;
  source: Size;
  registerPainter: (paint: Painter) => () => void;
}

/** A canvas, not a CSS filter: only a second resample gives a mosaic its hard block edges. */
function MaskFill({ mediaRef, src, mask, box, source, registerPainter }: MaskFillProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const paint = () => {
      const canvas = canvasRef.current;
      const media = mediaRef.current;
      // A blackout draws none of the picture, so it need not wait for one to arrive.
      if (!canvas || !media || (mask.mode !== "blackout" && !mediaReady(media))) return;

      paintMask(canvas, media, mask, box, source);
    };

    paint();
    return registerPainter(paint);
  }, [box, mask, mediaRef, registerPainter, source, src]);

  return <canvas ref={canvasRef} className="mask-overlay__fill" aria-hidden="true" />;
}

function paintMask(
  canvas: HTMLCanvasElement,
  picture: MaskMedia,
  mask: MaskDraft,
  box: PaintedBox,
  source: Size,
): void {
  const width = Math.max(1, Math.round(mask.rect.width * box.width));
  const height = Math.max(1, Math.round(mask.rect.height * box.height));

  // Assigning either axis clears the canvas and resets the context, so size it before drawing.
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return;

  if (mask.mode === "blackout") {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    return;
  }

  const scale = source.width > 0 ? box.width / source.width : 0;
  if (scale <= 0) return;

  const left = mask.rect.x * source.width;
  const top = mask.rect.y * source.height;
  const right = left + mask.rect.width * source.width;
  const bottom = top + mask.rect.height * source.height;

  if (mask.mode === "pixelate") {
    const block = Math.max(1, pixelBlockPx(mask, source) * scale);
    const columns = Math.max(1, Math.round(width / block));
    const rows = Math.max(1, Math.round(height / block));

    context.imageSmoothingEnabled = true;
    context.drawImage(picture, left, top, right - left, bottom - top, 0, 0, columns, rows);
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, columns, rows, 0, 0, width, height);
    return;
  }

  // Drawn with its neighbours and clipped back: a bare patch blurs against nothing and fades out.
  const radius = blurRadiusPx(mask, source) * scale;
  const pad = Math.ceil(radius * 2) / scale;
  const outer = {
    left: Math.max(0, left - pad),
    top: Math.max(0, top - pad),
    right: Math.min(source.width, right + pad),
    bottom: Math.min(source.height, bottom + pad),
  };

  context.filter = `blur(${radius}px)`;
  context.drawImage(
    picture,
    outer.left,
    outer.top,
    outer.right - outer.left,
    outer.bottom - outer.top,
    (outer.left - left) * scale,
    (outer.top - top) * scale,
    (outer.right - outer.left) * scale,
    (outer.bottom - outer.top) * scale,
  );
}
