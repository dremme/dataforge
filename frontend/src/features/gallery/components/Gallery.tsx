import { DEFAULT_DISPLAY_MODE } from "@/features/gallery/lib/displayMode";
import type { GalleryDisplayMode, GalleryItem } from "@/shared/types";
import { GalleryMasonry } from "./GalleryMasonry";
import { GalleryUniformGrid } from "./GalleryUniformGrid";

interface GalleryProps {
  items: GalleryItem[];
  onSelect: (path: string) => void;
  displayMode?: GalleryDisplayMode;
}

export function Gallery({ items, onSelect, displayMode = DEFAULT_DISPLAY_MODE }: GalleryProps) {
  if (items.length === 0) {
    return null;
  }

  if (displayMode === "large") {
    return <GalleryMasonry items={items} onSelect={onSelect} />;
  }

  return <GalleryUniformGrid items={items} onSelect={onSelect} displayMode={displayMode} />;
}
