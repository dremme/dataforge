import { useCallback, useState } from "react";
import { openFolderInExplorer } from "@/features/folder/api/folders";
import { formatApiError } from "@/shared/api/http";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import {
  iconArrowUpRight,
  iconChevronRight,
  iconCopy,
  iconFolderOpen,
  iconLoader2,
} from "@/shared/icons";
import type { Breadcrumb } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { OpenFolderModal } from "./OpenFolderModal";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface BreadcrumbBarProps {
  breadcrumbs: Breadcrumb[];
  currentFolder: string;
  folderNotFound?: boolean;
  onNavigate: (path: string) => void;
}

export function BreadcrumbBar({
  breadcrumbs,
  currentFolder,
  folderNotFound = false,
  onNavigate,
}: BreadcrumbBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openingInExplorer, setOpeningInExplorer] = useState(false);
  const [explorerError, setExplorerError] = useState<string | null>(null);
  const { copyState, copyText } = useCopyFeedback();

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

  const handleCopyPath = useCallback(() => {
    if (folderNotFound || !currentFolder) return;
    void copyText(currentFolder);
  }, [copyText, currentFolder, folderNotFound]);

  const copyPathLabel =
    copyState === "copied" ? "Copied!" : copyState === "error" ? "Failed!" : "Copy path";

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
                    className={classNames(
                      "breadcrumbs__current",
                      folderNotFound && "breadcrumbs__current--not-found",
                    )}
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
          <Tooltip content={folderNotFound ? "Folder not found" : copyPathLabel}>
            <button
              type="button"
              className="breadcrumbs__explorer"
              onClick={handleCopyPath}
              disabled={folderNotFound || !currentFolder}
              aria-label={copyPathLabel}
            >
              <Icon icon={iconCopy} className="breadcrumbs__explorer-icon" />
            </button>
          </Tooltip>

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
                className={classNames(
                  "breadcrumbs__explorer-icon",
                  openingInExplorer && "breadcrumbs__explorer-icon--spin",
                )}
              />
            </button>
          </Tooltip>
        </div>
      </nav>

      {pickerOpen && (
        <OpenFolderModal
          currentFolder={currentFolder}
          onClose={() => setPickerOpen(false)}
          onOpenFolder={onNavigate}
        />
      )}
    </>
  );
}
