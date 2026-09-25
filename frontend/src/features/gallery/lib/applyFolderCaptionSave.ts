import type { FolderResponse, CaptionSaveResponse } from "@/shared/types";

export function applyFolderCaptionSave(
  folder: FolderResponse,
  path: string,
  update: CaptionSaveResponse,
): FolderResponse {
  const images = folder.items.map((item) => {
    if (item.path !== path) return item;

    return {
      ...item,
      description: update.description,
      has_description: update.has_description,
      has_caption_file: update.has_caption_file,
      caption_status: update.caption_status,
      issue_fixes: update.issue_fixes,
      rule_findings: update.rule_findings,
      has_issue_file: update.has_issue_file,
    };
  });

  return { ...folder, items: images };
}
