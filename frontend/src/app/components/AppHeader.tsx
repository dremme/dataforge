import type { ComponentProps } from "react";
import { BreadcrumbBar } from "@/features/folder/components/BreadcrumbBar";
import { Toolbar } from "@/features/gallery/components/Toolbar";
import type { FolderResponse } from "@/shared/types";

type AppHeaderProps = {
  folder: FolderResponse;
  folderNotFound?: boolean;
  refreshing?: boolean;
  onNavigate: (path?: string) => void;
  onOpenFolderPicker: () => void;
  toolbarProps: ComponentProps<typeof Toolbar>;
};

export function AppHeader({
  folder,
  folderNotFound,
  refreshing = false,
  onNavigate,
  onOpenFolderPicker,
  toolbarProps,
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
          onOpenPicker={onOpenFolderPicker}
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
