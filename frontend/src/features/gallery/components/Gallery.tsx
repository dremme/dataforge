import { DEFAULT_DISPLAY_MODE } from "@/features/gallery/lib/displayMode";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { GalleryMasonry } from "./GalleryMasonry";
import { GalleryUniformGrid } from "./GalleryUniformGrid";

interface GalleryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
  displayMode?: GalleryDisplayMode;
}

/**
 * Two layouts share the gallery: large cards keep each file's own shape and are
 * packed into columns, while small cards and list rows sit on uniform rows.
 */
export function Gallery({ items, onSelect, displayMode = DEFAULT_DISPLAY_MODE }: GalleryProps) {
  if (items.length === 0) {
    return null;
  }

  if (displayMode === "large") {
    return <GalleryMasonry items={items} onSelect={onSelect} />;
  }

  return <GalleryUniformGrid items={items} onSelect={onSelect} displayMode={displayMode} />;
}
