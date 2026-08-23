import { buildSyspromptItem, isSyspromptPath } from "./sysprompt";
import type { FolderResponse, CaptionSaveResponse, SysPromptSaveResponse } from "@/shared/types";

export function applyFolderCaptionSave(
  folder: FolderResponse,
  path: string,
  update: CaptionSaveResponse | SysPromptSaveResponse,
): FolderResponse {
  const syspromptPath = "path" in update ? update.path : path;
  const isSyspromptUpdate =
    isSyspromptPath(path) ||
    isSyspromptPath(syspromptPath) ||
    folder.sysprompt?.path === path ||
    folder.sysprompt?.path === syspromptPath;

  if (isSyspromptUpdate) {
    const base = folder.sysprompt ?? buildSyspromptItem(folder.path);
    return {
      ...folder,
      sysprompt: {
        ...base,
        path: syspromptPath,
        description: update.description,
        has_description: update.has_description,
        has_caption_file: update.has_caption_file,
        caption_status: update.caption_status,
      },
    };
  }

  const images = folder.items.map((item) => {
    if (item.path !== path) return item;

    const captionUpdate = update as CaptionSaveResponse;
    return {
      ...item,
      description: captionUpdate.description,
      has_description: captionUpdate.has_description,
      has_caption_file: captionUpdate.has_caption_file,
      caption_status: captionUpdate.caption_status,
      issue_fixes: captionUpdate.issue_fixes,
      has_issue_file: captionUpdate.has_issue_file,
    };
  });

  return { ...folder, items: images };
}
