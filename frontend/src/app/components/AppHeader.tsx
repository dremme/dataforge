import type { ComponentProps } from "react";
import { BreadcrumbBar } from "@/features/browse/components/BreadcrumbBar";
import { Toolbar } from "@/features/gallery/components/Toolbar";
import type { BrowseResponse } from "@/shared/types";

type AppHeaderProps = {
  browse: BrowseResponse;
  folderNotFound?: boolean;
  /** A reload running underneath content that stays on screen. */
  refreshing?: boolean;
  onNavigate: (path?: string) => void;
  onCreateFolder?: () => void;
  toolbarProps: ComponentProps<typeof Toolbar>;
};

export function AppHeader({
  browse,
  folderNotFound,
  refreshing = false,
  onNavigate,
  onCreateFolder,
  toolbarProps,
}: AppHeaderProps) {
  return (
    <header className="app-nav">
      <div className="app-nav__inner">
        <BreadcrumbBar
          breadcrumbs={browse.breadcrumbs}
          currentFolder={browse.folder}
          folderNotFound={folderNotFound}
          onNavigate={onNavigate}
          onCreateFolder={onCreateFolder}
        />
        <Toolbar {...toolbarProps} />
      </div>
      {/* Background reloads used to be entirely invisible - content simply
          changed under the user with no hint that anything had been fetched. */}
      {refreshing && (
        <div className="app-nav__refresh" role="status" aria-label="Refreshing folder" />
      )}
    </header>
  );
}
