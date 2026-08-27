import type { GalleryDisplayMode } from "@/shared/types";

export const GALLERY_GAP_PX = 20;

export interface GalleryModeLayout {
  minColumnWidth: number | null;
  rowEstimate: number;
  captionRowEstimate: number;
  gap: number;
  overscan: number;
}

export const GALLERY_MODE_LAYOUT: Record<GalleryDisplayMode, GalleryModeLayout> = {
  large: {
    minColumnWidth: 280,
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
