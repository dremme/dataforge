import { putJson, requestJson } from "@/shared/api/http";
import type {
  FolderInstructionsResponse,
  InstructionFileResponse,
  InstructionFileUpdate,
} from "@/shared/types";

export type InstructionKind = "sysprompt" | "caption_rules";

const SAVE_ROUTES: Record<InstructionKind, string> = {
  sysprompt: "/api/sysprompt",
  caption_rules: "/api/caption-rules",
};

export async function fetchFolderInstructions(
  folderPath: string,
  signal?: AbortSignal,
): Promise<FolderInstructionsResponse> {
  const params = new URLSearchParams({ path: folderPath });
  return requestJson<FolderInstructionsResponse>(`/api/folder-instructions?${params}`, { signal });
}

export async function saveInstructionFile(
  kind: InstructionKind,
  folderPath: string,
  text: string,
): Promise<InstructionFileResponse> {
  const params = new URLSearchParams({ path: folderPath });
  const body: InstructionFileUpdate = { text };
  return putJson<InstructionFileResponse>(`${SAVE_ROUTES[kind]}?${params}`, body);
}

/** Whether the file reaches the folder with any text: its own copy, else the parent's. */
export function instructionApplies(file: InstructionFileResponse): boolean {
  return (file.has_file ? file.text : file.parent_text).trim() !== "";
}
