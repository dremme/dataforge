import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { BrowseResponse, CaptionSaveResponse, SysPromptSaveResponse } from "../types";
import { applyBrowseCaptionSave } from "../utils/applyBrowseCaptionSave";

export function useBrowseCaptionSave(setBrowse: Dispatch<SetStateAction<BrowseResponse | null>>) {
  return useCallback(
    (path: string, update: CaptionSaveResponse | SysPromptSaveResponse) => {
      setBrowse((current) => {
        if (!current) return current;
        return applyBrowseCaptionSave(current, path, update);
      });
    },
    [setBrowse],
  );
}
