import type { FileFilter, ItemFilter, MediaTypeFilter } from "@/features/gallery/lib/query";
import {
  FILTER_OPTIONS,
  FILE_FILTER_OPTIONS,
  MEDIA_TYPE_FILTER_OPTIONS,
} from "@/features/gallery/lib/filters";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface ActiveFiltersProps {
  filter: ItemFilter;
  mediaTypeFilter: MediaTypeFilter;
  fileFilter: FileFilter;
  onFilterChange: (value: ItemFilter) => void;
  onMediaTypeFilterChange: (value: MediaTypeFilter) => void;
  onFileFilterChange: (value: FileFilter) => void;
}

/** A chip per active filter to remove it; the Media count already says how many files match. */
export function ActiveFilters({
  filter,
  mediaTypeFilter,
  fileFilter,
  onFilterChange,
  onMediaTypeFilterChange,
  onFileFilterChange,
}: ActiveFiltersProps) {
  const anyFilter = filter !== "all" || mediaTypeFilter !== "all" || fileFilter !== "all";
  if (!anyFilter) return null;

  return (
    <div className="active-filters">
      {filter !== "all" && (
        <button
          type="button"
          className="active-filters__chip"
          onClick={() => onFilterChange("all")}
          aria-label="Remove caption filter"
        >
          {FILTER_OPTIONS.find((option) => option.value === filter)?.label}
          <Icon icon={iconX} />
        </button>
      )}
      {mediaTypeFilter !== "all" && (
        <button
          type="button"
          className="active-filters__chip"
          onClick={() => onMediaTypeFilterChange("all")}
          aria-label="Remove media type filter"
        >
          {MEDIA_TYPE_FILTER_OPTIONS.find((option) => option.value === mediaTypeFilter)?.label}
          <Icon icon={iconX} />
        </button>
      )}
      {fileFilter !== "all" && (
        <button
          type="button"
          className="active-filters__chip"
          onClick={() => onFileFilterChange("all")}
          aria-label="Remove file filter"
        >
          {FILE_FILTER_OPTIONS.find((option) => option.value === fileFilter)?.label}
          <Icon icon={iconX} />
        </button>
      )}
      <button
        type="button"
        className="active-filters__clear"
        onClick={() => {
          onFilterChange("all");
          onMediaTypeFilterChange("all");
          onFileFilterChange("all");
        }}
      >
        Clear filters
      </button>
    </div>
  );
}
