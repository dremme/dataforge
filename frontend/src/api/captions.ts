import { requestJson } from "./http";
import type {
  CaptionBBox,
  CaptionSaveResponse,
  PngWorkflowResponse,
  SysPromptSaveResponse,
} from "../types";

export async function fetchCaption(mediaPath: string): Promise<CaptionSaveResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<CaptionSaveResponse>(`/api/caption?${params}`);
}

export async function fetchComfyWorkflow(mediaPath: string): Promise<PngWorkflowResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<PngWorkflowResponse>(`/api/comfy-workflow?${params}`);
}

export async function saveCaption(
  mediaPath: string,
  text: string,
  bboxes?: CaptionBBox[],
  options?: { resolveIssue?: boolean },
): Promise<CaptionSaveResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  const body: { text: string; bboxes?: CaptionBBox[]; resolve_issue?: boolean } = { text };
  if (bboxes) {
    body.bboxes = bboxes;
  }
  if (options?.resolveIssue) {
    body.resolve_issue = true;
  }

  return requestJson<CaptionSaveResponse>(`/api/caption?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function saveCaptionJson(
  mediaPath: string,
  jsonContent: string,
): Promise<CaptionSaveResponse> {
  const params = new URLSearchParams({ path: mediaPath });
  return requestJson<CaptionSaveResponse>(`/api/caption?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json_content: jsonContent }),
  });
}

export async function saveSysPrompt(
  syspromptPath: string,
  text: string,
): Promise<SysPromptSaveResponse> {
  const params = new URLSearchParams({ path: syspromptPath });
  return requestJson<SysPromptSaveResponse>(`/api/sysprompt?${params}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}
