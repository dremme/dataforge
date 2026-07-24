import type { CaptionBBox } from "@/shared/types";

export const BBOX_COLORS = ["#7c9cff", "#6ee7b7", "#fbbf24", "#f472b6", "#a78bfa", "#38bdf8"];

export function bboxWidth(bbox: CaptionBBox): number {
  return Math.max(0, bbox.x2 - bbox.x1);
}

export function bboxHeight(bbox: CaptionBBox): number {
  return Math.max(0, bbox.y2 - bbox.y1);
}

export function bboxLabel(bbox: CaptionBBox, index: number): string {
  return bbox.label ?? bbox.type ?? `Region ${index + 1}`;
}

export function formatBBoxCoords(bbox: CaptionBBox): string {
  const fmt = (value: number) => Math.round(value).toLocaleString();
  return `[${fmt(bbox.x1)}, ${fmt(bbox.y1)}, ${fmt(bbox.x2)}, ${fmt(bbox.y2)}]`;
}

const MIN_BBOX_SIZE = 8;

export function clampBBox(bbox: CaptionBBox, imageWidth: number, imageHeight: number): CaptionBBox {
  let x1 = Math.min(bbox.x1, bbox.x2);
  let y1 = Math.min(bbox.y1, bbox.y2);
  let x2 = Math.max(bbox.x1, bbox.x2);
  let y2 = Math.max(bbox.y1, bbox.y2);

  if (x2 - x1 < MIN_BBOX_SIZE) {
    x2 = x1 + MIN_BBOX_SIZE;
  }
  if (y2 - y1 < MIN_BBOX_SIZE) {
    y2 = y1 + MIN_BBOX_SIZE;
  }

  const width = x2 - x1;
  const height = y2 - y1;

  if (x1 < 0) {
    x1 = 0;
    x2 = width;
  }
  if (y1 < 0) {
    y1 = 0;
    y2 = height;
  }
  if (x2 > imageWidth) {
    x2 = imageWidth;
    x1 = imageWidth - width;
  }
  if (y2 > imageHeight) {
    y2 = imageHeight;
    y1 = imageHeight - height;
  }

  x1 = Math.max(0, x1);
  y1 = Math.max(0, y1);
  x2 = Math.min(imageWidth, Math.max(x1 + MIN_BBOX_SIZE, x2));
  y2 = Math.min(imageHeight, Math.max(y1 + MIN_BBOX_SIZE, y2));

  return { ...bbox, x1, y1, x2, y2 };
}

export function bboxesEqual(a: CaptionBBox[], b: CaptionBBox[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (bbox, index) =>
      bbox.x1 === b[index].x1 &&
      bbox.y1 === b[index].y1 &&
      bbox.x2 === b[index].x2 &&
      bbox.y2 === b[index].y2,
  );
}

export function bboxContainsPoint(bbox: CaptionBBox, x: number, y: number): boolean {
  return x >= bbox.x1 && x <= bbox.x2 && y >= bbox.y1 && y <= bbox.y2;
}

export function bboxIndicesAtPoint(bboxes: CaptionBBox[], x: number, y: number): number[] {
  return bboxes
    .map((bbox, index) => ({ bbox, index }))
    .filter(({ bbox }) => bboxContainsPoint(bbox, x, y))
    .sort((a, b) => b.index - a.index)
    .map(({ index }) => index);
}

export function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}
