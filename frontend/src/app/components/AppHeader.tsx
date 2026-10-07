import type { ComponentProps, ReactNode } from "react";
import { BreadcrumbBar } from "@/features/folder/components/BreadcrumbBar";
import { Toolbar } from "@/features/gallery/components/Toolbar";
import type { FolderResponse } from "@/shared/types";

type AppHeaderProps = {
  folder: FolderResponse;
  folderNotFound?: boolean;
  refreshing?: boolean;
  onNavigate: (path?: string) => void;
  toolbarProps: ComponentProps<typeof Toolbar>;
  activity?: ReactNode;
};

export function AppHeader({
  folder,
  folderNotFound,
  refreshing = false,
  onNavigate,
  toolbarProps,
  activity,
}: AppHeaderProps) {
  return (
    <header className="app-nav">
      <div className="app-nav__inner">
        <BreadcrumbBar
          breadcrumbs={folder.breadcrumbs}
          currentFolder={folder.path}
          hasSubfolders={folder.subfolder_count > 0}
          folderNotFound={folderNotFound}
          onNavigate={onNavigate}
        />
        <Toolbar {...toolbarProps} />
        {activity}
      </div>
      {refreshing && (
        <div className="app-nav__refresh" role="status" aria-label="Refreshing folder" />
      )}
    </header>
  );
}
