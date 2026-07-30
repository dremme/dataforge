import { buildSyspromptItem, isSyspromptPath } from "./sysprompt";
import type { BrowseResponse, CaptionSaveResponse, SysPromptSaveResponse } from "@/shared/types";

export function applyBrowseCaptionSave(
  browse: BrowseResponse,
  path: string,
  update: CaptionSaveResponse | SysPromptSaveResponse,
): BrowseResponse {
  const syspromptPath = "path" in update ? update.path : path;
  const isSyspromptUpdate =
    isSyspromptPath(path) ||
    isSyspromptPath(syspromptPath) ||
    browse.sysprompt?.path === path ||
    browse.sysprompt?.path === syspromptPath;

  if (isSyspromptUpdate) {
    const base = browse.sysprompt ?? buildSyspromptItem(browse.folder);
    return {
      ...browse,
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

  const images = browse.items.map((item) => {
    if (item.path !== path) return item;

    const captionUpdate = update as CaptionSaveResponse;
    return {
      ...item,
      description: captionUpdate.description,
      has_description: captionUpdate.has_description,
      has_caption_file: captionUpdate.has_caption_file,
      caption_status: captionUpdate.caption_status,
      has_bboxes: captionUpdate.has_bboxes,
      bboxes: captionUpdate.bboxes !== undefined ? captionUpdate.bboxes : item.bboxes,
      caption_file_type: captionUpdate.caption_file_type,
      issue_fixes: captionUpdate.issue_fixes ?? item.issue_fixes,
      has_issue_file: captionUpdate.has_issue_file ?? item.has_issue_file,
    };
  });

  return { ...browse, items: images };
}
