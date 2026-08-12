import type { GalleryDisplayMode } from "@/shared/types";

/** Shared layout constants for the virtualized gallery grid. */
export const GALLERY_GAP_PX = 20;

export interface GalleryModeLayout {
  /** Narrowest a column may get before the row drops one; `null` pins the mode to one column. */
  minColumnWidth: number | null;
  /** Estimated row height. Gap is handled by the virtualizer. */
  rowEstimate: number;
  /** Estimate for rows that may carry a multi-line caption; equals `rowEstimate` when none can. */
  captionRowEstimate: number;
  /** Space between rows. Zero makes list rows meet on their separator hairlines. */
  gap: number;
  overscan: number;
}

/**
 * Per-mode geometry. Large carries the numbers the gallery used before display
 * modes existed, so the default layout is unchanged.
 *
 * List overscan is far higher on purpose: its rows are ~84px, so the 3 rows that
 * cover three screens of cards would not even fill one viewport.
 */
export const GALLERY_MODE_LAYOUT: Record<GalleryDisplayMode, GalleryModeLayout> = {
  large: {
    minColumnWidth: 280,
    // Media 4:3 + body, and taller again when the row may include captions.
    rowEstimate: 320,
    captionRowEstimate: 400,
    gap: GALLERY_GAP_PX,
    overscan: 3,
  },
  small: {
    minColumnWidth: 180,
    rowEstimate: 230,
    captionRowEstimate: 275,
    gap: GALLERY_GAP_PX,
    overscan: 4,
  },
  list: {
    // Every row is one fixed-height line, so the estimate is exact and the two
    // variants converge — the virtualizer never has to correct a list row.
    minColumnWidth: null,
    rowEstimate: 40,
    captionRowEstimate: 40,
    gap: 0,
    overscan: 24,
  },
};

export function galleryLayoutFor(mode: GalleryDisplayMode): GalleryModeLayout {
  return GALLERY_MODE_LAYOUT[mode];
}
