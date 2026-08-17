import {
  iconFolder,
  iconFolderPlus,
  iconFolderTree,
  iconImage,
  iconTriangleAlert,
} from "@/shared/icons";
import type { Subfolder } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { SectionHeader } from "@/shared/ui/SectionHeader";

/**
 * What the card is warning about, in the words its label uses.
 *
 * Caption issues and duplicates are counted from separate sidecars and one file can
 * carry both, so they stay two clauses instead of one total: a sum could claim more
 * findings than the folder has files.
 *
 * Each count is read on its own rather than requiring both to have arrived. A folder
 * with caption issues has to keep warning while its duplicate count is still null -
 * gating on both would drop the warning it used to show.
 */
function folderFindings({ issue_count: issues, duplicate_count: duplicates }: Subfolder): string[] {
  const findings: string[] = [];
  if (issues) findings.push(issues === 1 ? "1 caption issue" : `${issues} caption issues`);
  if (duplicates) findings.push(duplicates === 1 ? "1 duplicate" : `${duplicates} duplicates`);
  return findings;
}

function FolderCardStats({ folder }: { folder: Subfolder }) {
  const { file_count: fileCount, captioned_count: captionedCount } = folder;

  // Counts arrive after the cards do. The slot keeps its height either way, so
  // nothing reflows underneath the pointer once the numbers land.
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
      {/* Same source as the label, so the icon cannot appear unexplained. */}
      {folderFindings(folder).length > 0 && (
        <Icon icon={iconTriangleAlert} className="folder-card__issue-icon" aria-hidden="true" />
      )}
    </span>
  );
}

/** The warning icon is `aria-hidden`, so this is the only place it gets explained. */
function folderCardLabel(folder: Subfolder): string {
  const findings = folderFindings(folder);
  return findings.length > 0 ? `${folder.name} (${findings.join(", ")})` : folder.name;
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
                {folder.file_count !== 0 && <FolderCardStats folder={folder} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
