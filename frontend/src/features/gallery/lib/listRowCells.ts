import { getRowCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { isGif, isVideo } from "@/features/gallery/lib/itemKind";
import {
  iconBraces,
  iconFileImage,
  iconTriangleAlert,
  iconVideo,
  type AppIcon,
} from "@/shared/icons";
import { formatFileSize, formatMegapixels, formatModifiedAt } from "@/shared/lib/format";
import type { GalleryItem } from "@/shared/types";

export interface RowMarker {
  key: string;
  icon: AppIcon;
  label: string;
  variant: string;
}

export interface RowMetaCell {
  key: RowMetaColumn;
  value: string;
}

export type RowMetaColumn = "megapixels" | "size" | "modified";

/**
 * Icon-only counterpart of the card's `CardBadge`. A row has one line to spend,
 * so the badge text drops and the label survives as the tooltip.
 */
export function rowMarkers(item: GalleryItem): RowMarker[] {
  const markers: RowMarker[] = [];

  if (isVideo(item)) {
    markers.push({ key: "video", icon: iconVideo, label: "Video", variant: "video" });
  }
  if (isGif(item)) {
    markers.push({ key: "gif", icon: iconFileImage, label: "GIF", variant: "gif" });
  }
  if (item.has_issue_file) {
    markers.push({
      key: "issue",
      icon: iconTriangleAlert,
      label: "Caption issue",
      variant: "issue",
    });
  }
  if (item.caption_file_type === "json") {
    markers.push({ key: "json", icon: iconBraces, label: "JSON caption", variant: "json" });
  }

  return markers;
}

/**
 * Megapixels, size, and modified date. A fact the item lacks stays as an empty
 * string rather than dropping out: each one owns a column of the list, and a
 * missing value that collapsed would slide every later fact out of alignment.
 *
 * Resolution is megapixels rather than `w × h` for the same reason the modals
 * report it that way — one short number reads down a column, where a dimension
 * pair is two numbers to compare per row.
 */
export function rowMetaCells(item: GalleryItem): RowMetaCell[] {
  const modified = item.modified_at ? formatModifiedAt(item.modified_at) : null;

  return [
    {
      key: "megapixels",
      value: item.width && item.height ? formatMegapixels(item.width, item.height) : "",
    },
    { key: "size", value: item.size ? formatFileSize(item.size) : "" },
    { key: "modified", value: modified ?? "" },
  ];
}

export function rowStatusText(item: GalleryItem): string {
  return getRowCaptionDisplay(item).message;
}
