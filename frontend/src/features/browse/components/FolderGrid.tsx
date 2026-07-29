import {
  iconFolder,
  iconFolderPlus,
  iconFolderTree,
  iconImages,
  iconTriangleAlert,
} from "@/shared/icons";
import type { Subfolder } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { SectionHeader } from "@/shared/ui/SectionHeader";

function FolderCardStats({ folder }: { folder: Subfolder }) {
  const allCaptioned = folder.captioned_count === folder.file_count;
  return (
    <span
      className={`folder-card__stat folder-card__stat--${allCaptioned ? "success" : "warning"}`}
    >
      <Icon icon={iconImages} className="folder-card__stat-icon" />
      <strong>{folder.captioned_count}</strong> / {folder.file_count} captioned
      {folder.issue_count > 0 && (
        <Icon icon={iconTriangleAlert} className="folder-card__issue-icon" aria-hidden="true" />
      )}
    </span>
  );
}

function folderCardLabel(folder: Subfolder): string {
  if (folder.issue_count > 0) {
    const issueLabel =
      folder.issue_count === 1 ? "1 caption issue" : `${folder.issue_count} caption issues`;
    return `${folder.name} (${issueLabel})`;
  }
  return folder.name;
}

interface FolderGridProps {
  /** Folders left after the search; `totalCount` carries the unfiltered size. */
  folders: Subfolder[];
  totalCount?: number;
  onOpen: (path: string) => void;
  onCreateFolder?: () => void;
  createFolderDisabled?: boolean;
}

export function FolderGrid({
  folders,
  totalCount,
  onOpen,
  onCreateFolder,
  createFolderDisabled = false,
}: FolderGridProps) {
  // The header stays put even with nothing to list, so the count is always readable.
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
        <div className="folder-grid">
          {folders.map((folder) => (
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
                {folder.file_count > 0 && <FolderCardStats folder={folder} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
