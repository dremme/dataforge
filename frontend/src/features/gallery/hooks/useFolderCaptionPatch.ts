import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { FolderResponse, CaptionSaveResponse, SysPromptSaveResponse } from "@/shared/types";
import { applyFolderCaptionSave } from "@/features/gallery/lib/applyFolderCaptionSave";

export function useFolderCaptionPatch(setFolder: Dispatch<SetStateAction<FolderResponse | null>>) {
  return useCallback(
    (path: string, update: CaptionSaveResponse | SysPromptSaveResponse) => {
      setFolder((current) => {
        if (!current) return current;
        return applyFolderCaptionSave(current, path, update);
      });
    },
    [setFolder],
  );
}
