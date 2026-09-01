import { useId, useMemo, useState } from "react";
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
import type { Subfolder } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { SectionHeader } from "@/shared/ui/SectionHeader";

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
            <button
              key={folder.path}
              type="button"
              className="folder-card"
              onClick={() => onOpen(folder.path)}
              title={folderCardLabel(folder)}
              aria-label={folderCardLabel(folder)}
            >
              <Icon icon={iconFolder} className="folder-card__icon" />
              <span className="folder-card__body">
                <span className="folder-card__name">{folder.name}</span>
                {folder.file_count !== 0 && <FolderCardStats folder={folder} />}
              </span>
            </button>
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
