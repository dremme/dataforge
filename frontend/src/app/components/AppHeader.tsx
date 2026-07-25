import type { ComponentProps } from "react";
import { BreadcrumbBar } from "@/features/browse/components/BreadcrumbBar";
import { Toolbar } from "@/features/gallery/components/Toolbar";
import type { BrowseResponse } from "@/shared/types";

type AppHeaderProps = {
  browse: BrowseResponse;
  folderNotFound?: boolean;
  onNavigate: (path?: string) => void;
  onCreateFolder?: () => void;
  toolbarProps: ComponentProps<typeof Toolbar>;
};

export function AppHeader({
  browse,
  folderNotFound,
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
    </header>
  );
}
