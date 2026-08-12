import { memo } from "react";
import { getRowCaptionDisplay } from "@/features/gallery/lib/captionStatus";
import { isGif, isVideo } from "@/features/gallery/lib/itemKind";
import {
  iconBraces,
  iconCheck,
  iconFileImage,
  iconTriangleAlert,
  iconVideo,
  type AppIcon,
} from "@/shared/icons";
import type { GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { formatFileSize, formatModifiedAt } from "@/shared/lib/format";
import { Icon } from "@/shared/ui/Icon";
import { GalleryCardMedia } from "./GalleryCardMedia";

interface GalleryListRowProps {
  item: GalleryItem;
  onSelect: (path: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (path: string) => void;
}

type RowMarker = { key: string; icon: AppIcon; label: string; variant: string };

/**
 * Icon-only counterpart of the card's `CardBadge`. A row has one line to spend,
 * so the badge text drops and the label survives as the tooltip.
 */
function rowMarkers(item: GalleryItem): RowMarker[] {
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

/** Dimensions, size, and modified date — whichever of them the item carries. */
function rowMetaParts(item: GalleryItem): string[] {
  const parts: string[] = [];

  if (item.width && item.height) {
    parts.push(`${item.width.toLocaleString()} × ${item.height.toLocaleString()}`);
  }
  if (item.size) {
    parts.push(formatFileSize(item.size));
  }
  const modified = item.modified_at ? formatModifiedAt(item.modified_at) : null;
  if (modified) {
    parts.push(modified);
  }

  return parts;
}

/**
 * One item as a condensed list row: leading checkbox, thumbnail, name, then the
 * file facts. Separate from `GalleryCard` because the two share no layout — the
 * row is a fixed-height line, which is also what lets the virtualizer size list
 * rows exactly instead of measuring each one.
 *
 * Memoized on the same terms as the card: the list re-renders on every selection
 * change, but a row only changes when its own `selected` flag flips.
 */
export const GalleryListRow = memo(function GalleryListRow({
  item,
  onSelect,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: GalleryListRowProps) {
  const status = getRowCaptionDisplay(item);
  const markers = rowMarkers(item);
  const metaParts = rowMetaParts(item);

  const handleClick = () => {
    if (selectionMode && onToggleSelect) {
      onToggleSelect(item.path);
      return;
    }
    onSelect(item.path);
  };

  return (
    <button
      type="button"
      className={classNames("gallery-list-row", selected && "gallery-list-row--selected")}
      onClick={handleClick}
      onDragStart={(event) => event.preventDefault()}
      aria-label={
        selectionMode ? `${selected ? "Deselect" : "Select"} ${item.name}` : `View ${item.name}`
      }
      aria-pressed={selectionMode ? selected : undefined}
    >
      {selectionMode && (
        <span className="gallery-list-row__check" aria-hidden="true">
          {selected && <Icon icon={iconCheck} className="gallery-list-row__check-icon" />}
        </span>
      )}
      <span className="gallery-list-row__thumb">
        <GalleryCardMedia item={item} />
      </span>
      <span className="gallery-list-row__name" title={item.name}>
        {item.name}
      </span>
      {markers.length > 0 && (
        <span className="gallery-list-row__markers">
          {markers.map((marker) => (
            <span
              key={marker.key}
              className={`gallery-list-row__marker gallery-list-row__marker--${marker.variant}`}
              title={marker.label}
            >
              <Icon icon={marker.icon} className="gallery-list-row__marker-icon" />
            </span>
          ))}
        </span>
      )}
      <span className={`gallery-list-row__status gallery-list-row__status--${status.variant}`}>
        {status.message}
      </span>
      {metaParts.length > 0 && (
        <span className="gallery-list-row__meta">
          {metaParts.map((part) => (
            <span key={part} className="gallery-list-row__meta-item">
              {part}
            </span>
          ))}
        </span>
      )}
    </button>
  );
});
