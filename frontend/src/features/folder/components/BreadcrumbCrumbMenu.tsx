import { useEffect, useRef, useState } from "react";
import { fetchFolderChildren } from "@/features/folder/api/folders";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import { formatApiError } from "@/shared/api/http";
import { MENU_VIEWPORT_GUTTER, useMenuViewportFit } from "@/shared/hooks/useMenuViewportFit";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconChevronRight, iconFolder } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { horizontalViewportShift } from "@/shared/lib/viewportShift";
import type { FolderChild } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";

/**
 * Roughly ten rows. A folder can hold hundreds of children, and a list that runs
 * the height of the window reads as a page rather than as a menu — past this the
 * panel scrolls instead of growing.
 */
const MENU_MAX_HEIGHT = 320;

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
  const { open, close, menuId, rootRef, triggerProps } = usePopupMenu();
  const menuRef = useRef<HTMLDivElement>(null);
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

  // The panel hangs off a crumb, so the room it has depends on where in the bar
  // that crumb sits — a deep path pushes the last chevron far right. Its width is
  // already capped against the window in CSS (a JS cap would lose to the panel's
  // own min-width anyway); what JS adds is a height that stops at MENU_MAX_HEIGHT
  // or the bottom of the window — whichever comes first — and a nudge back inside
  // when the anchor leaves the panel overhanging an edge.
  const bounds = useMenuViewportFit(menuRef, open, (node) => {
    // Measure unshifted — reading back our own nudge would compound it.
    const applied = node.style.transform;
    node.style.transform = "none";
    const { top, left, width } = node.getBoundingClientRect();
    node.style.transform = applied;

    const shift = horizontalViewportShift({ left, width }, window.innerWidth, MENU_VIEWPORT_GUTTER);

    return {
      maxHeight: Math.min(
        MENU_MAX_HEIGHT,
        Math.max(0, window.innerHeight - top - MENU_VIEWPORT_GUTTER),
      ),
      transform: shift ? `translateX(${shift}px)` : undefined,
    };
  });

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

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="breadcrumbs__menu-panel"
          style={bounds}
          role="menu"
          aria-label={`Subfolders of ${label}`}
        >
          {status && <p className="breadcrumbs__menu-status">{status}</p>}
          {showEmpty && <p className="breadcrumbs__menu-status">No subfolders</p>}

          {children?.map((child) => {
            const isActive = activeChildPath
              ? folderPathsEqual(child.path, activeChildPath)
              : false;
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
        </div>
      )}
    </div>
  );
}
