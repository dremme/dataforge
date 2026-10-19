import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFolderPrefetch } from "@/features/folder/hooks/useFolderPrefetch";
import { useOpenFolderInNewTab } from "@/features/folder/hooks/useOpenFolderInNewTab";
import { clampFolders, folderCardLabel } from "@/features/folder/lib/folderCards";
import { readFolderExpanded, writeFolderExpanded } from "@/features/folder/lib/folderExpansion";
import { folderReviewCountsQueryOptions } from "@/features/folder/lib/folderQuery";
import {
  iconChevronDown,
  iconChevronUp,
  iconFiles,
  iconFolder,
  iconFolderOpen,
  iconFolderTree,
  iconImage,
  iconScanSquare,
  iconTriangleAlert,
} from "@/shared/icons";
import { formatCount } from "@/shared/lib/format";
import type { Subfolder } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { SectionHeader } from "@/shared/ui/SectionHeader";
import { Tooltip } from "@/shared/ui/Tooltip";

function FolderCardStats({ folder }: { folder: Subfolder }) {
  const { file_count: fileCount, captioned_count: captionedCount } = folder;

  if (fileCount === null || captionedCount === null) {
    return (
      <span className="folder-card__stat folder-card__stat--pending" aria-hidden="true">
        <Icon icon={iconImage} className="folder-card__stat-icon" />
        <span className="folder-card__stat-placeholder" />
      </span>
    );
  }

  const allCaptioned = captionedCount === fileCount;
  return (
    <span
      className={`folder-card__stat folder-card__stat--${allCaptioned ? "success" : "warning"}`}
    >
      <Icon icon={iconImage} className="folder-card__stat-icon" />
      <strong>{captionedCount}</strong> / {fileCount} captioned
    </span>
  );
}

function FolderCardFindings({ folder }: { folder: Subfolder }) {
  const { issue_count: issues } = folder;
  if (!issues) return null;

  return (
    <span className="folder-card__findings" aria-hidden="true">
      <span className="folder-card__finding folder-card__finding--issue">
        <Icon icon={iconTriangleAlert} className="folder-card__finding-icon" />
        {formatCount(issues)}
      </span>
    </span>
  );
}

function FolderCardCoverage({ folder }: { folder: Subfolder }) {
  const { file_count: fileCount, captioned_count: captionedCount } = folder;
  if (!fileCount || typeof captionedCount !== "number") return null;

  const tone = captionedCount === fileCount ? "success" : "warning";
  return (
    <span className={`folder-card__coverage folder-card__coverage--${tone}`} aria-hidden="true">
      <span
        className="folder-card__coverage-fill"
        style={{ width: `${(captionedCount / fileCount) * 100}%` }}
      />
    </span>
  );
}

function countLabel(count: number, singular: string, plural: string): string {
  if (count === 0) return `No ${plural}`;
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function FolderCard({ folder, onOpen }: { folder: Subfolder; onOpen: (path: string) => void }) {
  const prefetch = useFolderPrefetch();
  const openInNewTab = useOpenFolderInNewTab();
  // Read on every hover rather than once, so a job that ran meanwhile is reflected; the
  // bubble's delay leaves the request time to land before anything shows.
  const {
    data: counts,
    isError: failed,
    refetch,
  } = useQuery({ ...folderReviewCountsQueryOptions(folder.path), enabled: false });
  const loadCounts = () => void refetch({ cancelRefetch: false });

  const tooltip = (
    <span className="folder-card__tip">
      <span className="folder-card__tip-name">{folder.name}</span>
      {counts ? (
        <div className="folder-card__tip-counts">
          <span>
            <Icon icon={iconTriangleAlert} />{" "}
            {countLabel(counts.issue_count, "caption issue", "caption issues")}
          </span>
          <span>
            <Icon icon={iconScanSquare} />{" "}
            {countLabel(counts.candidate_count, "staged candidate", "staged candidates")}
          </span>
          <span>
            <Icon icon={iconFiles} />{" "}
            {countLabel(counts.duplicate_count, "duplicate", "duplicates")}
          </span>
        </div>
      ) : (
        <span className="folder-card__tip-pending">
          {failed ? "Counts unavailable" : "Counting..."}
        </span>
      )}
    </span>
  );

  return (
    <Tooltip content={tooltip} className="folder-grid__cell">
      <button
        type="button"
        className="folder-card"
        onClick={() => onOpen(folder.path)}
        {...prefetch(folder.path)}
        {...openInNewTab(folder.path)}
        onMouseEnter={loadCounts}
        onFocus={loadCounts}
        aria-label={folderCardLabel(folder)}
      >
        <span className="folder-card__tile" aria-hidden="true">
          <Icon icon={iconFolder} className="folder-card__icon folder-card__icon--closed" />
          <Icon icon={iconFolderOpen} className="folder-card__icon folder-card__icon--open" />
        </span>
        <span className="folder-card__body">
          <span className="folder-card__head">
            <span className="folder-card__name">{folder.name}</span>
            <FolderCardFindings folder={folder} />
          </span>
          {folder.file_count !== 0 && <FolderCardStats folder={folder} />}
        </span>
        <FolderCardCoverage folder={folder} />
      </button>
    </Tooltip>
  );
}

interface FolderGridProps {
  folders: Subfolder[];
  /** Which folder these are the children of, so the expansion is remembered against it. */
  folderPath?: string;
  totalCount?: number;
  onOpen: (path: string) => void;
}

export function FolderGrid({ folders, folderPath, totalCount, onOpen }: FolderGridProps) {
  // Seeded once per mount, and the call site remounts on navigation, so the stored choice is
  // read for the folder being opened rather than carried over from the previous one.
  const [expanded, setExpanded] = useState(() => readFolderExpanded(folderPath));
  const gridId = useId();
  const clamp = useMemo(() => clampFolders(folders), [folders]);
  const shown = expanded ? folders : clamp.visible;

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    writeFolderExpanded(folderPath, next);
  };

  return (
    <section className="folder-section" aria-label="Subfolders">
      <SectionHeader
        section="folder"
        icon={iconFolderTree}
        title="Folders"
        count={folders.length}
        total={totalCount}
      />
      {folders.length > 0 && (
        <div className="folder-grid" id={gridId}>
          {shown.map((folder) => (
            <FolderCard key={folder.path} folder={folder} onOpen={onOpen} />
          ))}
        </div>
      )}
      {clamp.hidden > 0 && (
        <div className="folder-more">
          <button
            type="button"
            className="folder-more__btn"
            aria-expanded={expanded}
            aria-controls={gridId}
            onClick={toggleExpanded}
          >
            <Icon icon={expanded ? iconChevronUp : iconChevronDown} className="folder-more__icon" />
            {expanded ? "Show fewer folders" : `Show ${clamp.hidden} more folders`}
            {!expanded && clamp.hiddenFlagged > 0 && (
              <span className="folder-more__findings">
                <Icon icon={iconTriangleAlert} className="folder-more__findings-icon" />
                {clamp.hiddenFlagged} need review
              </span>
            )}
          </button>
        </div>
      )}
    </section>
  );
}
