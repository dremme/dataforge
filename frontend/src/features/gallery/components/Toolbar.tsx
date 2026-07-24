import { useEffect, useRef, useState } from "react";
import { FILTER_OPTIONS, MEDIA_TYPE_FILTER_OPTIONS } from "@/features/gallery/lib/filters";
import {
  SORT_OPTIONS,
  type CaptionFilter,
  type MediaTypeFilter,
  type SortOption,
} from "@/features/gallery/lib/query";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import {
  iconArrowDownWideNarrow,
  iconFolder,
  iconMessageCheck,
  iconImages,
  iconSearch,
  iconX,
} from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { JobsButton } from "@/features/jobs/components/JobsButton";
import { Tooltip } from "@/shared/ui/Tooltip";

interface ToolbarProps {
  subfolderCount: number;
  fileCount: number;
  captionedCount: number;
  statsLoading?: boolean;
  searchQuery: string;
  searchRegex: boolean;
  sort: SortOption;
  filter: CaptionFilter;
  filterCounts: Record<CaptionFilter, number>;
  mediaTypeFilter: MediaTypeFilter;
  mediaTypeFilterCounts: Record<MediaTypeFilter, number>;
  onSearchQueryChange: (value: string) => void;
  onSearchRegexChange: (value: boolean) => void;
  onSortChange: (value: SortOption) => void;
  onFilterChange: (value: CaptionFilter) => void;
  onMediaTypeFilterChange: (value: MediaTypeFilter) => void;
}

interface ToolbarSearchProps {
  value: string;
  regex: boolean;
  onQueryChange: (value: string) => void;
  onRegexChange: (value: boolean) => void;
}

function filterCountLabel(ariaLabel: string, count: number, searchQuery: string): string {
  const trimmedSearch = searchQuery.trim();
  if (!trimmedSearch) {
    return `${ariaLabel} (${count})`;
  }

  return `${ariaLabel} (${count} matching "${trimmedSearch}")`;
}

function ToolbarSearch({ value, regex, onQueryChange, onRegexChange }: ToolbarSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const hasValue = value.trim().length > 0;
  const expanded = focused || value.length > 0;

  const openSearch = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      if (getScrollLockDepth() > 0) return;

      event.preventDefault();
      openSearch();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Tooltip
      content={
        hasValue
          ? `Search active: "${value.trim()}". Matches file names and captions.`
          : "Search by file name, folder name, or caption (optional regex)"
      }
      disabled={expanded && focused}
    >
      <label
        className={[
          "toolbar__search",
          expanded ? "toolbar__search--expanded" : "toolbar__search--collapsed",
          hasValue ? "toolbar__search--filtering" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!expanded) {
            openSearch();
          }
        }}
      >
        <Icon icon={iconSearch} className="toolbar__search-icon" />
        <span className="toolbar__search-field">
          <input
            ref={inputRef}
            type="search"
            className="toolbar__search-input"
            value={value}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search..."
            aria-label="Search files and folders by name or caption"
            aria-keyshortcuts="Control+K Meta+K"
          />
          <button
            type="button"
            className={`toolbar__search-regex ${regex ? "toolbar__search-regex--active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRegexChange(!regex)}
            aria-label="Toggle regular expression search"
            aria-pressed={regex}
            tabIndex={-1}
          >
            .*
          </button>
          {hasValue && (
            <button
              type="button"
              className="toolbar__search-clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              tabIndex={-1}
            >
              <Icon icon={iconX} className="toolbar__search-clear-icon" />
            </button>
          )}
        </span>
      </label>
    </Tooltip>
  );
}

function StatValue({ loading, value }: { loading?: boolean; value: number }) {
  if (loading) {
    return <span className="stat__value-skeleton skeleton-shimmer" aria-hidden="true" />;
  }

  return <strong>{value}</strong>;
}

export function Toolbar({
  subfolderCount,
  fileCount,
  captionedCount,
  statsLoading = false,
  searchQuery,
  searchRegex,
  sort,
  filter,
  filterCounts,
  mediaTypeFilter,
  mediaTypeFilterCounts,
  onSearchQueryChange,
  onSearchRegexChange,
  onSortChange,
  onFilterChange,
  onMediaTypeFilterChange,
}: ToolbarProps) {
  const allCaptioned = captionedCount === fileCount;
  const captionPercent =
    fileCount > 0 && !statsLoading ? Math.round((captionedCount / fileCount) * 100) : null;
  const captionedTooltip =
    captionPercent != null
      ? `${captionedCount} captioned (${captionPercent}%)`
      : `${captionedCount} captioned`;
  return (
    <div className="toolbar">
      <div
        className={`toolbar__stats${statsLoading ? " toolbar__stats--loading" : ""}`}
        aria-busy={statsLoading || undefined}
        aria-live="polite"
      >
        <Tooltip content={`${subfolderCount} folders`}>
          <span className="stat" aria-label={`${subfolderCount} folders`}>
            <Icon icon={iconFolder} className="stat__icon" />
            <StatValue loading={statsLoading} value={subfolderCount} />
          </span>
        </Tooltip>
        <Tooltip content={`${fileCount} files`}>
          <span className="stat" aria-label={`${fileCount} files`}>
            <Icon icon={iconImages} className="stat__icon" />
            <StatValue loading={statsLoading} value={fileCount} />
          </span>
        </Tooltip>
        <Tooltip content={captionedTooltip}>
          <span
            className={`stat stat--${allCaptioned ? "success" : "warning"}`}
            aria-label={captionedTooltip}
          >
            <Icon icon={iconMessageCheck} className="stat__icon" />
            <StatValue loading={statsLoading} value={captionedCount} />
            {captionPercent != null && (
              <span className="stat__percent" aria-hidden="true">
                ({captionPercent}%)
              </span>
            )}
          </span>
        </Tooltip>
      </div>

      <div className="toolbar__controls">
        <ToolbarSearch
          value={searchQuery}
          regex={searchRegex}
          onQueryChange={onSearchQueryChange}
          onRegexChange={onSearchRegexChange}
        />

        <Tooltip content="Sort files by name, date, caption, or total megapixels">
          <label className="toolbar__sort">
            <Icon icon={iconArrowDownWideNarrow} className="toolbar__sort-icon" />
            <select
              className="toolbar__sort-select"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as SortOption)}
              aria-label="Sort media"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </Tooltip>

        <div className="toolbar__filters" role="group" aria-label="Filter by media type">
          {MEDIA_TYPE_FILTER_OPTIONS.map(({ value, label, ariaLabel, icon }) => {
            const count = mediaTypeFilterCounts[value];
            const countLabel = filterCountLabel(ariaLabel, count, searchQuery);
            return (
              <Tooltip key={value} content={countLabel}>
                <button
                  type="button"
                  className={`filter-btn filter-btn--icon-only ${mediaTypeFilter === value ? "filter-btn--active" : ""}`}
                  onClick={() => onMediaTypeFilterChange(value)}
                  aria-label={countLabel}
                  aria-pressed={mediaTypeFilter === value}
                >
                  <Icon icon={icon} className="filter-btn__icon" />
                  <span className="filter-btn__label">{label}</span>
                  <span className="filter-btn__count" aria-hidden="true">
                    {count}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>

        <div className="toolbar__filters" role="group" aria-label="Filter by caption status">
          {FILTER_OPTIONS.map(({ value, label, ariaLabel, icon }) => {
            const count = filterCounts[value];
            const countLabel = filterCountLabel(ariaLabel, count, searchQuery);
            return (
              <Tooltip key={value} content={countLabel}>
                <button
                  type="button"
                  className={`filter-btn filter-btn--icon-only ${filter === value ? "filter-btn--active" : ""}`}
                  onClick={() => onFilterChange(value)}
                  aria-label={countLabel}
                  aria-pressed={filter === value}
                >
                  <Icon icon={icon} className="filter-btn__icon" />
                  <span className="filter-btn__label">{label}</span>
                  <span className="filter-btn__count" aria-hidden="true">
                    {count}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>

        <JobsButton />
      </div>
    </div>
  );
}
