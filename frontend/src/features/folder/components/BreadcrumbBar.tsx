import { useCallback, useState } from "react";
import { openFolderInExplorer } from "@/features/folder/api/folders";
import { formatApiError } from "@/shared/api/http";
import { useCopyFeedback } from "@/shared/hooks/useCopyFeedback";
import {
  iconArrowUpRight,
  iconCheck,
  iconCopy,
  iconFolderOpen,
  iconLoader2,
  iconX,
} from "@/shared/icons";
import type { Breadcrumb } from "@/shared/types";
import { classNames } from "@/shared/lib/classNames";
import { BreadcrumbCrumbMenu } from "./BreadcrumbCrumbMenu";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface BreadcrumbBarProps {
  breadcrumbs: Breadcrumb[];
  currentFolder: string;
  hasSubfolders: boolean;
  folderNotFound?: boolean;
  onNavigate: (path: string) => void;
  onOpenPicker: () => void;
}

export function BreadcrumbBar({
  breadcrumbs,
  currentFolder,
  hasSubfolders,
  folderNotFound = false,
  onNavigate,
  onOpenPicker,
}: BreadcrumbBarProps) {
  const [openingInExplorer, setOpeningInExplorer] = useState(false);
  const [explorerError, setExplorerError] = useState<string | null>(null);
  const { copyState, copyLabel, copyText } = useCopyFeedback();

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

  const copyPathLabel = copyState === "idle" ? "Copy path" : copyLabel;
  const copyPathIcon =
    copyState === "copied" ? iconCheck : copyState === "error" ? iconX : iconCopy;

  if (breadcrumbs.length === 0) return null;

  return (
    <nav className="breadcrumbs" aria-label="Folder path">
      <button
        type="button"
        className="breadcrumbs__picker"
        onClick={onOpenPicker}
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
              {/* The chevron trails its own crumb, so it lists that crumb's children —
                    and the last crumb gets one too, for drilling down, unless the
                    folder is a leaf and the dropdown would open on nothing. */}
              {(!isLast || (hasSubfolders && !folderNotFound)) && (
                <BreadcrumbCrumbMenu
                  folderPath={crumb.path}
                  label={crumb.name}
                  activeChildPath={breadcrumbs[index + 1]?.path}
                  onNavigate={onNavigate}
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="breadcrumbs__actions">
        <Tooltip
          content={folderNotFound ? "Folder not found" : copyPathLabel}
          open={copyState !== "idle"}
        >
          <button
            type="button"
            className={classNames(
              "breadcrumbs__explorer",
              copyState === "copied" && "breadcrumbs__explorer--copied",
              copyState === "error" && "breadcrumbs__explorer--error",
            )}
            onClick={handleCopyPath}
            disabled={folderNotFound || !currentFolder}
            aria-label={copyPathLabel}
          >
            <Icon icon={copyPathIcon} className="breadcrumbs__explorer-icon" />
          </button>
        </Tooltip>

        <Tooltip
          content={folderNotFound ? "Folder not found" : (explorerError ?? "Open in File Explorer")}
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
  );
}
