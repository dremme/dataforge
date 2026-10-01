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
  CROP_HANDLE_NAMES,
  CROP_HANDLES,
  MIN_MASK_FRACTION,
  UPRIGHT,
  moveCrop,
  readoutTransform,
  resizeCrop,
  type CropHandle,
  type CropRect,
  type Orientation,
  type Size,
} from "@/features/gallery/lib/crop";
import { blurRadiusPx, modeLabel, pixelBlockPx, type MaskDraft } from "@/features/gallery/lib/mask";
import { usePaintedBox, type PaintedBox } from "@/features/gallery/hooks/usePaintedBox";
import { arrowDelta, useRectDrag } from "@/features/gallery/hooks/useRectDrag";
import { useVideoFrameLoop } from "@/features/gallery/hooks/useVideoFrameLoop";
import type { AdjustedPicture } from "@/features/gallery/lib/adjustedPicture";
import { iconX } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

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
  /** The adjusted preview, when one is showing: fills are cut from it so they tone with it. */
  picture?: AdjustedPicture | null;
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
  picture = null,
  onSelect,
  onChange,
  onRemove,
}: MaskOverlayProps) {
  const box = usePaintedBox(mediaRef, sourceWidth, sourceHeight);
  const drag = useRectDrag(box, orientation, disabled);
  const paintersRef = useRef(new Set<Painter>());

  const registerPainter = useCallback((paint: Painter) => {
    paintersRef.current.add(paint);
    return () => {
      paintersRef.current.delete(paint);
    };
  }, []);

  const paintAll = useCallback(() => paintersRef.current.forEach((paint) => paint()), []);

  // A video moves under the regions, so each presented frame is repainted rather than each change.
  useVideoFrameLoop(mediaRef, paintAll);

  // An adjusted preview repaints on its own schedule, and the fills show what it shows.
  useEffect(() => picture?.subscribe(paintAll), [paintAll, picture]);

  const source = useMemo(
    () => ({ width: sourceWidth, height: sourceHeight }),
    [sourceHeight, sourceWidth],
  );

  const startDrag = useCallback(
    (mask: MaskDraft) => (event: PointerEvent<HTMLElement>) => {
      if (drag.begin(event, mask.rect)) onSelect(mask.id);
    },
    [drag, onSelect],
  );

  const dragSurface = useCallback(
    (mask: MaskDraft) => (event: PointerEvent<HTMLButtonElement>) => {
      const move = drag.delta(event);
      if (move) onChange(mask.id, moveCrop(move.rect, move.dx, move.dy, MIN_MASK_FRACTION));
    },
    [drag, onChange],
  );

  const dragHandle = useCallback(
    (mask: MaskDraft, handle: CropHandle) => (event: PointerEvent<HTMLButtonElement>) => {
      const move = drag.delta(event);
      if (!move) return;
      onChange(mask.id, resizeCrop(move.rect, handle, move.dx, move.dy, null, MIN_MASK_FRACTION));
    },
    [drag, onChange],
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
        const paintedWidth = box.width * mask.rect.width;
        const paintedHeight = box.height * mask.rect.height;
        const regionStyle = {
          "--mask-x": `${mask.rect.x * 100}%`,
          "--mask-y": `${mask.rect.y * 100}%`,
          "--mask-w": `${mask.rect.width * 100}%`,
          "--mask-h": `${mask.rect.height * 100}%`,
          // Per region: the pin needs this rect's own painted size, not the overlay's.
          "--mask-readout-transform": readoutTransform(orientation, paintedWidth, paintedHeight),
          "--mask-remove-transform": readoutTransform(
            orientation,
            paintedWidth,
            paintedHeight,
            "top-right",
          ),
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
              picture={picture}
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
                onPointerUp={drag.end}
                onPointerCancel={drag.end}
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
                    aria-label={`${name} ${CROP_HANDLE_NAMES[handle]}`}
                    disabled={disabled}
                    tabIndex={-1}
                    onPointerDown={startDrag(mask)}
                    onPointerMove={dragHandle(mask, handle)}
                    onPointerUp={drag.end}
                    onPointerCancel={drag.end}
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
  picture: AdjustedPicture | null;
  registerPainter: (paint: Painter) => () => void;
}

/** A canvas, not a CSS filter: only a second resample gives a mosaic its hard block edges. */
function MaskFill({ mediaRef, src, mask, box, source, picture, registerPainter }: MaskFillProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const paint = () => {
      const canvas = canvasRef.current;
      const media = mediaRef.current;
      // A blackout draws none of the picture, so it need not wait for one to arrive.
      if (!canvas || !media || (mask.mode !== "blackout" && !mediaReady(media))) return;

      paintMask(canvas, picture ?? media, mask, box, source);
    };

    paint();
    return registerPainter(paint);
  }, [box, mask, mediaRef, picture, registerPainter, source, src]);

  return <canvas ref={canvasRef} className="mask-overlay__fill" aria-hidden="true" />;
}

/** Cut from the media itself, or from an adjusted preview that covers the same frame. */
function paintMask(
  canvas: HTMLCanvasElement,
  from: MaskMedia | AdjustedPicture,
  mask: MaskDraft,
  box: PaintedBox,
  source: Size,
): void {
  const adjusted = !(from instanceof HTMLImageElement || from instanceof HTMLVideoElement);
  const picture = adjusted ? from.canvas : from;
  // Source pixels to picture pixels: 1 for the media, the canvas's own size for the preview.
  const reach = adjusted && source.width > 0 ? from.canvas.width / source.width : 1;

  const width = Math.max(1, Math.round(mask.rect.width * box.width));
  const height = Math.max(1, Math.round(mask.rect.height * box.height));

  // Assigning either axis clears the canvas and resets the context, so size it before drawing.
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return;

  if (mask.mode === "blackout") {
    context.fillStyle = adjusted ? from.blackout : "#000";
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
    context.drawImage(
      picture,
      left * reach,
      top * reach,
      (right - left) * reach,
      (bottom - top) * reach,
      0,
      0,
      columns,
      rows,
    );
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
    outer.left * reach,
    outer.top * reach,
    (outer.right - outer.left) * reach,
    (outer.bottom - outer.top) * reach,
    (outer.left - left) * scale,
    (outer.top - top) * scale,
    (outer.right - outer.left) * scale,
    (outer.bottom - outer.top) * scale,
  );
}
