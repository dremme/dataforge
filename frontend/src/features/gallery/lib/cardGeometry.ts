import { getCardCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import type { GalleryItem } from "@/shared/types";

const FALLBACK_ASPECT = 4 / 3;

export const CARD_BORDER_PX = 1;

/** Pinned through --card-body-h so the masonry packs the height the card actually renders. */
export const LARGE_CARD_BODY_PX = {
  title: 52,
  titleAndPill: 86,
  titleAndCaption: 126,
} as const;

export interface LargeCardBox {
  media: number;
  body: number;
  total: number;
}

export function mediaAspectRatio(item: { width?: number | null; height?: number | null }): number {
  const width = item.width ?? 0;
  const height = item.height ?? 0;
  return width > 0 && height > 0 ? width / height : FALLBACK_ASPECT;
}

export function galleryColumnWidth(
  containerWidth: number,
  columnCount: number,
  gap: number,
): number {
  if (columnCount <= 0) return 0;
  return Math.max(0, (containerWidth - gap * (columnCount - 1)) / columnCount);
}

export function largeCardBodyHeight(item: GalleryItem): number {
  if (item.description) return LARGE_CARD_BODY_PX.titleAndCaption;
  if (getCardCaptionDisplay(item)) return LARGE_CARD_BODY_PX.titleAndPill;
  return LARGE_CARD_BODY_PX.title;
}

export function largeCardBox(item: GalleryItem, columnWidth: number): LargeCardBox {
  const borders = 2 * CARD_BORDER_PX;
  const mediaWidth = Math.max(0, columnWidth - borders);
  const media = mediaWidth / mediaAspectRatio(item);
  const body = largeCardBodyHeight(item);
  return { media, body, total: borders + media + body };
}

export function largeCardHeight(item: GalleryItem, columnWidth: number): number {
  return largeCardBox(item, columnWidth).total;
}
