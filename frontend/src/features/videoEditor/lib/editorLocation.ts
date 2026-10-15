import { parentFolderPath } from "@/features/folder/lib/folderPath";
import type { VideoEditorRequest } from "@/features/videoEditor/context/VideoEditorContext";

/** The editor's address: `/editor/<kind>?path=<file>`, the file being a new project's folder. */
export const EDITOR_ROUTE = "/editor/$kind";
export const EDITOR_KINDS = [
  "video",
  "project",
  "new",
] as const satisfies readonly VideoEditorRequest["kind"][];

const EDITOR_PATHNAME = /^\/editor\/([^/]+)\/?$/;

export function isEditorKind(kind: string): kind is VideoEditorRequest["kind"] {
  return (EDITOR_KINDS as readonly string[]).includes(kind);
}

/** What the editor at this location opens, or null for any other place. */
export function editorRequestAt(
  pathname: string,
  search: Record<string, unknown>,
): VideoEditorRequest | null {
  const kind = EDITOR_PATHNAME.exec(pathname)?.[1];
  const path = search.path;
  if (!kind || !isEditorKind(kind) || typeof path !== "string" || !path) return null;
  return { kind, path };
}

/** The folder the editor works in: the one holding its file, or a new project's own. */
export function editorFolder(request: VideoEditorRequest): string {
  return request.kind === "new" ? request.path : parentFolderPath(request.path);
}

export function sameRequest(a: VideoEditorRequest | null, b: VideoEditorRequest | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.path === b.path);
}
