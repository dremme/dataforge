import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptionBBox } from "@/shared/types";
import {
  bboxHeight,
  bboxIndicesAtPoint,
  bboxLabel,
  bboxWidth,
  BBOX_COLORS,
  clampBBox,
  clientToSvgPoint,
} from "@/features/gallery/lib/bbox";
import { classNames } from "@/shared/lib/classNames";

type DragMode = "move" | "n" | "s" | "e" | "w";

const HANDLE_POSITIONS: Array<{ mode: DragMode; cursor: string }> = [
  { mode: "n", cursor: "ns-resize" },
  { mode: "s", cursor: "ns-resize" },
  { mode: "w", cursor: "ew-resize" },
  { mode: "e", cursor: "ew-resize" },
];

const SELECT_CYCLE_MS = 500;
const SELECT_CYCLE_DISTANCE = 12;
const DRAG_THRESHOLD = 3;

// On-screen CSS pixel targets (converted to viewBox units via display scale).
const STROKE_PX = 2;
const LABEL_FONT_PX = 12;
const HANDLE_RADIUS_PX = 6;
const LABEL_HEIGHT_PX = 16;
const LABEL_PAD_X_PX = 4;

interface BboxOverlayProps {
  bboxes: CaptionBBox[];
  imageWidth: number;
  imageHeight: number;
  editable?: boolean;
  selectedIndex?: number | null;
  onSelectedIndexChange?: (index: number | null) => void;
  onBboxesChange?: (bboxes: CaptionBBox[]) => void;
}

interface DragState {
  index: number;
  mode: DragMode;
  startPointer: { x: number; y: number };
  startBBox: CaptionBBox;
}

function applyDrag(
  startBBox: CaptionBBox,
  mode: DragMode,
  pointer: { x: number; y: number },
  startPointer: { x: number; y: number },
  imageWidth: number,
  imageHeight: number,
): CaptionBBox {
  const dx = pointer.x - startPointer.x;
  const dy = pointer.y - startPointer.y;
  let { x1, y1, x2, y2 } = startBBox;

  if (mode === "move") {
    const width = x2 - x1;
    const height = y2 - y1;
    x1 = startBBox.x1 + dx;
    y1 = startBBox.y1 + dy;
    x2 = x1 + width;
    y2 = y1 + height;
  } else {
    if (mode.includes("e")) x2 = startBBox.x2 + dx;
    if (mode.includes("w")) x1 = startBBox.x1 + dx;
    if (mode.includes("s")) y2 = startBBox.y2 + dy;
    if (mode.includes("n")) y1 = startBBox.y1 + dy;
  }

  return clampBBox({ ...startBBox, x1, y1, x2, y2 }, imageWidth, imageHeight);
}

function handlePosition(
  mode: DragMode,
  x: number,
  y: number,
  width: number,
  height: number,
): { cx: number; cy: number } {
  switch (mode) {
    case "n":
      return { cx: x + width / 2, cy: y };
    case "s":
      return { cx: x + width / 2, cy: y + height };
    case "w":
      return { cx: x, cy: y + height / 2 };
    case "e":
      return { cx: x + width, cy: y + height / 2 };
    default:
      return { cx: x, cy: y };
  }
}

function pickOverlappingIndex(
  hits: number[],
  selectedIndex: number | null | undefined,
  pointer: { x: number; y: number },
  lastSelect: { x: number; y: number; time: number } | null,
): number {
  if (hits.length === 1) return hits[0];

  const now = Date.now();
  const sameSpot =
    lastSelect !== null &&
    now - lastSelect.time < SELECT_CYCLE_MS &&
    Math.hypot(pointer.x - lastSelect.x, pointer.y - lastSelect.y) < SELECT_CYCLE_DISTANCE;

  if (sameSpot && selectedIndex != null && hits.includes(selectedIndex)) {
    const currentPosition = hits.indexOf(selectedIndex);
    return hits[(currentPosition + 1) % hits.length];
  }

  return hits[0];
}

export function BboxOverlay({
  bboxes,
  imageWidth,
  imageHeight,
  editable = false,
  selectedIndex = null,
  onSelectedIndexChange,
  onBboxesChange,
}: BboxOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingDragRef = useRef<{
    index: number;
    startPointer: { x: number; y: number };
    startBBox: CaptionBBox;
  } | null>(null);
  const bboxesRef = useRef(bboxes);
  const lastSelectRef = useRef<{ x: number; y: number; time: number } | null>(null);
  bboxesRef.current = bboxes;

  // CSS px per viewBox unit under preserveAspectRatio="meet".
  const [screenPerUser, setScreenPerUser] = useState(1);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || imageWidth <= 0 || imageHeight <= 0) return;

    const updateScale = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scale = Math.min(rect.width / imageWidth, rect.height / imageHeight);
      if (Number.isFinite(scale) && scale > 0) {
        setScreenPerUser(scale);
      }
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [imageWidth, imageHeight]);

  // Snap CSS-px targets to whole screen pixels, then convert to viewBox units so
  // label chips land on device pixels and sit flush with bbox corners.
  const toUser = (px: number) => Math.round(px) / screenPerUser;
  const labelFontSize = toUser(LABEL_FONT_PX);
  const labelHeight = toUser(LABEL_HEIGHT_PX);
  const labelPadX = toUser(LABEL_PAD_X_PX);
  const labelCharWidth = labelFontSize * 0.5;
  const handleRadius = toUser(HANDLE_RADIUS_PX);

  const renderIndices = useMemo(() => {
    const indices = bboxes.map((_, index) => index);
    if (selectedIndex == null || !indices.includes(selectedIndex)) {
      return indices;
    }
    return [...indices.filter((index) => index !== selectedIndex), selectedIndex];
  }, [bboxes, selectedIndex]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    pendingDragRef.current = null;
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const svg = svgRef.current;
      if (!svg || !onBboxesChange) return;

      const pointer = clientToSvgPoint(svg, event.clientX, event.clientY);
      const pending = pendingDragRef.current;

      if (pending && !dragRef.current) {
        const moved =
          Math.hypot(pointer.x - pending.startPointer.x, pointer.y - pending.startPointer.y) >=
          DRAG_THRESHOLD;
        if (moved) {
          dragRef.current = {
            index: pending.index,
            mode: "move",
            startPointer: pending.startPointer,
            startBBox: pending.startBBox,
          };
          pendingDragRef.current = null;
        }
      }

      const drag = dragRef.current;
      if (!drag) return;

      const next = bboxesRef.current.map((bbox, index) =>
        index === drag.index
          ? applyDrag(
              drag.startBBox,
              drag.mode,
              pointer,
              drag.startPointer,
              imageWidth,
              imageHeight,
            )
          : bbox,
      );

      onBboxesChange(next);
    },
    [imageHeight, imageWidth, onBboxesChange],
  );

  useEffect(() => {
    if (!editable) return;

    const handlePointerUp = () => endDrag();

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [editable, endDrag, handlePointerMove]);

  const startDrag = useCallback(
    (event: React.PointerEvent, index: number, mode: DragMode) => {
      if (!editable || !onBboxesChange || !svgRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      (event.currentTarget as Element).setPointerCapture(event.pointerId);

      onSelectedIndexChange?.(index);
      pendingDragRef.current = null;
      dragRef.current = {
        index,
        mode,
        startPointer: clientToSvgPoint(svgRef.current, event.clientX, event.clientY),
        startBBox: bboxes[index],
      };
    },
    [bboxes, editable, onBboxesChange, onSelectedIndexChange],
  );

  const handleOverlayPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (!editable || !onSelectedIndexChange || !svgRef.current) return;
      if (event.target !== svgRef.current) return;

      const pointer = clientToSvgPoint(svgRef.current, event.clientX, event.clientY);
      const hits = bboxIndicesAtPoint(bboxes, pointer.x, pointer.y);
      if (hits.length === 0) return;

      const nextIndex = pickOverlappingIndex(hits, selectedIndex, pointer, lastSelectRef.current);
      lastSelectRef.current = { x: pointer.x, y: pointer.y, time: Date.now() };
      onSelectedIndexChange(nextIndex);
      pendingDragRef.current = {
        index: nextIndex,
        startPointer: pointer,
        startBBox: bboxes[nextIndex],
      };
    },
    [bboxes, editable, onSelectedIndexChange, selectedIndex],
  );

  const renderVisual = (index: number, isSelected: boolean) => {
    const bbox = bboxes[index];
    const color = BBOX_COLORS[index % BBOX_COLORS.length];
    const x = bbox.x1;
    const y = bbox.y1;
    const width = bboxWidth(bbox);
    const height = bboxHeight(bbox);
    const label = bboxLabel(bbox, index);

    const displayLabel = label.length > 42 ? `${label.slice(0, 39)}...` : label;
    const labelWidth = Math.max(
      labelPadX * 2 + displayLabel.length * labelCharWidth,
      labelHeight * 2,
    );
    // Flush to the top-left corner: outside above when there is room, otherwise inside.
    const labelX = x;
    const labelY = y >= labelHeight ? y - labelHeight : y;

    return (
      <g key={`visual-${index}`} pointerEvents="none">
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={`${color}${isSelected ? "33" : "22"}`}
          stroke={color}
          strokeWidth={isSelected ? STROKE_PX * 1.5 : STROKE_PX}
          vectorEffect="non-scaling-stroke"
          className={isSelected ? "gallery-item-modal__bbox-region--selected" : undefined}
        />
        <rect
          x={labelX}
          y={labelY}
          width={labelWidth}
          height={labelHeight}
          fill={color}
          shapeRendering="crispEdges"
        />
        <text
          x={labelX + labelPadX}
          y={labelY + labelHeight / 2}
          fill="#0f1115"
          fontSize={labelFontSize}
          fontWeight={600}
          fontFamily="system-ui, Segoe UI, sans-serif"
          dominantBaseline="central"
          style={{ userSelect: "none" }}
        >
          {displayLabel}
        </text>
      </g>
    );
  };

  const renderInteraction = (index: number) => {
    const bbox = bboxes[index];
    const color = BBOX_COLORS[index % BBOX_COLORS.length];
    const x = bbox.x1;
    const y = bbox.y1;
    const width = bboxWidth(bbox);
    const height = bboxHeight(bbox);

    return (
      <g key={`interaction-${index}`}>
        {HANDLE_POSITIONS.map(({ mode, cursor }) => {
          const { cx, cy } = handlePosition(mode, x, y, width, height);

          return (
            <circle
              key={mode}
              className="gallery-item-modal__bbox-handle"
              cx={cx}
              cy={cy}
              r={handleRadius}
              fill="#ffffff"
              stroke={color}
              strokeWidth={STROKE_PX}
              vectorEffect="non-scaling-stroke"
              style={{ cursor }}
              onPointerDown={(event) => startDrag(event, index, mode)}
            />
          );
        })}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className={classNames(
        "gallery-item-modal__bbox-overlay",
        editable && "gallery-item-modal__bbox-overlay--editable",
      )}
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      onPointerDown={editable ? handleOverlayPointerDown : undefined}
    >
      {renderIndices.map((index) => renderVisual(index, index === selectedIndex))}
      {editable && selectedIndex != null && renderInteraction(selectedIndex)}
    </svg>
  );
}
