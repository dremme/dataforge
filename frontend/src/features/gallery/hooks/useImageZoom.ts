import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

export const IMAGE_ZOOM_SCALE = 2.5;

export interface ImageZoomOrigin {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

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
    return { x: 50, y: 50 };
  }

  return {
    x: clampPercent(((clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((clientY - rect.top) / rect.height) * 100),
  };
}

/** Prefer the requested zoom, but never paint larger than the source pixels allow. */
export function effectiveZoomScale(
  requestedScale: number,
  viewport: ImageSize,
  natural: ImageSize | null,
): number {
  if (requestedScale <= 1) return 1;
  if (!natural || natural.width <= 0 || natural.height <= 0) return requestedScale;
  if (viewport.width <= 0 || viewport.height <= 0) return requestedScale;

  const maxSharpScale = Math.min(natural.width / viewport.width, natural.height / viewport.height);
  return Math.max(1, Math.min(requestedScale, maxSharpScale));
}

/**
 * Layout for a zoomed canvas anchored at the viewport's top-left.
 * Origin is the pointer position in the viewport (0–100%).
 * Pan keeps that viewport point over the matching image point and stays
 * within [-(scaled - viewport), 0] so edges are never overscrolled.
 */
export function zoomCanvasLayout(
  viewport: ImageSize,
  origin: ImageZoomOrigin,
  scale: number,
): { width: number; height: number; translateX: number; translateY: number } {
  const width = viewport.width * scale;
  const height = viewport.height * scale;
  const maxPanX = Math.max(0, width - viewport.width);
  const maxPanY = Math.max(0, height - viewport.height);
  const originX = clampPercent(origin.x) / 100;
  const originY = clampPercent(origin.y) / 100;
  const translateX = -maxPanX * originX;
  const translateY = -maxPanY * originY;
  return { width, height, translateX, translateY };
}

export function useImageZoom(resetKey?: string, enabled = true) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState<ImageZoomOrigin>({ x: 50, y: 50 });
  const [viewport, setViewport] = useState<ImageSize | null>(null);
  const [natural, setNatural] = useState<ImageSize | null>(null);

  useEffect(() => {
    setZoomed(false);
    setOrigin({ x: 50, y: 50 });
    setViewport(null);
    setNatural(null);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      setZoomed(false);
      setOrigin({ x: 50, y: 50 });
      setViewport(null);
    }
  }, [enabled]);

  const recordNaturalSize = useCallback((width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    setNatural({ width, height });
  }, []);

  const updateOrigin = useCallback((clientX: number, clientY: number, element: HTMLElement) => {
    setOrigin(originFromPointer(clientX, clientY, element.getBoundingClientRect()));
  }, []);

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled) return;
      if ((event.target as Element | null)?.closest?.("[data-zoom-ignore]")) {
        return;
      }

      event.preventDefault();
      const element = event.currentTarget;

      if (zoomed) {
        setZoomed(false);
        setViewport(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      setViewport({ width: rect.width, height: rect.height });
      updateOrigin(event.clientX, event.clientY, element);
      setZoomed(true);
    },
    [enabled, updateOrigin, zoomed],
  );

  const handleMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!enabled || !zoomed) return;
      updateOrigin(event.clientX, event.clientY, event.currentTarget);
    },
    [enabled, updateOrigin, zoomed],
  );

  const toggleZoom = useCallback(
    (element?: HTMLElement | null) => {
      if (!enabled) return;
      setZoomed((current) => {
        if (current) {
          setViewport(null);
          return false;
        }

        if (element) {
          const rect = element.getBoundingClientRect();
          setViewport({ width: rect.width, height: rect.height });
        }
        setOrigin({ x: 50, y: 50 });
        return true;
      });
    },
    [enabled],
  );

  const scale = zoomed && viewport ? effectiveZoomScale(IMAGE_ZOOM_SCALE, viewport, natural) : 1;

  const layout = zoomed && viewport && scale > 1 ? zoomCanvasLayout(viewport, origin, scale) : null;

  const containerStyle = useMemo(() => {
    if (!zoomed || !viewport) return undefined;
    return {
      width: viewport.width,
      height: viewport.height,
    } as const;
  }, [zoomed, viewport]);

  const canvasStyle = useMemo(() => {
    if (!layout) return undefined;
    return {
      width: layout.width,
      height: layout.height,
      transform: `translate(${layout.translateX}px, ${layout.translateY}px)`,
    } as const;
  }, [layout]);

  return {
    zoomed,
    origin,
    scale,
    containerStyle,
    canvasStyle,
    handleClick,
    handleMouseMove,
    toggleZoom,
    recordNaturalSize,
  };
}
