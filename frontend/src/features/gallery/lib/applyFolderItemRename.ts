import type { FolderResponse } from "@/shared/types";
import { pathBaseName } from "./mediaActionMessages";

/** Moves an item to its new name in place; the next listing settles its sort position. */
export function applyFolderItemRename(
  folder: FolderResponse,
  path: string,
  renamedPath: string,
): FolderResponse {
  const items = folder.items.map((item) =>
    item.path === path ? { ...item, path: renamedPath, name: pathBaseName(renamedPath) } : item,
  );
  return { ...folder, items };
}
