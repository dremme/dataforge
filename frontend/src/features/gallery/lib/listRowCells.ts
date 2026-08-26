import {
  getRowCaptionDisplay,
  type CaptionStatusVariant,
} from "@/features/gallery/lib/captionStatus";
import { isGif, isVideo } from "@/features/gallery/lib/itemKind";
import {
  iconFileImage,
  iconFiles,
  iconMessageCheck,
  iconMessageDashed,
  iconMessageWarning,
  iconScanSquare,
  iconVideo,
  type AppIcon,
} from "@/shared/icons";
import {
  formatDurationSeconds,
  formatFileSize,
  formatMegapixels,
  formatModifiedAt,
} from "@/shared/lib/format";
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

export type RowMetaColumn = "megapixels" | "duration" | "size" | "modified";

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
      icon: iconMessageWarning,
      label: "Caption issue",
      variant: "issue",
    });
  }
  if (item.has_duplicate_file) {
    markers.push({
      key: "duplicate",
      icon: iconFiles,
      label: "Duplicate",
      variant: "duplicate",
    });
  }
  if (item.has_candidate) {
    markers.push({
      key: "candidate",
      icon: iconScanSquare,
      label: "Candidate",
      variant: "candidate",
    });
  }

  return markers;
}

/**
 * Megapixels, duration, size, and modified date. A fact the item lacks stays as
 * an empty string rather than dropping out: each one owns a column of the list,
 * and a missing value that collapsed would slide every later fact out of
 * alignment.
 *
 * Resolution is megapixels rather than `w × h` for the same reason the modals
 * report it that way — one short number reads down a column, where a dimension
 * pair is two numbers to compare per row. Duration is seconds for the same
 * reason: one short number, not a clock readout, down the column.
 */
export function rowMetaCells(item: GalleryItem): RowMetaCell[] {
  const modified = item.modified_at ? formatModifiedAt(item.modified_at) : null;

  return [
    {
      key: "megapixels",
      value: item.width && item.height ? formatMegapixels(item.width, item.height) : "",
    },
    { key: "duration", value: formatDurationSeconds(item.duration) },
    { key: "size", value: item.size ? formatFileSize(item.size) : "" },
    { key: "modified", value: modified ?? "" },
  ];
}

/**
 * The message-bubble family the toolbar's caption stats use, so the same three
 * caption states read the same way in the header and down the list. Deliberately
 * not the triangle: that one already means "has an issue file" one column over.
 */
const ROW_STATUS_ICONS: Record<CaptionStatusVariant, AppIcon> = {
  success: iconMessageCheck,
  warning: iconMessageWarning,
  muted: iconMessageDashed,
};

export interface RowStatus {
  icon: AppIcon;
  label: string;
  variant: CaptionStatusVariant;
}

/** Caption state as an icon, with the wording it replaces kept as the tooltip. */
export function rowStatus(item: GalleryItem): RowStatus {
  const { message, variant } = getRowCaptionDisplay(item);
  return { icon: ROW_STATUS_ICONS[variant], label: message, variant };
}
