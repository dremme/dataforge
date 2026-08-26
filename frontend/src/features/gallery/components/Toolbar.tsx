import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  SORT_OPTIONS,
  type FileFilter,
  type ItemFilter,
  type MediaTypeFilter,
  type SortOption,
} from "@/features/gallery/lib/query";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import {
  iconArchive,
  iconArrowDownWideNarrow,
  iconFolder,
  iconMessageCheck,
  iconMessageWarning,
  iconImages,
  iconRegex,
  iconSearch,
  iconTag,
  iconX,
} from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";
import { JobsButton } from "@/features/jobs/components/JobsButton";
import { StatsButton } from "./StatsButton";
import { Tooltip } from "@/shared/ui/Tooltip";
import { ToolbarFilterMenu } from "./ToolbarFilterMenu";

interface ToolbarProps {
  subfolderCount: number;
  fileCount: number;
  captionedCount: number;
  /** Files with a caption issue file; the stat stays hidden while there are none. */
  issueCount?: number;
  /** Whether the open folder has captions saved in `.backup`. */
  hasCaptionBackup?: boolean;
  statsLoading?: boolean;
  searchQuery: string;
  searchRegex: boolean;
  searchNames: boolean;
  sort: SortOption;
  filter: ItemFilter;
  filterCounts: Record<ItemFilter, number>;
  mediaTypeFilter: MediaTypeFilter;
  mediaTypeFilterCounts: Record<MediaTypeFilter, number>;
  fileFilter: FileFilter;
  fileFilterCounts: Record<FileFilter, number>;
  statsOpen: boolean;
  onToggleStats: () => void;
  onSearchQueryChange: (value: string) => void;
  onSearchRegexChange: (value: boolean) => void;
  onSearchNamesChange: (value: boolean) => void;
  onSortChange: (value: SortOption) => void;
  onFilterChange: (value: ItemFilter) => void;
  onMediaTypeFilterChange: (value: MediaTypeFilter) => void;
  onFileFilterChange: (value: FileFilter) => void;
}

interface ToolbarSearchProps {
  value: string;
  regex: boolean;
  names: boolean;
  onQueryChange: (value: string) => void;
  onRegexChange: (value: boolean) => void;
  onNamesChange: (value: boolean) => void;
}

function ToolbarSearch({
  value,
  regex,
  names,
  onQueryChange,
  onRegexChange,
  onNamesChange,
}: ToolbarSearchProps) {
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
    <Tooltip content="Search names and captions, regex optional" disabled={expanded && focused}>
      <label
        className={classNames(
          "toolbar__search",
          expanded ? "toolbar__search--expanded" : "toolbar__search--collapsed",
          hasValue && "toolbar__search--filtering",
        )}
        // Drives how far the expanded field grows; the width itself is clamped in CSS.
        style={{ "--toolbar-search-length": value.length } as CSSProperties}
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
            aria-label={names ? "Search files and folders by name or caption" : "Search captions"}
            aria-keyshortcuts="Control+K Meta+K"
          />
          <button
            type="button"
            className={classNames(
              "toolbar__search-names",
              names && "toolbar__search-names--active",
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onNamesChange(!names)}
            aria-label="Match file and folder names"
            aria-pressed={names}
            tabIndex={-1}
          >
            <Icon icon={iconTag} className="toolbar__search-names-icon" />
          </button>
          <button
            type="button"
            className={classNames(
              "toolbar__search-regex",
              regex && "toolbar__search-regex--active",
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onRegexChange(!regex)}
            aria-label="Toggle regular expression search"
            aria-pressed={regex}
            tabIndex={-1}
          >
            <Icon icon={iconRegex} className="toolbar__search-regex-icon" />
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
  issueCount = 0,
  hasCaptionBackup = false,
  statsLoading = false,
  searchQuery,
  searchRegex,
  searchNames,
  sort,
  filter,
  filterCounts,
  mediaTypeFilter,
  mediaTypeFilterCounts,
  fileFilter,
  fileFilterCounts,
  statsOpen,
  onToggleStats,
  onSearchQueryChange,
  onSearchRegexChange,
  onSearchNamesChange,
  onSortChange,
  onFilterChange,
  onMediaTypeFilterChange,
  onFileFilterChange,
}: ToolbarProps) {
  const allCaptioned = captionedCount === fileCount;
  const captionPercent =
    fileCount > 0 && !statsLoading ? Math.round((captionedCount / fileCount) * 100) : null;
  const captionedTooltip =
    captionPercent != null
      ? `${captionedCount} captioned (${captionPercent}%)`
      : `${captionedCount} captioned`;
  const issueTooltip = `${issueCount} caption ${issueCount === 1 ? "issue" : "issues"}`;
  const issueFilterActive = filter === "issue";
  const captionedFilterActive = filter === "captioned";
  // Both counts toggle their own filter, so a second click restores every file.
  const filterHint = (active: boolean, only: string) =>
    active ? "click to clear the filter" : `click to show only ${only}`;
  return (
    <div className="toolbar">
      <div
        className={classNames("toolbar__stats", statsLoading && "toolbar__stats--loading")}
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
        <Tooltip
          content={`${captionedTooltip} — ${filterHint(captionedFilterActive, "captioned files")}`}
        >
          <span
            className={classNames(
              `stat stat--${allCaptioned ? "success" : "warning"}`,
              "stat--filter",
            )}
            aria-label={captionedTooltip}
            onClick={() => onFilterChange(captionedFilterActive ? "all" : "captioned")}
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
        {issueCount > 0 && (
          <Tooltip
            content={`${issueTooltip} — ${filterHint(issueFilterActive, "files with issues")}`}
          >
            <span
              className="stat stat--warning stat--filter"
              aria-label={issueTooltip}
              onClick={() => onFilterChange(issueFilterActive ? "all" : "issue")}
            >
              <Icon icon={iconMessageWarning} className="stat__icon" />
              <StatValue loading={statsLoading} value={issueCount} />
            </span>
          </Tooltip>
        )}
        {hasCaptionBackup && (
          <Tooltip content="This folder has backed up captions">
            <span className="stat stat--backup" aria-label="This folder has backed up captions">
              <Icon icon={iconArchive} className="stat__icon" />
            </span>
          </Tooltip>
        )}
      </div>

      <div className="toolbar__controls">
        <ToolbarSearch
          value={searchQuery}
          regex={searchRegex}
          names={searchNames}
          onQueryChange={onSearchQueryChange}
          onRegexChange={onSearchRegexChange}
          onNamesChange={onSearchNamesChange}
        />

        <Tooltip content="Sort files by name, date, caption, megapixels, or duration">
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

        <ToolbarFilterMenu
          searchQuery={searchQuery}
          filter={filter}
          filterCounts={filterCounts}
          mediaTypeFilter={mediaTypeFilter}
          mediaTypeFilterCounts={mediaTypeFilterCounts}
          fileFilter={fileFilter}
          fileFilterCounts={fileFilterCounts}
          onFilterChange={onFilterChange}
          onMediaTypeFilterChange={onMediaTypeFilterChange}
          onFileFilterChange={onFileFilterChange}
        />

        <StatsButton open={statsOpen} onToggle={onToggleStats} />

        <JobsButton />
      </div>
    </div>
  );
}
