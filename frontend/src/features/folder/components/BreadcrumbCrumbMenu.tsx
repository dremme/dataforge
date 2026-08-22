import { useEffect, useState } from "react";
import { fetchFolderChildren } from "@/features/folder/api/folders";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import { formatApiError } from "@/shared/api/http";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconChevronRight, iconFolder } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { FolderChild } from "@/shared/types";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";

interface BreadcrumbCrumbMenuProps {
  /** Folder whose immediate children this menu lists. */
  folderPath: string;
  /** Crumb name, for the accessible label. */
  label: string;
  /** The next crumb along — the child the user is currently inside, if any. */
  activeChildPath?: string;
  onNavigate: (path: string) => void;
}

function sortChildren(children: FolderChild[]): FolderChild[] {
  return [...children].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * The chevron that follows a breadcrumb, opening its subfolders as a flat list —
 * the Windows Explorer gesture. Every crumb gets one, including the last, so the
 * bar can drill down as well as back up.
 */
export function BreadcrumbCrumbMenu({
  folderPath,
  label,
  activeChildPath,
  onNavigate,
}: BreadcrumbCrumbMenuProps) {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const [children, setChildren] = useState<FolderChild[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Folders change on disk, so every open refetches. The previous list stays on
  // screen while the request is in flight — reopening should not flash empty.
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    setLoading(true);

    fetchFolderChildren(folderPath, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setChildren(sortChildren(data.children));
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(formatApiError(cause));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => controller.abort();
  }, [folderPath, open]);

  // Drop a stale list when the crumb itself changes underneath us.
  useEffect(() => {
    setChildren(null);
    setError(null);
  }, [folderPath]);

  const handleSelect = (path: string) => {
    close();
    onNavigate(path);
  };

  const status = error ?? (children === null && loading ? "Loading..." : null);
  const showEmpty = !status && children !== null && children.length === 0;

  return (
    <div ref={rootRef} className="breadcrumbs__menu">
      <button
        type="button"
        className="breadcrumbs__sep-btn"
        aria-label={`Subfolders of ${label}`}
        {...triggerProps}
      >
        <Icon
          icon={iconChevronRight}
          className={classNames("breadcrumbs__sep", open && "breadcrumbs__sep--open")}
        />
      </button>

      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        placement="bottom-start"
        id={menuId}
        className="breadcrumbs__menu-panel"
        role="menu"
        label={`Subfolders of ${label}`}
      >
        {status && <p className="breadcrumbs__menu-status">{status}</p>}
        {showEmpty && <p className="breadcrumbs__menu-status">No subfolders</p>}

        {children?.map((child) => {
          const isActive = activeChildPath ? folderPathsEqual(child.path, activeChildPath) : false;
          return (
            <button
              key={child.path}
              type="button"
              role="menuitem"
              className={classNames(
                "breadcrumbs__menu-option",
                isActive && "breadcrumbs__menu-option--active",
              )}
              aria-current={isActive ? "true" : undefined}
              title={child.path}
              onClick={() => handleSelect(child.path)}
            >
              <Icon icon={iconFolder} className="breadcrumbs__menu-option-icon" />
              <span className="breadcrumbs__menu-option-label">{child.name}</span>
            </button>
          );
        })}
      </AnchoredLayer>
    </div>
  );
}
