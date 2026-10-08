import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

/** Zoom relative to the displayed image, so a click always magnifies visibly. */
export const IMAGE_ZOOM_SCALE = 2.5;

export interface ImageZoomOrigin {
  x: number;
  y: number;
}

export interface ZoomRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Unzoomed layout, relative to the viewport's top-left: the viewport clips, the canvas carries the
 * transform, and the content is the painted image inside the canvas (letterboxing excluded).
 */
export interface ZoomGeometry {
  viewport: { width: number; height: number };
  canvas: ZoomRect;
  content: ZoomRect;
}

const CENTER: ImageZoomOrigin = { x: 50, y: 50 };

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 50;
  return Math.min(100, Math.max(0, value));
}

export function originFromPointer(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): ImageZoomOrigin {
  if (rect.width <= 0 || rect.height <= 0) {
    return { ...CENTER };
  }

  return {
    x: clampPercent(((clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((clientY - rect.top) / rect.height) * 100),
  };
}

/** The painted box of an `object-fit: contain` image centred in its element box. */
export function containedRect(box: ZoomRect, naturalWidth: number, naturalHeight: number) {
  if (naturalWidth <= 0 || naturalHeight <= 0 || box.width <= 0 || box.height <= 0) return box;
  const ratio = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * ratio;
  const height = naturalHeight * ratio;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** Must run while unzoomed: the canvas transform would skew every measured box. */
export function measureZoomGeometry(viewport: HTMLElement): ZoomGeometry | null {
  const viewportRect = viewport.getBoundingClientRect();
  if (viewportRect.width <= 0 || viewportRect.height <= 0) return null;

  // Rects are visual pixels; the transform is CSS pixels. They differ under an ancestor
  // transform (such as a modal's scale-in) or CSS zoom.
  const unit = viewport.offsetWidth > 0 ? viewport.offsetWidth / viewportRect.width : 1;
  const relative = (rect: DOMRect): ZoomRect => ({
    x: (rect.left - viewportRect.left) * unit,
    y: (rect.top - viewportRect.top) * unit,
    width: rect.width * unit,
    height: rect.height * unit,
  });

  const canvasElement = viewport.querySelector<HTMLElement>(".zoomable-image__canvas") ?? viewport;
  const canvas = relative(canvasElement.getBoundingClientRect());
  const img = canvasElement.querySelector("img");
  let content = canvas;
  if (img) {
    const box = relative(img.getBoundingClientRect());
    content =
      getComputedStyle(img).objectFit === "contain"
        ? containedRect(box, img.naturalWidth, img.naturalHeight)
        : box;
  }
  if (content.width <= 0 || content.height <= 0) return null;

  return {
    viewport: { width: viewportRect.width * unit, height: viewportRect.height * unit },
    canvas,
    content,
  };
}

/** Position of the zoomed content's leading edge on one axis. */
function zoomedEdge(viewport: number, start: number, size: number, fraction: number): number {
  if (size <= viewport) {
    // Still fits: grow about its own centre, kept inside the viewport.
    return Math.min(viewport - size, Math.max(0, start));
  }
  // Pan so the pointer's fraction across the viewport maps to the same fraction of the overflow.
  return -(size - viewport) * fraction;
}

/** Translation (applied before `scale`, origin at the canvas top-left) for the zoomed canvas. */
export function zoomTranslate(
  geometry: ZoomGeometry,
  origin: ImageZoomOrigin,
  scale: number,
): { x: number; y: number } {
  const { viewport, canvas, content } = geometry;
  const width = content.width * scale;
  const height = content.height * scale;
  const left = zoomedEdge(
    viewport.width,
    content.x + (content.width - width) / 2,
    width,
    clampPercent(origin.x) / 100,
  );
  const top = zoomedEdge(
    viewport.height,
    content.y + (content.height - height) / 2,
    height,
    clampPercent(origin.y) / 100,
  );
  return {
    x: left - canvas.x - (content.x - canvas.x) * scale,
    y: top - canvas.y - (content.y - canvas.y) * scale,
  };
}

export function useImageZoom(resetKey?: string, enabled = true) {
  const [geometry, setGeometry] = useState<ZoomGeometry | null>(null);
  const [origin, setOrigin] = useState<ImageZoomOrigin>(CENTER);
  const zoomed = geometry !== null;

  useEffect(() => {
    setGeometry(null);
    setOrigin(CENTER);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      setGeometry(null);
      setOrigin(CENTER);
    }
  }, [enabled]);

  /** `measured` defaults to the clicked element; panes sharing one zoom pass the same one. */
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>, measured: HTMLElement | null = event.currentTarget) => {
      if (!enabled) return;
      if ((event.target as Element | null)?.closest?.("[data-zoom-ignore]")) {
        return;
      }

      event.preventDefault();
      if (zoomed) {
        setGeometry(null);
        return;
      }

      const next = measured ? measureZoomGeometry(measured) : null;
      if (!next) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setOrigin(originFromPointer(event.clientX, event.clientY, rect));
      setGeometry(next);
    },
    [enabled, zoomed],
  );

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled || !zoomed) return;
      const rect = event.currentTarget.getBoundingClientRect();
      setOrigin(originFromPointer(event.clientX, event.clientY, rect));
    },
    [enabled, zoomed],
  );

  const toggleZoom = useCallback(
    (element?: HTMLElement | null) => {
      if (!enabled) return;
      if (zoomed) {
        setGeometry(null);
        return;
      }

      const measured = element ? measureZoomGeometry(element) : null;
      if (!measured) return;
      setOrigin(CENTER);
      setGeometry(measured);
    },
    [enabled, zoomed],
  );

  const canvasStyle = useMemo(() => {
    if (!geometry) return undefined;
    const { x, y } = zoomTranslate(geometry, origin, IMAGE_ZOOM_SCALE);
    return { transform: `translate(${x}px, ${y}px) scale(${IMAGE_ZOOM_SCALE})` } as const;
  }, [geometry, origin]);

  return {
    zoomed,
    origin,
    canvasStyle,
    handleClick,
    handleMouseMove,
    toggleZoom,
  };
}
