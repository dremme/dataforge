import { getCardCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import type { GalleryItem } from "@/shared/types";

const FALLBACK_ASPECT = 4 / 3;

/** `.card` draws a 1px border, and the global reset makes every box border-box. */
export const CARD_BORDER_PX = 1;

/**
 * Exact large-card body heights, in px.
 *
 * The body is pinned to these numbers through `--card-body-h`, so the height the
 * masonry packs with is the height the card renders at — there is nothing to
 * measure and nothing to correct after the fact. Content that would exceed its
 * variant is clipped by the body's own `overflow: hidden`, so being a pixel out
 * is a cosmetic question, never a layout one.
 *
 * Derived from `.card__body` in `_gallery.scss` — 14px + 16px padding and a
 * 18.9px title line (--text-sm x --leading-snug), plus a 7px gap and then either
 * a 28px status pill or three 22.4px caption lines (--text-sm x --leading-relaxed)
 * — and each rounded up for a couple of pixels of cushion. Measured against the
 * rendered card at 48.89px, 83.89px and 123.06px.
 */
export const LARGE_CARD_BODY_PX = {
  title: 52,
  titleAndPill: 86,
  titleAndCaption: 126,
} as const;

export interface LargeCardBox {
  /** Height of `.card__media`, from the file's own aspect. */
  media: number;
  /** Height of `.card__body`, one of {@link LARGE_CARD_BODY_PX}. */
  body: number;
  /** Outer height of the card, borders included. */
  total: number;
}

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
 * Mirrors the three-way branch `GalleryCard` renders under the title: the caption
 * text when there is one, else the caption-status pill when there is one, else
 * nothing. The two must agree, so they read the same predicate.
 */
export function largeCardBodyHeight(item: GalleryItem): number {
  if (item.description) return LARGE_CARD_BODY_PX.titleAndCaption;
  if (getCardCaptionDisplay(item)) return LARGE_CARD_BODY_PX.titleAndPill;
  return LARGE_CARD_BODY_PX.title;
}

export function largeCardBox(item: GalleryItem, columnWidth: number): LargeCardBox {
  const borders = 2 * CARD_BORDER_PX;
  // The card is border-box at the column width, so its media is that much narrower.
  const mediaWidth = Math.max(0, columnWidth - borders);
  const media = mediaWidth / mediaAspectRatio(item);
  const body = largeCardBodyHeight(item);
  return { media, body, total: borders + media + body };
}

export function largeCardHeight(item: GalleryItem, columnWidth: number): number {
  return largeCardBox(item, columnWidth).total;
}
