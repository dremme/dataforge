import { DEFAULT_CARD_OPTIONS, type GalleryCardOptions } from "@/features/gallery/lib/cardOptions";
import { DEFAULT_DISPLAY_MODE } from "@/features/gallery/lib/displayMode";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { GalleryMasonry } from "./GalleryMasonry";
import { GalleryUniformGrid } from "./GalleryUniformGrid";

interface GalleryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
  displayMode?: GalleryDisplayMode;
  cardOptions?: GalleryCardOptions;
}

export function Gallery({
  items,
  onSelect,
  displayMode = DEFAULT_DISPLAY_MODE,
  cardOptions = DEFAULT_CARD_OPTIONS,
}: GalleryProps) {
  if (items.length === 0) {
    return null;
  }

  if (displayMode === "large") {
    return (
      <GalleryMasonry
        items={items}
        onSelect={onSelect}
        captionLines={cardOptions.largeCaptionLines}
        showMegapixels={cardOptions.megapixels}
        showAspectRatio={cardOptions.largeAspectRatio}
        showTags={cardOptions.largeTags}
      />
    );
  }

  return (
    <GalleryUniformGrid
      items={items}
      onSelect={onSelect}
      displayMode={displayMode}
      captionLines={cardOptions.smallCaptionLines}
      showMegapixels={cardOptions.megapixels}
      captionPreview={cardOptions.listCaptionPreview}
    />
  );
}
