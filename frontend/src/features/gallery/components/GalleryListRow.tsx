import { memo } from "react";
import { rowMarkers, rowMetaCells, rowStatus } from "@/features/gallery/lib/listRowCells";
import { iconCheck } from "@/shared/icons";
import type { GalleryItem } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { GalleryCardMedia } from "./GalleryCardMedia";

interface GalleryListRowProps {
  item: GalleryItem;
  onSelect: (path: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (path: string) => void;
}

/**
 * One item as a condensed list row: leading checkbox, thumbnail, name, then the
 * file facts. Separate from `GalleryCard` because the two share no layout — the
 * row is a fixed-height line, which is also what lets the virtualizer size list
 * rows exactly instead of measuring each one.
 *
 * The trailing fields sit in columns shared by every row, sized once from the
 * whole folder by `useGalleryListColumns`, so a folder reads down as a table
 * rather than each line re-flowing around its own content.
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
  const status = rowStatus(item);
  const markers = rowMarkers(item);
  const metaCells = rowMetaCells(item);

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
      className={classNames(
        "gallery-list-row",
        // Adds the leading checkbox column to the row's grid.
        selectionMode && "gallery-list-row--selecting",
        selected && "gallery-list-row--selected",
      )}
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
      {/* Rendered even when empty — the row's columns are placed in order, so a
          cell that vanished would pull the ones after it out of the table. */}
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
      <span
        className={`gallery-list-row__status gallery-list-row__status--${status.variant}`}
        title={status.label}
      >
        <Icon icon={status.icon} className="gallery-list-row__status-icon" />
      </span>
      {metaCells.map((cell) => (
        <span
          key={cell.key}
          className={`gallery-list-row__meta-item gallery-list-row__meta-item--${cell.key}`}
        >
          {cell.value}
        </span>
      ))}
    </button>
  );
});
