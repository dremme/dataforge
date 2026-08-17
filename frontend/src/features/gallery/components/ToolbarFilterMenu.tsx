import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FILTER_OPTIONS, MEDIA_TYPE_FILTER_OPTIONS } from "@/features/gallery/lib/filters";
import type { ItemFilter, MediaTypeFilter } from "@/features/gallery/lib/query";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { iconFilter, type AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface ToolbarFilterMenuProps {
  searchQuery: string;
  filter: ItemFilter;
  filterCounts: Record<ItemFilter, number>;
  mediaTypeFilter: MediaTypeFilter;
  mediaTypeFilterCounts: Record<MediaTypeFilter, number>;
  onFilterChange: (value: ItemFilter) => void;
  onMediaTypeFilterChange: (value: MediaTypeFilter) => void;
}

interface FilterMenuGroupProps<T extends string> {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; ariaLabel: string; icon: AppIcon }>;
  counts: Record<T, number>;
  value: T;
  searchQuery: string;
  onChange: (value: T) => void;
}

function filterCountLabel(ariaLabel: string, count: number, searchQuery: string): string {
  const trimmedSearch = searchQuery.trim();
  if (!trimmedSearch) {
    return `${ariaLabel} (${count})`;
  }

  return `${ariaLabel} (${count} matching "${trimmedSearch}")`;
}

function optionLabelFor(
  options: ReadonlyArray<{ value: string; label: string }>,
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function FilterMenuGroup<T extends string>({
  label,
  options,
  counts,
  value,
  searchQuery,
  onChange,
}: FilterMenuGroupProps<T>) {
  const labelId = useId();

  return (
    <div className="toolbar__filter-menu-group" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="toolbar__filter-menu-group-label">
        {label}
      </span>
      {options.map((option) => {
        const active = option.value === value;
        const count = counts[option.value];

        return (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            aria-label={filterCountLabel(option.ariaLabel, count, searchQuery)}
            className={classNames(
              "toolbar__filter-menu-option",
              active && "toolbar__filter-menu-option--active",
            )}
            onClick={() => onChange(option.value)}
          >
            <Icon icon={option.icon} className="toolbar__filter-menu-option-icon" />
            <span className="toolbar__filter-menu-option-label">{option.label}</span>
            <span className="toolbar__filter-menu-option-count" aria-hidden="true">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Media type and caption status filters, folded into one dropdown to spare toolbar width. */
export function ToolbarFilterMenu({
  searchQuery,
  filter,
  filterCounts,
  mediaTypeFilter,
  mediaTypeFilterCounts,
  onFilterChange,
  onMediaTypeFilterChange,
}: ToolbarFilterMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEscapeKey(close, open);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [close, open]);

  const activeLabels: string[] = [];
  if (mediaTypeFilter !== "all") {
    activeLabels.push(optionLabelFor(MEDIA_TYPE_FILTER_OPTIONS, mediaTypeFilter));
  }
  if (filter !== "all") {
    activeLabels.push(optionLabelFor(FILTER_OPTIONS, filter));
  }

  const filtering = activeLabels.length > 0;
  const tooltip = filtering
    ? `Filtering by ${activeLabels.join(" & ")}`
    : "Filter by media type and caption status";

  return (
    <div
      ref={rootRef}
      className={classNames("toolbar__filter-menu", open && "toolbar__filter-menu--open")}
    >
      <Tooltip content={tooltip}>
        <button
          type="button"
          className={classNames(
            "toolbar__filter-menu-trigger",
            filtering && "toolbar__filter-menu-trigger--filtering",
          )}
          onClick={() => setOpen((value) => !value)}
          aria-label="Filter media"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
        >
          <Icon icon={iconFilter} className="toolbar__filter-menu-trigger-icon" />
          {filtering && <span className="toolbar__filter-menu-trigger-dot" aria-hidden="true" />}
        </button>
      </Tooltip>

      {open && (
        <div id={menuId} className="toolbar__filter-menu-panel" role="menu" aria-label="Filters">
          <FilterMenuGroup
            label="Media type"
            options={MEDIA_TYPE_FILTER_OPTIONS}
            counts={mediaTypeFilterCounts}
            value={mediaTypeFilter}
            searchQuery={searchQuery}
            onChange={onMediaTypeFilterChange}
          />
          <FilterMenuGroup
            label="Caption status"
            options={FILTER_OPTIONS}
            counts={filterCounts}
            value={filter}
            searchQuery={searchQuery}
            onChange={onFilterChange}
          />
        </div>
      )}
    </div>
  );
}
