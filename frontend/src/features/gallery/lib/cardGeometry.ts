import { getCardCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import type { GalleryItem } from "@/shared/types";

const FALLBACK_ASPECT = 4 / 3;

export const CARD_BORDER_PX = 1;

/** Pinned through --card-body-h so the masonry packs the height the card actually renders. */
export const LARGE_CARD_BODY_PX = {
  title: 52,
  titleAndPill: 86,
} as const;

/** `.card__body`'s gap plus one `.card__description` line: --text-sm at --leading-relaxed. */
const LARGE_CARD_CAPTION_GAP_PX = 7;
const LARGE_CARD_CAPTION_LINE_PX = 14 * 1.6;

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

export function largeCardCaptionBodyHeight(captionLines: number): number {
  return (
    LARGE_CARD_BODY_PX.title + LARGE_CARD_CAPTION_GAP_PX + captionLines * LARGE_CARD_CAPTION_LINE_PX
  );
}

export function largeCardBodyHeight(item: GalleryItem, captionLines: number): number {
  if (captionLines === 0) return LARGE_CARD_BODY_PX.title;
  if (item.description) return largeCardCaptionBodyHeight(captionLines);
  if (getCardCaptionDisplay(item)) return LARGE_CARD_BODY_PX.titleAndPill;
  return LARGE_CARD_BODY_PX.title;
}

/** `captionLines` 0 hides the caption and its status pill. */
export function largeCardBox(
  item: GalleryItem,
  columnWidth: number,
  captionLines: number,
): LargeCardBox {
  const borders = 2 * CARD_BORDER_PX;
  const mediaWidth = Math.max(0, columnWidth - borders);
  const media = mediaWidth / mediaAspectRatio(item);
  const body = largeCardBodyHeight(item, captionLines);
  return { media, body, total: borders + media + body };
}

export function largeCardHeight(
  item: GalleryItem,
  columnWidth: number,
  captionLines: number,
): number {
  return largeCardBox(item, columnWidth, captionLines).total;
}
