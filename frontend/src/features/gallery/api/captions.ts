import { putJson, requestJson } from "@/shared/api/http";
import type {
  CaptionBackupResponse,
  CaptionSaveResponse,
  CaptionUpdate,
  ComfyEditorWorkflowResponse,
  ComfyWorkflowPromptsResponse,
  PngWorkflowResponse,
} from "@/shared/types";

export async function fetchCaption(mediaPath: string): Promise<CaptionSaveResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<CaptionSaveResponse>(`/api/caption?${params}`);
}

export async function fetchCaptionBackup(mediaPath: string): Promise<CaptionBackupResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<CaptionBackupResponse>(`/api/caption/backup?${params}`);
}

export async function fetchComfyWorkflow(mediaPath: string): Promise<PngWorkflowResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<PngWorkflowResponse>(`/api/comfy-workflow?${params}`);
}

export async function fetchComfyWorkflowPrompts(
  mediaPath: string,
  signal?: AbortSignal,
): Promise<ComfyWorkflowPromptsResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<ComfyWorkflowPromptsResponse>(`/api/comfy-workflow/prompts?${params}`, {
    signal,
  });
}

/** The editor workflow trimmed to one output; it loads in ComfyUI when pasted onto the canvas. */
export async function fetchComfyEditorWorkflow(mediaPath: string, nodeId: string): Promise<string> {
  const params = new URLSearchParams({ path: mediaPath, node_id: nodeId });
  const response = await requestJson<ComfyEditorWorkflowResponse>(
    `/api/comfy-workflow/editor?${params}`,
  );
  return response.workflow;
}

export async function saveCaption(
  mediaPath: string,
  text: string,
  options?: { resolveIssue?: boolean },
): Promise<CaptionSaveResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  const body: CaptionUpdate = { text };
  if (options?.resolveIssue) {
    body.resolve_issue = true;
  }

  return putJson<CaptionSaveResponse>(`/api/caption?${params}`, body);
}
