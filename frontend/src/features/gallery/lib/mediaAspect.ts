import type { GalleryModeLayout } from "@/features/gallery/lib/layout";

const FALLBACK_ASPECT = 4 / 3;

export function mediaAspectRatio(item: { width?: number | null; height?: number | null }): number {
  const width = item.width ?? 0;
  const height = item.height ?? 0;
  return width > 0 && height > 0 ? width / height : FALLBACK_ASPECT;
}

/** Equal-width column size after subtracting inter-column gaps. */
export function galleryColumnWidth(
  containerWidth: number,
  columnCount: number,
  gap: number,
): number {
  if (columnCount <= 0) return 0;
  return Math.max(0, (containerWidth - gap * (columnCount - 1)) / columnCount);
}

/**
 * Title/caption chrome under the media. Derived from the uniform-grid estimates
 * so a 4:3 file lands at the same card height the large grid used at 4:3.
 */
export function cardBodyHeight(
  captioned: boolean,
  layout: Pick<GalleryModeLayout, "minColumnWidth" | "rowEstimate" | "captionRowEstimate">,
): number {
  const minColumnWidth = layout.minColumnWidth ?? 0;
  const uniformMediaHeight = minColumnWidth * (3 / 4);
  const total = captioned ? layout.captionRowEstimate : layout.rowEstimate;
  return Math.max(0, total - uniformMediaHeight);
}

export function estimateCardHeight(
  item: { width?: number | null; height?: number | null; description?: string | null },
  columnWidth: number,
  layout: Pick<GalleryModeLayout, "minColumnWidth" | "rowEstimate" | "captionRowEstimate">,
): number {
  const width = Math.max(0, columnWidth);
  const body = cardBodyHeight(Boolean(item.description), layout);
  if (width === 0) return body;
  return width / mediaAspectRatio(item) + body;
}

export function estimateNativeAspectRowHeight<
  T extends { width?: number | null; height?: number | null; description?: string | null },
>(
  row: readonly T[],
  columnWidth: number,
  layout: Pick<GalleryModeLayout, "minColumnWidth" | "rowEstimate" | "captionRowEstimate">,
): number {
  if (row.length === 0) return layout.rowEstimate;
  return Math.max(...row.map((item) => estimateCardHeight(item, columnWidth, layout)));
}
