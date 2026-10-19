import type { ReactNode } from "react";
import { useTabList } from "@/shared/hooks/useTabList";
import { classNames } from "@/shared/lib/classNames";

interface SettingsPageTabsProps<P extends { id: string; label: string }> {
  /** The section's name, for the tab list's accessible label. */
  label: string;
  pages: readonly P[];
  active: P["id"];
  isEdited: (page: P) => boolean;
  onSelect: (id: P["id"]) => void;
  renderPage: (page: P) => ReactNode;
}

export function SettingsPageTabs<P extends { id: string; label: string }>({
  label,
  pages,
  active,
  isEdited,
  onSelect,
  renderPage,
}: SettingsPageTabsProps<P>) {
  const tabs = useTabList(
    pages.map((page) => page.id),
    active,
    onSelect,
  );

  return (
    <>
      <div {...tabs.tabListProps} aria-label={label} className="settings-dialog__pages">
        {pages.map((page) => (
          <button
            key={page.id}
            {...tabs.tabProps(page.id)}
            className={classNames(
              "settings-dialog__page-tab",
              page.id === active && "settings-dialog__page-tab--active",
            )}
          >
            {page.label}
            {isEdited(page) && <span className="settings-dialog__tab-dot" aria-label="Unsaved" />}
          </button>
        ))}
      </div>
      {pages.map((page) => (
        <div key={page.id} {...tabs.panelProps(page.id)} className="settings-dialog__body">
          {renderPage(page)}
        </div>
      ))}
    </>
  );
}
