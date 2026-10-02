import { useId, useMemo, useRef, useState } from "react";
import { fetchFolderReviewCounts } from "@/features/folder/api/folders";
import { clampFolders, folderCardLabel, folderFindings } from "@/features/folder/lib/folderCards";
import { readFolderExpanded, writeFolderExpanded } from "@/features/folder/lib/folderExpansion";
import {
  iconChevronDown,
  iconChevronUp,
  iconFolder,
  iconFolderPlus,
  iconFolderTree,
  iconImage,
  iconTriangleAlert,
} from "@/shared/icons";
import { formatCount } from "@/shared/lib/format";
import type { FolderReviewCountsResponse, Subfolder } from "@/shared/types";
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
      {folderFindings(folder).length > 0 && (
        <Icon icon={iconTriangleAlert} className="folder-card__issue-icon" aria-hidden="true" />
      )}
    </span>
  );
}

/** Long enough that sweeping the pointer across the grid does not flash a bubble per card. */
const FOLDER_TOOLTIP_DELAY_MS = 1000;

function countLabel(count: number, singular: string, plural: string): string {
  if (count === 0) return `No ${plural}`;
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function FolderCard({ folder, onOpen }: { folder: Subfolder; onOpen: (path: string) => void }) {
  const [counts, setCounts] = useState<FolderReviewCountsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const loadingRef = useRef(false);

  // Fetched on every hover rather than once, so a job that ran meanwhile is reflected; the
  // bubble's delay leaves the request time to land before anything shows.
  const loadCounts = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    fetchFolderReviewCounts(folder.path)
      .then(
        (next) => {
          setCounts(next);
          setFailed(false);
        },
        () => setFailed(true),
      )
      .finally(() => {
        loadingRef.current = false;
      });
  };

  const tooltip = (
    <span className="folder-card__tip">
      <span className="folder-card__tip-name">{folder.name}</span>
      {counts ? (
        <>
          <span>{countLabel(counts.issue_count, "caption issue", "caption issues")}</span>
          <span>{countLabel(counts.candidate_count, "staged candidate", "staged candidates")}</span>
        </>
      ) : (
        <span className="folder-card__tip-pending">
          {failed ? "Counts unavailable" : "Counting..."}
        </span>
      )}
    </span>
  );

  return (
    <Tooltip content={tooltip} delay={FOLDER_TOOLTIP_DELAY_MS} className="folder-grid__cell">
      <button
        type="button"
        className="folder-card"
        onClick={() => onOpen(folder.path)}
        onMouseEnter={loadCounts}
        onFocus={loadCounts}
        aria-label={folderCardLabel(folder)}
      >
        <Icon icon={iconFolder} className="folder-card__icon" />
        <span className="folder-card__body">
          <span className="folder-card__name">{folder.name}</span>
          {folder.file_count !== 0 && <FolderCardStats folder={folder} />}
        </span>
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
  onCreateFolder?: () => void;
  createFolderDisabled?: boolean;
}

export function FolderGrid({
  folders,
  folderPath,
  totalCount,
  onOpen,
  onCreateFolder,
  createFolderDisabled = false,
}: FolderGridProps) {
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
        actions={
          onCreateFolder ? (
            <div className="folder-controls">
              <button
                type="button"
                className="folder-controls__btn"
                onClick={onCreateFolder}
                disabled={createFolderDisabled}
              >
                <Icon icon={iconFolderPlus} className="folder-controls__btn-icon" />
                New
              </button>
            </div>
          ) : undefined
        }
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
