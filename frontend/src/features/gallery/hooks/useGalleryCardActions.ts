import { useCallback, useState } from "react";
import {
  openMediaInViewer,
  renameMedia,
  type MediaTransferMode,
} from "@/features/gallery/api/media";
import type { GalleryItemOpenMode } from "@/features/gallery/hooks/useGalleryOverlays";
import type { WorkspaceTransition } from "@/app/hooks/useWorkspaceTransitions";
import { formatApiError } from "@/shared/api/http";
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import { useNotify } from "@/shared/notifications/notifications";
import type { GalleryCardAction, GalleryItem } from "@/shared/types";

interface UseGalleryCardActionsOptions {
  requestTransition: WorkspaceTransition;
  /** Runs its own transition. */
  openItem: (path: string, mode?: GalleryItemOpenMode) => void;
  openInVideoEditor: (path: string) => void;
  startTransferFor: (path: string, mode: MediaTransferMode) => void;
  openDeleteConfirmFor: (path: string) => void;
  onResolveIssue: (item: GalleryItem) => void;
  onReviewCandidate: (item: GalleryItem) => void;
  onResolveDuplicate: (item: GalleryItem) => void;
  onRenamed: (path: string, renamedPath: string) => void;
}

/**
 * One handler for every card, stable whatever its targets do: the cards are memoized. Anything
 * touching a file goes through a transition first, as the inspector may hold its unsaved caption.
 */
export function useGalleryCardActions(options: UseGalleryCardActionsOptions) {
  const { requestTransition } = options;
  const notify = useNotify();
  const optionsRef = useLatestRef(options);
  const [renameTarget, setRenameTarget] = useState<GalleryItem | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const run = useCallback(
    (action: GalleryCardAction, item: GalleryItem) => {
      if (action === "edit" || action === "save_frame") {
        optionsRef.current.openItem(item.path, action === "edit" ? "edit" : "frame");
        return;
      }
      if (action === "open_in_image_preview") {
        void openMediaInViewer(item.path).catch((error: unknown) => {
          notify({ variant: "danger", message: formatApiError(error) });
        });
        return;
      }

      void requestTransition(() => {
        const handlers = optionsRef.current;
        switch (action) {
          case "open_in_video_editor":
            handlers.openInVideoEditor(item.path);
            break;
          case "copy_file":
            handlers.startTransferFor(item.path, "copy");
            break;
          case "move_file":
            handlers.startTransferFor(item.path, "move");
            break;
          case "rename_file":
            setRenameError(null);
            setRenameTarget(item);
            break;
          case "resolve_issue":
            handlers.onResolveIssue(item);
            break;
          case "review_candidate":
            handlers.onReviewCandidate(item);
            break;
          case "resolve_duplicate":
            handlers.onResolveDuplicate(item);
            break;
          case "delete":
            handlers.openDeleteConfirmFor(item.path);
            break;
        }
      });
    },
    [notify, optionsRef, requestTransition],
  );

  const confirmRename = useCallback(
    async (name: string) => {
      if (!renameTarget || renaming) return;

      setRenaming(true);
      setRenameError(null);
      try {
        const result = await renameMedia(renameTarget.path, name);
        setRenameTarget(null);
        optionsRef.current.onRenamed(renameTarget.path, result.destination);
      } catch (error) {
        setRenameError(formatApiError(error));
      } finally {
        setRenaming(false);
      }
    },
    [optionsRef, renameTarget, renaming],
  );

  const cancelRename = useCallback(() => {
    if (!renaming) setRenameTarget(null);
  }, [renaming]);

  return {
    run,
    renameFile: renameTarget && {
      fileName: renameTarget.name,
      busy: renaming,
      error: renameError,
      onConfirm: confirmRename,
      onCancel: cancelRename,
    },
  };
}
