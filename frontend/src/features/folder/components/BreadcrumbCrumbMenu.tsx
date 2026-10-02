import { useQuery } from "@tanstack/react-query";
import { useFolderPrefetch } from "@/features/folder/hooks/useFolderPrefetch";
import { folderPathsEqual } from "@/features/folder/lib/folderPath";
import { folderChildrenQueryOptions } from "@/features/folder/lib/folderQuery";
import { formatApiError } from "@/shared/api/http";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { iconChevronRight, iconFolder } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
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

export function BreadcrumbCrumbMenu({
  folderPath,
  label,
  activeChildPath,
  onNavigate,
}: BreadcrumbCrumbMenuProps) {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const prefetch = useFolderPrefetch();

  // Re-read on every open: folders come and go, and a cached list shows while it loads.
  const childrenQuery = useQuery({ ...folderChildrenQueryOptions(folderPath), enabled: open });
  const children = childrenQuery.data ?? null;
  const error = childrenQuery.isError ? formatApiError(childrenQuery.error) : null;
  const loading = childrenQuery.isFetching;

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
              {...prefetch(child.path)}
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
