import { useCallback, useState } from "react";
import { openFolderInExplorer } from "../api";
import { formatApiError } from "../api/http";
import {
  iconArrowUpRight,
  iconChevronRight,
  iconFolderOpen,
  iconFolderPlus,
  iconLoader2,
} from "../icons";
import type { Breadcrumb } from "../types";
import { FolderPickerModal } from "./FolderPickerModal";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

interface BreadcrumbBarProps {
  breadcrumbs: Breadcrumb[];
  currentFolder: string;
  folderNotFound?: boolean;
  onNavigate: (path: string) => void;
  onCreateFolder?: () => void;
}

export function BreadcrumbBar({
  breadcrumbs,
  currentFolder,
  folderNotFound = false,
  onNavigate,
  onCreateFolder,
}: BreadcrumbBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openingInExplorer, setOpeningInExplorer] = useState(false);
  const [explorerError, setExplorerError] = useState<string | null>(null);

  const handleOpenInExplorer = useCallback(async () => {
    if (openingInExplorer) return;

    setExplorerError(null);
    setOpeningInExplorer(true);

    try {
      await openFolderInExplorer(currentFolder);
    } catch (error) {
      setExplorerError(formatApiError(error));
    } finally {
      setOpeningInExplorer(false);
    }
  }, [currentFolder, openingInExplorer]);

  if (breadcrumbs.length === 0) return null;

  return (
    <>
      <nav className="breadcrumbs" aria-label="Folder path">
        <button
          type="button"
          className="breadcrumbs__picker"
          onClick={() => setPickerOpen(true)}
          title="Open another folder"
          aria-label="Open folder"
        >
          <Icon icon={iconFolderOpen} className="breadcrumbs__picker-icon" />
          Open folder
        </button>

        <ol className="breadcrumbs__list">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <li key={crumb.path} className="breadcrumbs__item">
                {index > 0 && <Icon icon={iconChevronRight} className="breadcrumbs__sep" />}
                {isLast ? (
                  <span
                    className={`breadcrumbs__current${folderNotFound ? " breadcrumbs__current--not-found" : ""}`}
                    aria-current="page"
                    title={crumb.path}
                  >
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="breadcrumbs__link"
                    onClick={() => onNavigate(crumb.path)}
                    title={crumb.path}
                  >
                    {crumb.name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        <div className="breadcrumbs__actions">
          {onCreateFolder && (
            <Tooltip content={folderNotFound ? "Folder not found" : "New folder"}>
              <button
                type="button"
                className="breadcrumbs__explorer"
                onClick={onCreateFolder}
                disabled={folderNotFound}
                aria-label="New folder"
              >
                <Icon icon={iconFolderPlus} className="breadcrumbs__explorer-icon" />
              </button>
            </Tooltip>
          )}

          <Tooltip
            content={
              folderNotFound ? "Folder not found" : (explorerError ?? "Open in File Explorer")
            }
          >
            <button
              type="button"
              className="breadcrumbs__explorer"
              onClick={() => {
                void handleOpenInExplorer();
              }}
              disabled={openingInExplorer || folderNotFound}
              aria-label="Open in File Explorer"
            >
              <Icon
                icon={openingInExplorer ? iconLoader2 : iconArrowUpRight}
                className={`breadcrumbs__explorer-icon${openingInExplorer ? " breadcrumbs__explorer-icon--spin" : ""}`}
              />
            </button>
          </Tooltip>
        </div>
      </nav>

      {pickerOpen && (
        <FolderPickerModal
          currentFolder={currentFolder}
          onClose={() => setPickerOpen(false)}
          onOpenFolder={onNavigate}
        />
      )}
    </>
  );
}
