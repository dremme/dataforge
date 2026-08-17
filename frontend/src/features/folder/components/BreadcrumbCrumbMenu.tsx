import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { fetchFolderChildren } from "@/features/folder/api/folders";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import { formatApiError } from "@/shared/api/http";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { iconChevronRight, iconFolder } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import type { FolderChild } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";

/** Breathing room between the open menu and the edges of the window. */
const MENU_VIEWPORT_GUTTER = 16;

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
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FolderChild[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bounds, setBounds] = useState<{ maxHeight: number; transform?: string }>();

  const close = useCallback(() => setOpen(false), []);

  useEscapeKey(close, open);

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
  // when the anchor leaves the panel overhanging the right edge.
  useLayoutEffect(() => {
    if (!open) {
      setBounds(undefined);
      return;
    }

    const fitToViewport = () => {
      const node = menuRef.current;
      if (!node) return;

      // Measure unshifted — reading back our own nudge would compound it.
      const applied = node.style.transform;
      node.style.transform = "none";
      const { top, left, width } = node.getBoundingClientRect();
      node.style.transform = applied;

      const overhang = left + width - (window.innerWidth - MENU_VIEWPORT_GUTTER);
      const shift = overhang > 0 ? Math.min(overhang, Math.max(0, left - MENU_VIEWPORT_GUTTER)) : 0;

      setBounds({
        maxHeight: Math.min(
          MENU_MAX_HEIGHT,
          Math.max(0, window.innerHeight - top - MENU_VIEWPORT_GUTTER),
        ),
        transform: shift ? `translateX(${-shift}px)` : undefined,
      });
    };

    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [close, open]);

  const handleSelect = (path: string) => {
    close();
    onNavigate(path);
  };

  const status = error ?? (children === null && loading ? "Loading…" : null);
  const showEmpty = !status && children !== null && children.length === 0;

  return (
    <div ref={rootRef} className="breadcrumbs__menu">
      <button
        type="button"
        className="breadcrumbs__sep-btn"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Subfolders of ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
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
